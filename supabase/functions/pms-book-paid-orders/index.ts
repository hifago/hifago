// Lobby APRÈS l'acompte (spec 21 §8.1, retournement du 2026-10-23) — réserve chez LobbyPMS les
// commandes DÉJÀ PAYÉES. Remplace reserve-nights, qui écrivait chez Lobby avant le paiement : un
// paiement refusé laissait un booking vivant et un e-mail « réservé » partait sans argent.
//
// Déclenché de deux façons, qui se valent (la file est prise `for update skip locked`, le claim de
// commande est exclusif) :
//   - tout de suite, par le trigger sur pms_booking_requests (pg_net, après le commit du webhook) ;
//   - en filet, par le cron `pms-book-paid-orders` toutes les minutes.
//
// UNE DEMANDE = UNE COMMANDE PAYÉE (apply_payment_webhook en pose une quand une nuit PMS n'a pas de
// booking). Le passage : claim de la demande (backoff, tentatives) → claim de la commande « payée
// seulement » (bail de 5 min, sans échéance de paiement) → bookClaimedOrder (domaine) → résolution.
//
// QUE FAIT-ON D'UN ÉCHEC, l'argent étant encaissé (jamais de dé-paiement, jamais de remboursement
// automatique — les remboursements sont suspendus) :
//   - tout réservé            → done : notify_order_confirmed envoie les e-mails 5/6/7 et 8 ;
//   - refus Lobby (400/422)   → failed : entrée de réconciliation « commande PAYÉE — reloger ou
//                               rembourser à la main » + e-mail admin (trigger) ;
//   - panne                   → nouvel essai avec backoff (6 essais sur ~30 min), puis failed ;
//   - issue inconnue          → needs_human, JAMAIS retentée (le booking a pu naître), entrée
//                               immédiate portant la clé « hifago order_line <id> » ;
//   - commande remboursée ou rejetée entre-temps → demande close (cancelled) ;
//   - connecteur coupé        → traité comme une panne.
// Les bookings déjà obtenus sont gardés : une reprise ne réserve que les lignes sans booking.
//
// Version EXACTE, jamais une plage : `@2` se résout au déploiement (scripts/check-deno-imports.sh).
import { type JobContext, type JobOutcome, serveJob } from "../_shared/job.ts";
import { LOBBY_DEFAULT_BASE_URL } from "../../../packages/domain/src/pms/lobbyClient.ts";
import {
  bookClaimedOrder,
  type BookResult,
  type BookStore,
  type ClaimedOrder,
  type MarkOutcome,
  type RecordOutcome,
} from "../../../packages/domain/src/pms/bookClaimedOrder.ts";

interface RequestRow {
  request_id: string;
  order_id: string;
  attempts: number;
}

type OrderClaim =
  | { ok: true; claimed_at: string | null; attribution_code?: string | null; attribution_source?: string | null; groups: ClaimedOrder["groups"] }
  | { ok: false; reason: string; order_line_id?: string };

// Délai avant le nouvel essai d'une PANNE, d'après le numéro de la tentative qui vient d'échouer :
// 1, 2, 4, 8 puis 15 minutes — six essais en ~30 minutes (décision D7).
const RETRY_DELAYS_MINUTES = [1, 2, 4, 8, 15, 15];

function retryAfter(attempts: number): string {
  const minutes = RETRY_DELAYS_MINUTES[Math.min(Math.max(attempts, 1), RETRY_DELAYS_MINUTES.length) - 1];
  return `${minutes} minutes`;
}

