// Spec 39 (Lot B) — réconciliation Mercado Pago qui PILOTE l'expiration des commandes.
// Déclenchée toutes les 2 min par pg_cron/pg_net (migration 20260921100000, `invoke_payments_
// reconcile`). Remplace `expire_stale_payment_orders`, qui annulait une commande de plus de 30 min
// SANS demander à Mercado Pago si l'argent était encaissé (incident HFG-000013 du 2026-09-20).
//
// Ce que fait cette fonction, et rien d'autre : elle POSE LES QUESTIONS à Mercado Pago (identité du
// token, recherche par external_reference, annulation d'un paiement en attente) et transmet les
// réponses aux RPC, qui DÉCIDENT sous verrou (`reconcile_order`, `expire_payment_order`,
// `record_mp_payment_status`). Aucune décision ici. Échec fermé partout : MP injoignable, identité
// du token douteuse, budget d'appels épuisé ⇒ ce qui n'a pas pu être vérifié attend le tick suivant,
// rien n'expire, et le heartbeat le dit (`job_heartbeats`, watchdog SQL à 15 min).
//
// Squelette commun des jobs (_shared/job.ts : contrôle d'appelant, budget de temps — 45 s, sous les
// 55 s du wrapper pg_net et le bail de 2 min de claim_orders_to_reconcile —, heartbeat à chaque
// passage, aucun secret dans ce qui sort). Points propres à ce job :
//   - MERCADOPAGO_ACCESS_TOKEN doit appartenir au MÊME compte MP que celui d'apps/web (piège 19) :
//     `GET /users/me` le prouve à chaque run, `reconcile_order` ET `record_mp_payment_status`
//     refusent tous deux si l'id diverge (20260922170000 — le second en était dépourvu) ;
//   - MERCADOPAGO_API_BASE_URL est surchargeable (fixture HTTP des tests d'intégration) ;
//   - aucun `new Date()` (scripts/check-timezone.sh) : l'horodatage de contrôle est `claimed_at`,
//     rendu par la base au moment du claim ; les deltas se calculent sur des instants ISO.
import { type JobOutcome, serveJob } from "../_shared/job.ts";
import {
  exploitableAmount,
  type MercadoPagoPaymentFields,
  toPaymentEvent,
} from "../../../packages/domain/src/mercadopago/paymentEvent.ts";

const MP_DEFAULT_BASE_URL = "https://api.mercadopago.com";
/** Appels MP par run, toutes routes confondues : au-delà, le reste attend le tick suivant (2 min). */
const MAX_MP_CALLS = 60;
/** Une préférence Checkout Pro meurt 28 min après orders.created_at (create/route.ts) : un paiement
 *  `rejected`/`cancelled` dont MP a déjà dit le dernier mot n'a plus rien à révéler après ça. */
const PREFERENCE_LIFETIME_MS = 28 * 60_000;
const TERMINAL_MP_STATUSES = new Set(["approved", "rejected", "cancelled", "refunded", "charged_back"]);

interface LocalPayment {
  id: string;
  status: string;
  amount_cop: number;
  mp_payment_id: string | null;
  mp_collector_id: string | null;
  mp_last_status: string | null;
  created_at: string;
  mp_cancel_attempts: number;
}
interface ClaimedOrder {
  order_id: string;
  created_at: string;
  claimed_at: string;
  payment_status: string;
  payments: LocalPayment[];
}
interface WatchedPayment {
  payment_id: string;
  order_id: string;
  claimed_at: string;
}
interface MpPayment extends MercadoPagoPaymentFields {
  id: number | string;
  status: string;
}
/** La forme que `reconcile_order`/`record_mp_payment_status` attendent dans p_mp_payments — et
 *  qu'elles CONSERVENT telle quelle (raw_event, raw_last_event) : l'événement aplati partagé
 *  (paymentEvent.ts), plus l'id du paiement local. */
interface MpItem {
  payment_id: string;
  mp_payment_id: string;
  status: string;
  status_detail: string | null;
  transaction_amount: number | null;
  mp_transaction_amount: number | null;
  currency_id: string | null;
  date_created: string | null;
  date_approved: string | null;
  external_reference: string | null;
  collector_id: string | null;
  webhook_body: null;
}
interface Decision {
  action: string;
  mp_cancel_ids?: string[];
}
interface ClaimedRefund {
  refund_id: string;
  mp_payment_id: string;
  amount_cop: number;
  attempts: number;
  claimed_at: string;
}

class MpBudgetExceeded extends Error {}

/** Le résultat d'apply_payment_webhook_checked : `{ok:true}` appliqué, `{ok:true, reason}` lu sans
 *  application (double paiement, remboursement à faire…), `{ok:false, reason}` refusé. */
interface CheckedResult {
  ok?: boolean;
  reason?: string;
}

function toItem(paymentId: string, p: MpPayment): MpItem {
  // Montant EXPLOITABLE seulement (COP, fini) — sinon null, que la base traite en échec fermé ; la
  // devise et le montant brut restent dans l'événement (diagnostic). Jamais le payeur.
  const event = toPaymentEvent(p, exploitableAmount(p), null) as unknown as Omit<MpItem, "payment_id">;
  return { ...event, payment_id: paymentId, mp_payment_id: String(p.id), status: String(p.status) };
}