serveJob("pms-book-paid-orders", async (ctx): Promise<JobOutcome> => {
  const { supabase } = ctx;
  const baseUrl = Deno.env.get("LOBBY_API_BASE_URL") || LOBBY_DEFAULT_BASE_URL;
  const relaySecret = Deno.env.get("LOBBY_RELAY_SECRET");

  const { data: batch, error } = await supabase.rpc("claim_pms_booking_requests", { p_limit: 3 });
  if (error) {
    return { ok: false, error: `claim_pms_booking_requests — ${ctx.describe(error)}`, stats: {}, status: 500 };
  }

  const rows = (batch ?? []) as RequestRow[];
  const stats = { claimed: rows.length, done: 0, retried: 0, failed: 0, needs_human: 0, cancelled: 0, deferred: 0 };
  // Les écritures de la file qui échouent : la demande reste `pending` (le passage suivant la
  // rattrape, le claim de commande étant idempotent), mais la supervision le dit.
  const problems: string[] = [];

  const resolve = async (row: RequestRow, args: Record<string, unknown>) => {
    const { error: resolveError } = await supabase.rpc("resolve_pms_booking_request", {
      p_request_id: row.request_id,
      ...args,
    });
    if (resolveError) {
      problems.push(`écriture resolve_pms_booking_request (commande ${row.order_id.slice(0, 8)})`);
      console.error(`pms-book-paid-orders : resolve_pms_booking_request — ${ctx.describe(resolveError)}`);
    }
  };

  for (const row of rows) {
    // Un appel Lobby ne part qu'avec son délai complet : sans budget pour un appel, la demande est
    // rendue sans avoir consommé de tentative.
    if (ctx.nextCallTimeout() === null) {
      stats.deferred++;
      await resolve(row, { p_outcome: "retry", p_retry_after: "30 seconds", p_keep_attempt: false });
      continue;
    }

    const { data: claimData, error: claimError } = await supabase.rpc("claim_paid_order_for_pms_booking", {
      p_order_id: row.order_id,
    });
    if (claimError || !claimData) {
      problems.push(`claim_paid_order_for_pms_booking (commande ${row.order_id.slice(0, 8)})`);
      console.error(`pms-book-paid-orders : claim de commande — ${ctx.describe(claimError ?? "réponse vide")}`);
      await resolve(row, { p_outcome: "retry", p_retry_after: retryAfter(row.attempts), p_error: "base indisponible au claim" });
      stats.retried++;
      continue;
    }

    const claim = claimData as OrderClaim;
    if (!claim.ok) {
      switch (claim.reason) {
        case "claim_in_progress":
          // Un autre passage tient la commande : rien n'a été tenté.
          stats.deferred++;
          await resolve(row, { p_outcome: "retry", p_retry_after: "1 minute", p_keep_attempt: false });
          break;
        case "attempt_unresolved": {
          // Un POST /bookings précédent n'a jamais eu d'issue connue (marqueur durable posé avant
          // l'appel, jamais effacé) : le booking a PEUT-ÊTRE été créé chez Lobby. JAMAIS retenté — un
          // second POST serait un second booking payé, non annulable par API. Un humain vérifie.
          stats.needs_human++;
          await resolve(row, {
            p_outcome: "needs_human",
            p_order_line_id: claim.order_line_id ?? null,
            p_error: `tentative de booking précédente sans issue connue — booking PEUT-ÊTRE créé chez Lobby, à vérifier par la note « hifago order_line ${claim.order_line_id ?? "?"} »`,
          });
          break;
        }
        case "pms_unavailable":
          // Connecteur coupé : traité comme une panne (il peut être rebranché dans les 30 minutes).
          stats.retried++;
          await resolve(row, { p_outcome: "retry", p_retry_after: retryAfter(row.attempts), p_error: "connecteur LobbyPMS coupé (pms_unavailable)" });
          break;
        default:
          // order_not_found / order_not_paid (remboursée, rejetée…) / order_not_active (toutes les
          // lignes annulées après le paiement) : rien à réserver, la demande est close.
          stats.cancelled++;
          await resolve(row, { p_outcome: "cancelled", p_error: claim.reason });
      }
      continue;
    }

    if (claim.claimed_at === null || claim.groups.length === 0) {
      // Plus aucune ligne sans booking (réservée par un passage précédent) : la commande est confirmée.
      stats.done++;
      await resolve(row, { p_outcome: "done" });
      continue;
    }

    for (const group of claim.groups) ctx.addSecret(group.api_token);
    const claimedAt = claim.claimed_at;

    const store: BookStore = {
      async recordBooking(orderLineId, bookingId): Promise<RecordOutcome> {
        // Une nouvelle tentative si l'APPEL échoue : le booking existe déjà chez Lobby, le perdre
        // serait pire qu'un aller-retour de plus. record_pms_booking est idempotent sur le même id.
        for (let attempt = 1; attempt <= 2; attempt++) {
          const { data, error: recordError } = await supabase.rpc("record_pms_booking", {
            p_order_id: row.order_id,
            p_claimed_at: claimedAt,
            p_order_line_id: orderLineId,
            p_pms_booking_id: bookingId,
          });
          if (recordError) {
            console.error(`pms-book-paid-orders : record_pms_booking a échoué (tentative ${attempt}, ligne ${orderLineId}) — ${ctx.describe(recordError)}`);
            continue;
          }
          const result = data as { ok?: boolean; reason?: string } | null;
          if (result?.ok === true) return "ok";
          if (result?.reason === "claim_stale" || result?.reason === "already_booked" || result?.reason === "line_not_reserved") {
            return result.reason;
          }
          return "not_recorded";
        }
        return "not_recorded";
      },
      async markAttempt(orderLineId): Promise<MarkOutcome> {
        const { data, error: markError } = await supabase.rpc("mark_pms_booking_attempt", {
          p_order_id: row.order_id,
          p_claimed_at: claimedAt,
          p_order_line_id: orderLineId,
        });
        if (markError) {
          console.error(`pms-book-paid-orders : mark_pms_booking_attempt a échoué (ligne ${orderLineId}) — ${ctx.describe(markError)}`);
          return "error";
        }
        const result = data as { ok?: boolean; reason?: string } | null;
        if (result?.ok === true) return "ok";
        switch (result?.reason) {
          case "already_attempted":
            return "already_attempted";
          case "claim_stale":
            return "claim_lost";
          case "already_booked":
          case "line_not_reserved":
            return "skip";
          default:
            return "error";
        }
      },
      async clearAttempt(orderLineId) {
        // Best-effort : un marqueur non effacé après une panne FRANCHE bloque seulement la ligne
        // (needs_human au prochain passage) — jamais un rejeu.
        const { error: clearError } = await supabase.rpc("clear_pms_booking_attempt", {
          p_order_id: row.order_id,
          p_claimed_at: claimedAt,
          p_order_line_id: orderLineId,
        });
        if (clearError) {
          console.error(`pms-book-paid-orders : clear_pms_booking_attempt a échoué (ligne ${orderLineId}) — ${ctx.describe(clearError)}`);
        }
      },
      async recordReconciliation(orderLineId, detail) {
        const entry = { order_line_id: orderLineId, detail: ctx.redactLong(detail) };
        console.error(`pms-book-paid-orders : à traiter (ligne ${orderLineId}) — ${entry.detail}`);
        // Retentée une fois : pour une issue inconnue, cette entrée est la SEULE trace durable d'un
        // booking peut-être créé chez Lobby.
        for (let attempt = 1; attempt <= 2; attempt++) {
          const { error: insertError } = await supabase.from("pms_reconciliation_entries").insert(entry);
          if (!insertError) return;
          console.error(`pms-book-paid-orders : écriture de réconciliation impossible (tentative ${attempt}) — ${ctx.describe(insertError)}`);
        }
        console.error(`pms-book-paid-orders[RECONCILIATION_PERDUE] ligne ${orderLineId} — ${entry.detail}`);
      },
    };

    let result: BookResult;
    try {
      result = await bookClaimedOrder(
        { attribution_code: claim.attribution_code, attribution_source: claim.attribution_source, groups: claim.groups },
        store,
        { baseUrl, relaySecret, nextCallTimeout: ctx.nextCallTimeout, redact: ctx.redact }
      );
    } catch (err) {
      // Exception imprévue au milieu d'un booking : on ne sait pas ce que Lobby a reçu. Jamais
      // retentée automatiquement.
      result = { kind: "unknown", lineId: "", detail: `exception pendant le booking — ${ctx.describe(err)}`, warnings: [] };
    } finally {
      // Le bail est rendu quoi qu'il arrive ; à défaut il expire de lui-même au bout de 5 minutes.
      const { error: releaseError } = await supabase.rpc("release_pms_reserve_claim", {
        p_order_id: row.order_id,
        p_claimed_at: claimedAt,
      });
      if (releaseError) console.error(`pms-book-paid-orders : claim non rendu (commande ${row.order_id}) — ${ctx.describe(releaseError)}`);
    }

    switch (result.kind) {
      case "booked":
        stats.done++;
        await resolve(row, { p_outcome: "done" });
        break;
      case "refused":
        stats.failed++;
        await resolve(row, { p_outcome: "failed", p_error: ctx.redact(result.detail), p_order_line_id: result.lineId || null });
        break;
      case "unknown":
      case "unrecorded":
        stats.needs_human++;
        await resolve(row, { p_outcome: "needs_human", p_error: ctx.redact(result.detail), p_order_line_id: result.lineId || null });
        break;
      case "outage":
        stats.retried++;
        await resolve(row, { p_outcome: "retry", p_error: ctx.redact(result.detail), p_retry_after: retryAfter(row.attempts) });
        break;
      case "not_attempted":
      case "claim_lost":
        stats.deferred++;
        await resolve(row, { p_outcome: "retry", p_error: ctx.redact(result.detail), p_retry_after: "30 seconds", p_keep_attempt: false });
        break;
    }
  }

  const needsAttention = stats.failed + stats.needs_human;
  return {
    ok: problems.length === 0,
    error: problems.length > 0 ? `${problems.length} écriture(s) de la file en échec : ${[...new Set(problems)].join(", ")}` : null,
    // Une commande payée que Lobby n'a pas pu honorer est à traiter : elle n'est pas une panne du
    // job (`ok` n'en dépend pas) mais mérite d'être vue sur le bandeau des admins.
    warning: needsAttention > 0 ? `${needsAttention} commande(s) payée(s) à traiter à la main (Lobby a refusé ou issue inconnue)` : null,
    stats,
  };
}, {
  // Un POST /bookings part avec son délai complet (15 s) ou pas du tout (minCallMs) ; budget total
  // 45 s sous les 55 s du wrapper pg_net.
  budgetMs: 45_000,
  callTimeoutMs: 15_000,
  minCallMs: 15_000,
});