serveJob("payments-reconcile", async (ctx): Promise<JobOutcome> => {
  const { supabase, request: req } = ctx;

  const body = await req.json().catch(() => ({}));
  const limit = Number((body as { limit?: number })?.limit ?? 25);
  const token = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  const baseUrl = Deno.env.get("MERCADOPAGO_API_BASE_URL") || MP_DEFAULT_BASE_URL;

  const stats = {
    claimed: 0,
    applied: 0,
    expired: 0,
    kept: 0,
    kept_pending: 0,
    closed: 0,
    cancel_attempts: 0,
    identity_mismatch: 0,
    watched: 0,
    refunds_claimed: 0,
    refunds_approved: 0,
    refunds_rejected: 0,
    refunds_retry: 0,
    errors: 0,
    mp_calls: 0,
    budget_hit: false,
    /** Écart max (ms) entre `date_approved` chez MP et l'instant où ce job l'a vu : la mesure du
     *  délai d'indexation de /v1/payments/search, non documenté par MP — sert à caler la marge. */
    index_delay_ms_max: 0,
    /** apply_payment_webhook_checked a lu le paiement sans l'appliquer (double paiement, etc.). */
    checked_not_applied: 0,
  };

  // Sans token, on ne réclame RIEN (patron send-notification-emails) : un claim poserait
  // reconcile_claimed_at pour rien. 200 volontaire — état de configuration, pas une panne.
  if (!token) {
    return { ok: false, error: "MERCADOPAGO_ACCESS_TOKEN manquant (supabase secrets set / functions/.env)", stats };
  }

  async function mp(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> | null }> {
    if (stats.mp_calls >= MAX_MP_CALLS) throw new MpBudgetExceeded("budget d'appels MP épuisé pour ce run");
    // Budget de TEMPS du passage, en plus du budget d'appels : le reste attend le tick suivant.
    const timeoutMs = ctx.nextCallTimeout();
    if (timeoutMs === null) throw new MpBudgetExceeded("budget de temps épuisé pour ce run");
    stats.mp_calls++;
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...((init?.headers as Record<string, string>) ?? {}),
      },
    });
    const parsed = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, body: parsed };
  }

  // Identité du token : une recherche VIDE avec le token d'un autre compte MP est exactement
  // l'incident du 2026-09-20 (deux comptes, piège 19). Sans preuve d'identité, rien ne se décide.
  let collectorId: string;
  try {
    const me = await mp("/users/me");
    if (me.status !== 200 || me.body?.id === undefined) {
      throw new Error(`GET /users/me → ${me.status}`);
    }
    collectorId = String(me.body.id);
  } catch (err) {
    return { ok: false, error: `mp_unreachable: ${ctx.describe(err)}`, stats };
  }

  async function searchByReference(paymentId: string): Promise<MpItem[]> {
    const params = new URLSearchParams({
      external_reference: paymentId,
      sort: "date_created",
      criteria: "desc",
      limit: "50",
    });
    const res = await mp(`/v1/payments/search?${params}`);
    if (res.status !== 200) throw new Error(`search ${paymentId} → ${res.status}`);
    const results = ((res.body?.results as MpPayment[] | undefined) ?? []).filter(
      (p) => (p.external_reference ?? paymentId) === paymentId
    );
    return results.map((p) => toItem(paymentId, p));
  }

  function trackIndexDelay(items: MpItem[], seenAt: string) {
    for (const item of items) {
      if (item.status !== "approved" || !item.date_approved) continue;
      const delay = Date.parse(seenAt) - Date.parse(item.date_approved);
      if (Number.isFinite(delay) && delay > stats.index_delay_ms_max) stats.index_delay_ms_max = delay;
    }
  }

  let identityMismatch = false;

  // ---- 1. Commandes candidates -------------------------------------------------------------
  const { data: batch, error: claimError } = await supabase.rpc("claim_orders_to_reconcile", { p_limit: limit });
  if (claimError) {
    return { ok: false, error: `claim_failed: ${ctx.describe(claimError)}`, stats, status: 500 };
  }
  const orders = (batch ?? []) as ClaimedOrder[];
  stats.claimed = orders.length;

  for (const order of orders) {
    try {
      const preferenceDead =
        Date.parse(order.created_at) + PREFERENCE_LIFETIME_MS < Date.parse(order.claimed_at);
      // Un paiement local déjà terminal chez MP, dont la préférence est morte, ne peut plus rien
      // révéler : pas de recherche pour lui (budget). Tous les autres sont demandés — y compris un
      // `rejected` dont la préférence vit encore (carte retentée dans la même session).
      const useful = order.payments.filter(
        (p) =>
          !(
            (p.status === "rejected" || p.status === "cancelled") &&
            p.mp_last_status !== null &&
            TERMINAL_MP_STATUSES.has(p.mp_last_status) &&
            preferenceDead
          )
      );
      const items: MpItem[] = [];
      for (const p of useful) items.push(...(await searchByReference(p.id)));

      const { data, error: rpcError } = await supabase.rpc("reconcile_order", {
        p_order_id: order.order_id,
        p_mp_payments: items,
        p_checked_at: order.claimed_at,
        p_collector_id: collectorId,
      });
      if (rpcError) throw rpcError;
      const decision = (data ?? { action: "kept" }) as Decision;

      switch (decision.action) {
        case "applied":
          stats.applied++;
          trackIndexDelay(items, order.claimed_at);
          break;
        case "expired":
          stats.expired++;
          break;
        case "kept_pending":
          stats.kept_pending++;
          break;
        case "closed":
          stats.closed++;
          break;
        case "identity_mismatch":
          stats.identity_mismatch++;
          identityMismatch = true;
          break;
        case "cancel_at_mp":
          break;
        default:
          stats.kept++;
      }

      // D2 — annulation chez MP en meilleur effort : PUT, puis re-GET pour lire ce que MP a
      // RÉELLEMENT fait (un PUT refusé sur un virement approuvé entre-temps doit devenir une
      // confirmation, jamais une expiration). La borne (3 tentatives / 2 h 30) vit dans
      // expire_payment_order, pas ici.
      const cancelIds = decision.mp_cancel_ids ?? [];
      if (cancelIds.length > 0) {
        let approvedSeen = false;
        for (const mpId of cancelIds) {
          const item = items.find((i) => i.mp_payment_id === mpId);
          if (!item) continue;
          stats.cancel_attempts++;
          const put = await mp(`/v1/payments/${encodeURIComponent(mpId)}`, {
            method: "PUT",
            body: JSON.stringify({ status: "cancelled" }),
          });
          const get = await mp(`/v1/payments/${encodeURIComponent(mpId)}`);
          // Le paiement relu, quand MP le dit approuvé : l'événement est construit sur CETTE réponse.
          const approved =
            get.status === 200 && get.body?.status === "approved" ? (get.body as MercadoPagoPaymentFields) : null;
          const statusAfter =
            get.status === 200 && typeof get.body?.status === "string"
              ? (get.body.status as string)
              : put.status === 200
                ? "cancelled"
                : null;
          const { error: markError } = await supabase.rpc("mark_mp_cancel_attempt", {
            p_payment_id: item.payment_id,
            p_mp_status_after: statusAfter,
          });
          if (markError) {
            stats.errors++;
            console.error(`payments-reconcile: tentative d'annulation de ${item.payment_id} non consignée — ${ctx.describe(markError)}`);
          }
          if (approved !== null) {
            approvedSeen = true;
            // L'événement APLATI (jamais l'objet MP entier, payeur compris) et un montant exploitable
            // (COP) ou null.
            const amount = exploitableAmount(approved);
            const { data: checked, error: checkedError } = await supabase.rpc("apply_payment_webhook_checked", {
              p_mp_payment_id: mpId,
              p_external_reference: item.payment_id,
              p_status: "approved",
              p_transaction_amount: amount as number,
              p_raw_event: toPaymentEvent(approved, amount, null),
            });
            const result = (checked ?? {}) as CheckedResult;
            if (checkedError || !result.ok) {
              stats.errors++;
              console.error(
                `payments-reconcile: approbation de ${item.payment_id} non appliquée — ${checkedError ? ctx.describe(checkedError) : result.reason ?? "refus"}`
              );
            } else if (result.reason) {
              stats.checked_not_applied++;
              console.warn(`payments-reconcile: approbation de ${item.payment_id} lue sans application (${result.reason})`);
            } else {
              stats.applied++;
            }
          }
        }
        if (decision.action === "cancel_at_mp" && !approvedSeen) {
          const { data: expired, error: expireError } = await supabase.rpc("expire_payment_order", {
            p_order_id: order.order_id,
            p_checked_at: order.claimed_at,
          });
          if (expireError) {
            stats.errors++;
            console.error(`payments-reconcile: expiration de ${order.order_id} en échec — ${ctx.describe(expireError)}`);
          } else if ((expired as { ok?: boolean } | null)?.ok) stats.expired++;
          else stats.kept_pending++;
        }
      }
    } catch (err) {
      if (err instanceof MpBudgetExceeded) {
        stats.budget_hit = true;
        break;
      }
      stats.errors++;
      console.error(`payments-reconcile: commande ${order.order_id} en échec — ${ctx.describe(err)}`);
    }
  }

  // ---- 2. Surveillance après expiration/annulation (48 h) ----------------------------------
  // Un virement PSE qui aboutit après l'expiration, une approbation indexée tard : l'argent doit
  // rester visible même si le webhook est mort — la garde du Lot A en fait une entrée refund_required.
  // Rien n'est réclamé quand le budget de temps ne laisse plus un appel : le bail de la réclamation
  // retarderait le passage suivant pour rien.
  if (!stats.budget_hit && ctx.nextCallTimeout() === null) stats.budget_hit = true;
  if (!stats.budget_hit) {
    const { data: watched, error: watchError } = await supabase.rpc("claim_payments_to_watch", { p_limit: limit });
    if (watchError) {
      stats.errors++;
      console.error(`claim_payments_to_watch a échoué — ${ctx.describe(watchError)}`);
    }
    for (const w of (watched ?? []) as WatchedPayment[]) {
      try {
        const items = await searchByReference(w.payment_id);
        const { data: watchData, error: recError } = await supabase.rpc("record_mp_payment_status", {
          p_payment_id: w.payment_id,
          p_mp_payments: items,
          p_checked_at: w.claimed_at,
          p_collector_id: collectorId,
        });
        if (recError) throw recError;
        if ((watchData as Decision | null)?.action === "identity_mismatch") {
          stats.identity_mismatch++;
          identityMismatch = true;
        } else {
          stats.watched++;
        }
      } catch (err) {
        if (err instanceof MpBudgetExceeded) {
          stats.budget_hit = true;
          break;
        }
        stats.errors++;
        console.error(`payments-reconcile: surveillance ${w.payment_id} en échec — ${ctx.describe(err)}`);
      }
    }
  }

  // ---- 3. Remboursements demandés par l'admin (spec 39 D3, migration 20260922100000) -------
  // Un seul appel MP par remboursement, X-Idempotency-Key = payment_refunds.id : un run mort entre
  // l'appel et finalize rejoue la même clé au bail suivant, MP ne rembourse pas deux fois. Le corps
  // d'erreur est conservé tel quel (raw_response) — le mapping « déjà remboursé » / « trop vieux »
  // s'écrit sur des corps CAPTURÉS en préprod, jamais devinés (spec 39 §10.5).
  if (!stats.budget_hit && ctx.nextCallTimeout() === null) stats.budget_hit = true;
  if (!stats.budget_hit) {
    const { data: refunds, error: refundClaimError } = await supabase.rpc("claim_payment_refunds", { p_limit: 10 });
    if (refundClaimError) {
      stats.errors++;
      console.error(`claim_payment_refunds a échoué — ${ctx.describe(refundClaimError)}`);
    }
    for (const refund of (refunds ?? []) as ClaimedRefund[]) {
      stats.refunds_claimed++;
      try {
        const res = await mp(`/v1/payments/${encodeURIComponent(refund.mp_payment_id)}/refunds`, {
          method: "POST",
          headers: { "X-Idempotency-Key": refund.refund_id },
          body: JSON.stringify({}),
        });
        const message = String(res.body?.message ?? "");
        // Le corps est conservé (raw_response) — chaque chaîne masquée : jamais un secret en base.
        const raw = ctx.redactJson(res.body);
        let writeError: unknown = null;
        if (res.status === 200 || res.status === 201) {
          ({ error: writeError } = await supabase.rpc("finalize_payment_refund", {
            p_refund_id: refund.refund_id,
            p_outcome: "approved",
            p_mp_refund_id: res.body?.id === undefined ? null : String(res.body.id),
            p_raw: raw,
          }));
          stats.refunds_approved++;
        } else if (res.status >= 500 || res.status === 429) {
          ({ error: writeError } = await supabase.rpc("fail_payment_refund", {
            p_refund_id: refund.refund_id,
            p_error: ctx.redact(`HTTP ${res.status} ${message}`.trim()),
          }));
          stats.refunds_retry++;
        } else {
          // 4xx métier : refus définitif, l'admin reprend la main avec le corps exact sous les yeux.
          ({ error: writeError } = await supabase.rpc("finalize_payment_refund", {
            p_refund_id: refund.refund_id,
            p_outcome: "rejected",
            p_mp_refund_id: null,
            p_raw: raw,
            p_error: ctx.redact(`HTTP ${res.status} ${message}`.trim()),
          }));
          stats.refunds_rejected++;
        }
        if (writeError) {
          // Le bail du claim (10 min) le rejoue avec la même X-Idempotency-Key : MP ne rembourse
          // pas deux fois — mais la supervision le dit.
          stats.errors++;
          console.error(`payments-reconcile: remboursement ${refund.refund_id} non consigné — ${ctx.describe(writeError)}`);
        }
      } catch (err) {
        if (err instanceof MpBudgetExceeded) {
          stats.budget_hit = true;
          break;
        }
        stats.errors++;
        const { error: failError } = await supabase.rpc("fail_payment_refund", { p_refund_id: refund.refund_id, p_error: ctx.describe(err) });
        if (failError) console.error(`payments-reconcile: remboursement ${refund.refund_id} non consigné — ${ctx.describe(failError)}`);
        stats.refunds_retry++;
      }
    }
  }

  return {
    ok: !identityMismatch && stats.errors === 0,
    error: identityMismatch
      ? "identity_mismatch: MERCADOPAGO_ACCESS_TOKEN n'appartient pas au compte MP qui a créé les préférences (piège 19)"
      : stats.errors > 0
        ? `${stats.errors} erreur(s) pendant le rapprochement (recherche MP, RPC ou remboursement) — détail dans les journaux`
        : null,
    stats,
  };
}, { budgetMs: 45_000 });
