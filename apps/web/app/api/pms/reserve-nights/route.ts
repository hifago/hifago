import {
  addLobbyProductService,
  buildEvenRatesPerDay,
  buildLobbyBookingNote,
  createLobbyBooking,
  LOBBY_DEFAULT_BASE_URL,
  parseLobbyBookingResponse,
} from "@hifago/domain";
import { createServiceRoleClient } from "@hifago/supabase/service";

// Spec 21 §0/§7 — appelé par CheckoutForm.tsx juste après un create_order réussi (précédent exact :
// apps/web/app/api/payments/create/route.ts). service_role ; le seul input de confiance est
// l'orderId, tout le reste est relu en base — aucune vérification auth.getUser() ici, create_order a
// déjà entièrement statué sur l'autorisation de la réservation elle-même.
//
// ⚠️ INVARIANT RETOURNÉ LE 2026-08-29. Cette route est ATTENDUE, avant confirmation visible et avant
// tout encaissement (spec 21 §8 : « échec fermé uniquement AVANT confirmation »), et elle rend un
// VERDICT.
//
// LE FAIT QUI A DÉCIDÉ (spec 24 §11.2) : deux catégories du compte réel (49823, 18013) refusent
// `POST /bookings` en 422 tout en affichant une disponibilité NON NULLE, et C1 est RÉFUTÉ —
// `available-rooms` les cote comme les autres. Aucune lecture ne peut prédire le refus : seul
// l'appel d'écriture le révèle.
//
// LE CLAIM (migration 20260930221837) — trois temps, chacun sa transaction, jamais un verrou tenu
// pendant l'appel à LobbyPMS :
//   1. claim_order_for_pms_booking relit tout (lignes, produits, connecteur, jeton) sous le verrou
//      de la commande et pose un bail de 5 min : un seul appel à la fois réserve une commande ;
//   2. LobbyPMS, ligne par ligne, dans un budget de temps global ;
//   3. record_pms_booking enregistre chaque booking SOUS le claim (son horodatage sert de jeton) ;
//      un booking qu'aucune ligne vivante ne peut porter part en file d'annulation, jamais perdu.
// Le claim est rendu en `finally`.
//
// ORDRE : toutes les NUITS d'abord, arrêt à la première qui échoue (la commande sera défaite de
// toute façon : réserver les suivantes ne ferait que créer des bookings à annuler) ; les ACTIVITÉS
// ensuite, seulement si toutes les nuits sont réservées. Une activité refusée ne défait jamais la
// commande : la nuit existe chez le partenaire, on réconcilie l'extra (pms_reconciliation_entries).
// Une activité sans nuit pour son établissement n'est jamais vendue à Lobby (limite connue : pas de
// vente de service isolée).
//
// QUATRE ISSUES pour un appel de nuit, et elles ne se traitent pas pareil :
//   - booking obtenu → enregistré ;
//   - REFUS (400/422 — le 422 ci-dessus) : aucun booking créé, la commande est défaite, rien n'est
//     écrit en réconciliation (un incident défait n'est pas « à traiter ») ;
//   - PANNE (autre 4xx : relais, quota, jeton ; connexion jamais établie) : aucun booking créé non
//     plus, la commande est défaite, motif `pms_unreachable` — jamais présenté au client comme une
//     indisponibilité — et une ligne de journal à marqueur fixe pour l'alerte ;
//   - ISSUE INCONNUE (timeout, 5xx, 2xx inexploitable, connexion coupée en vol) : LobbyPMS n'a ni
//     clé d'idempotence ni recherche de booking, le booking a PU être créé et son id est perdu. La
//     commande est défaite comme sur un refus, MAIS une entrée de réconciliation est écrite TOUT DE
//     SUITE (une coupure de la plateforme plus tard ne doit pas l'emporter), avec la clé que l'hôte
//     retrouve dans Lobby : la note « hifago order_line <id> ».
//
// Chaque établissement PMS-backed de la commande a son propre booking et ses propres activités
// (cahier des charges client §5).
export const runtime = "nodejs";
// Une commande à plusieurs nuits enchaîne plusieurs appels LobbyPMS : le budget ci-dessous garantit
// que la route conclut (relâche, écrit, rend le claim) AVANT que la plateforme ne la coupe.
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// maxDuration (60 s) moins une marge pour relâcher la commande, écrire en réconciliation et rendre
// le claim — jamais dépassé, même par la variable d'environnement des tests.
const MAX_BUDGET_MS = 50_000;
const DEFAULT_CALL_TIMEOUT_MS = 15_000;
// Erreurs de la phase de connexion (undici sous Node) : la requête n'est jamais partie.
const CONNECT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

interface ClaimedLodgingLine {
  id: string;
  product_id: string;
  date: string;
  end_date: string | null;
  qty: number;
  holder_name: string;
  holder_email: string | null;
  holder_phone: string | null;
  total_cop: number;
  lobby_category_id: number | null;
}

interface ClaimedActivityLine {
  id: string;
  product_id: string;
  qty: number;
  lobby_product_id: number;
}

interface ClaimedGroup {
  establishment_id: string;
  api_token: string;
  lodging_lines: ClaimedLodgingLine[];
  activity_lines: ClaimedActivityLine[];
}

type ClaimResult =
  | {
      ok: true;
      claimed_at: string | null;
      attribution_code?: string | null;
      attribution_source?: string | null;
      groups: ClaimedGroup[];
    }
  | { ok: false; reason: string };

type Service = ReturnType<typeof createServiceRoleClient>;

// refused : aucun booking, motif métier ; system : aucun booking, panne ; not_attempted : budget
// épuisé, aucun appel envoyé ; unknown / unrecorded : un booking existe ou a pu être créé chez Lobby
// sans qu'aucune ligne ne le porte — les seuls qui demandent un humain.
type FailureKind = "refused" | "system" | "not_attempted" | "unknown" | "unrecorded";

interface LodgingFailure {
  lineId: string;
  detail: string;
  kind: FailureKind;
}

const needsHuman = (kind: FailureKind) => kind === "unknown" || kind === "unrecorded";

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ⚠️ SEULEMENT des corps de réponse, jamais l'URL de la requête : elle porte `api_token` en query
// string (hifago/CLAUDE.md §8). Et si un corps renvoyait la requête en écho, le jeton y est masqué.
function describeLobbyResponse(status: number, body: unknown): string {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const masked = (text || "corps vide").replace(/("api_token"\s*:\s*")[^"]*"/g, '$1***"');
  return `HTTP ${status} — ${masked}`;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error.cause as { code?: string } | undefined)?.code;
    return `${error.name} : ${error.message}${code ? ` (${code})` : ""}`;
  }
  return String(error);
}

// `detail` répond à « pourquoi » dans l'écran de réconciliation. Une écriture qui échoue est
// retentée une fois : sur les issues inconnues, cette entrée est la SEULE trace durable d'un booking
// peut-être créé chez Lobby. Si elle échoue encore, la ligne de journal à marqueur fixe reste.
async function recordFailure(service: Service, orderLineId: string, detail: string) {
  const entry = { order_line_id: orderLineId, detail: truncate(detail) };
  console.error(`reserve-nights : échec PMS (order_line ${orderLineId}) — ${entry.detail}`);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { error } = await service.from("pms_reconciliation_entries").insert(entry);
    if (!error) return;
    console.error(`reserve-nights : écriture de réconciliation impossible (tentative ${attempt})`, error);
  }
  console.error(`reserve-nights[RECONCILIATION_PERDUE] order_line ${orderLineId} — ${entry.detail}`);
}

type RecordOutcome = "ok" | "claim_stale" | "already_booked" | "line_not_reserved" | "not_recorded";

// Une nouvelle tentative si l'APPEL échoue (réseau, base) : le booking existe déjà chez Lobby, le
// perdre serait pire qu'un aller-retour de plus. record_pms_booking est idempotent sur le même id.
async function recordBooking(
  service: Service,
  orderId: string,
  claimedAt: string,
  orderLineId: string,
  bookingId: string
): Promise<RecordOutcome> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data, error } = await service.rpc("record_pms_booking", {
      p_order_id: orderId,
      p_claimed_at: claimedAt,
      p_order_line_id: orderLineId,
      p_pms_booking_id: bookingId,
    });
    if (error) {
      console.error(`reserve-nights : record_pms_booking a échoué (tentative ${attempt}, order_line ${orderLineId})`, error);
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
}

async function releaseOrder(service: Service, orderId: string, reason: string): Promise<boolean> {
  const { data, error } = await service.rpc("release_order_after_pms_refusal", {
    p_order_id: orderId,
    p_reason: truncate(reason),
  });
  const ok = !error && (data as { ok?: boolean } | null)?.ok === true;
  if (!ok) {
    console.error(`reserve-nights : relâchement IMPOSSIBLE (order ${orderId})`, error ?? data);
  }
  return ok;
}

// Toute réponse d'échec porte `released` : c'est le champ que CheckoutForm lit pour choisir son
// message (« fechas liberadas » vs « estamos liberando »).
function failure(status: number, reason: string, released: boolean, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, reason, released, ...extra }, { status });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let body: { orderId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const orderId = body.orderId;
  if (typeof orderId !== "string" || !UUID_PATTERN.test(orderId)) {
    return Response.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const service = createServiceRoleClient();

  const { data: claimData, error: claimError } = await service.rpc("claim_order_for_pms_booking", {
    p_order_id: orderId,
  });
  if (claimError || !claimData) {
    // Rien n'a été touché : pas de verdict possible, et surtout pas `ok:true`.
    console.error(`reserve-nights : claim impossible (order ${orderId})`, claimError);
    return failure(503, "db_error", false);
  }

  const claim = claimData as ClaimResult;
  if (!claim.ok) {
    switch (claim.reason) {
      case "order_not_found":
        return failure(404, "order_not_found", false);
      case "order_not_active":
        // Plus aucune ligne vivante : la commande a déjà été défaite (refus, expiration). Jamais un
        // succès.
        return failure(409, "order_not_active", true);
      case "order_paid":
        return failure(409, "order_paid", false);
      case "claim_in_progress":
        return failure(409, "pms_claim_in_progress", false);
      case "order_expiring":
        // Trop tard pour payer (migration 20261001194704 : limite de paiement − bail). Rien n'a été
        // réservé, et la commande n'est PAS défaite ici : release_order_after_pms_refusal écrirait
        // `cancelled_by_provider`, faux — le prestataire n'a rien refusé. L'expiration posera le
        // vrai statut, `expired`.
        return failure(409, "order_expiring", false);
      case "pms_unavailable": {
        // CLAUDE.md §4.4 : le connecteur de l'établissement a été coupé entre create_order et ici.
        // Aucun contrôle de capacité n'est possible pour ce logement → la commande est défaite.
        const released = await releaseOrder(service, orderId, "connecteur LobbyPMS coupé (pms_unavailable)");
        return failure(409, "pms_unavailable", released);
      }
      default:
        console.error(`reserve-nights : claim refusé pour un motif inattendu (order ${orderId})`, claim.reason);
        return failure(503, "db_error", false);
    }
  }

  if (claim.claimed_at === null || claim.groups.length === 0) {
    // Commande vivante sans rien à réserver chez Lobby (aucune ligne PMS sans booking).
    return Response.json({ ok: true });
  }

  const claimedAt = claim.claimed_at;
  try {
    return await reserveClaimedOrder(service, orderId, claimedAt, claim, startedAt);
  } finally {
    const { error } = await service.rpc("release_pms_reserve_claim", {
      p_order_id: orderId,
      p_claimed_at: claimedAt,
    });
    if (error) {
      // Best-effort : un claim non rendu expire de lui-même au bout de 5 minutes.
      console.error(`reserve-nights : claim non rendu (order ${orderId})`, error);
    }
  }
}

function positiveEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function reserveClaimedOrder(
  service: Service,
  orderId: string,
  claimedAt: string,
  claim: Extract<ClaimResult, { ok: true }>,
  startedAt: number
): Promise<Response> {
  const baseUrl = process.env.LOBBY_API_BASE_URL || LOBBY_DEFAULT_BASE_URL;
  const relaySecret = process.env.LOBBY_RELAY_SECRET;
  // Les deux variables ne servent qu'aux tests (valeurs courtes) ; en production, les défauts.
  const callTimeoutMs = positiveEnv("LOBBY_RESERVE_TIMEOUT_MS", DEFAULT_CALL_TIMEOUT_MS);
  const deadline = startedAt + Math.min(positiveEnv("LOBBY_RESERVE_BUDGET_MS", MAX_BUDGET_MS), MAX_BUDGET_MS);
  // Un appel part avec son délai COMPLET ou ne part pas : jamais raccourci pour tenir le budget. Un
  // appel coupé par notre propre délai est une issue INCONNUE (booking peut-être créé) ; un appel
  // jamais envoyé est un échec net.
  const nextCallTimeout = (): number | null => (deadline - Date.now() >= callTimeoutMs ? callTimeoutMs : null);

  let failed: LodgingFailure | null = null;
  const fail = async (entry: LodgingFailure): Promise<LodgingFailure> => {
    if (needsHuman(entry.kind)) {
      // TOUT DE SUITE : si la plateforme coupait la fonction plus loin, cette trace resterait.
      await recordFailure(service, entry.lineId, entry.detail);
    } else if (entry.kind === "system") {
      console.error(`reserve-nights[LOBBY_INDISPONIBLE] order ${orderId} — ${truncate(entry.detail)}`);
    }
    return entry;
  };

  // ── Phase 1 : les nuits, arrêt au premier échec ──────────────────────────────────────────────
  const primaryBookings = new Map<string, number>();
  nights: for (const group of claim.groups) {
    for (const line of group.lodging_lines) {
      if (!line.end_date || line.lobby_category_id == null) {
        failed = await fail({
          lineId: line.id,
          detail: `ligne inexploitable : end_date=${line.end_date ?? "null"}, lobby_category_id=${line.lobby_category_id ?? "null"}`,
          kind: "refused",
        });
        break nights;
      }

      const timeoutMs = nextCallTimeout();
      if (timeoutMs === null) {
        failed = await fail({ lineId: line.id, detail: "nuit non tentée : budget de temps épuisé", kind: "not_attempted" });
        break nights;
      }

      let response: Awaited<ReturnType<typeof createLobbyBooking>>;
      try {
        response = await createLobbyBooking(
          baseUrl,
          group.api_token,
          {
            categoryId: line.lobby_category_id,
            startDate: line.date,
            endDate: line.end_date,
            totalAdults: line.qty,
            holderName: line.holder_name,
            ratesPerDay: buildEvenRatesPerDay(line.date, line.end_date, line.total_cop),
            note: buildLobbyBookingNote({
              orderLineId: line.id,
              promoCode: claim.attribution_code ?? null,
              phone: line.holder_phone,
              email: line.holder_email,
              source: claim.attribution_source ?? null,
            }),
          },
          relaySecret,
          timeoutMs
        );
      } catch (error) {
        const code = error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined;
        if (code && CONNECT_ERROR_CODES.has(code)) {
          failed = await fail({
            lineId: line.id,
            detail: `POST /bookings jamais envoyé (${describeError(error)})`,
            kind: "system",
          });
        } else {
          // La requête est partie : Lobby a pu créer le booking. Seule la clé de la note figure ici —
          // la note complète porte les coordonnées du client.
          failed = await fail({
            lineId: line.id,
            detail: `POST /bookings sans réponse (${describeError(error)}) — booking PEUT-ÊTRE créé chez Lobby, à vérifier par la note « hifago order_line ${line.id} »`,
            kind: "unknown",
          });
        }
        break nights;
      }

      const parsed = parseLobbyBookingResponse(response.body);
      if (!parsed) {
        const described = describeLobbyResponse(response.status, response.body);
        if (response.status === 400 || response.status === 422) {
          // LE cas du 422 : Lobby cote la catégorie comme disponible et refuse de la réserver.
          failed = await fail({ lineId: line.id, detail: `POST /bookings refusé — ${described}`, kind: "refused" });
        } else if (response.status >= 400 && response.status < 500) {
          failed = await fail({ lineId: line.id, detail: `POST /bookings rejeté avant Lobby — ${described}`, kind: "system" });
        } else {
          failed = await fail({
            lineId: line.id,
            detail: `POST /bookings sans booking_id exploitable — ${described} — booking PEUT-ÊTRE créé chez Lobby, à vérifier par la note « hifago order_line ${line.id} »`,
            kind: "unknown",
          });
        }
        break nights;
      }

      const bookingId = String(parsed.bookingId);
      const outcome = await recordBooking(service, orderId, claimedAt, line.id, bookingId);
      if (outcome === "ok") {
        if (!primaryBookings.has(group.establishment_id)) primaryBookings.set(group.establishment_id, parsed.bookingId);
        continue;
      }
      if (outcome === "claim_stale") {
        // Le bail a expiré et un autre appel a repris la commande : ce booking est déjà parti en
        // file d'annulation. On s'arrête sans rien défaire — c'est l'autre appel qui conclut.
        console.error(`reserve-nights : claim perdu (order ${orderId}) — arrêt, booking ${bookingId} mis en annulation`);
        return failure(409, "pms_claim_in_progress", false);
      }
      if (outcome === "already_booked") {
        // La ligne porte déjà un AUTRE booking : celui-ci, surnuméraire, est en file d'annulation.
        // La nuit est réservée, mais pas par ce booking : il ne sert jamais de booking principal.
        continue;
      }
      if (outcome === "line_not_reserved") {
        // La ligne est morte entre-temps (expirée, annulée) ; le booking est en file d'annulation.
        failed = await fail({
          lineId: line.id,
          detail: `ligne plus réservée au retour de Lobby — booking ${bookingId} mis en annulation`,
          kind: "refused",
        });
        break nights;
      }
      // not_recorded : le booking existe chez Lobby et AUCUNE ligne ne le porte.
      failed = await fail({
        lineId: line.id,
        detail: `booking ${bookingId} créé chez Lobby mais NON enregistré en base — à annuler à la main`,
        kind: "unrecorded",
      });
      break nights;
    }
  }

  if (failed === null) {
    // ── Phase 2 : les activités, seulement si toutes les nuits sont réservées ──────────────────
    for (const group of claim.groups) {
      const primaryBookingId = primaryBookings.get(group.establishment_id);
      for (const line of group.activity_lines) {
        if (primaryBookingId === undefined) {
          // Aucune nuit dans la commande pour cet établissement : vendre un service Lobby seul est
          // structurellement impossible (add-product-service exige un vrai booking) — pas un
          // incident, une limite connue, donc aucune entrée (un e-mail à chaque admin par vente).
          console.warn(
            `reserve-nights : service Lobby non reflété (order_line ${line.id}) — aucune nuit dans la commande pour cet établissement, Lobby n'accepte pas de vente de service isolée`
          );
          continue;
        }
        const timeoutMs = nextCallTimeout();
        if (timeoutMs === null) {
          await recordFailure(service, line.id, `service non ajouté au booking ${primaryBookingId} : budget de temps épuisé`);
          continue;
        }
        try {
          const response = await addLobbyProductService(
            baseUrl,
            group.api_token,
            primaryBookingId,
            [{ productId: line.lobby_product_id, qty: line.qty }],
            relaySecret,
            timeoutMs
          );
          if (response.status !== 200) {
            await recordFailure(
              service,
              line.id,
              `add-product-service refusé — ${describeLobbyResponse(response.status, response.body)}`
            );
            continue;
          }
          const outcome = await recordBooking(service, orderId, claimedAt, line.id, String(primaryBookingId));
          if (outcome !== "ok") {
            await recordFailure(
              service,
              line.id,
              `service ajouté au booking ${primaryBookingId} mais non enregistré sur la ligne (${outcome})`
            );
          }
        } catch (error) {
          await recordFailure(
            service,
            line.id,
            `add-product-service sans réponse (${describeError(error)}) — service PEUT-ÊTRE ajouté au booking ${primaryBookingId}`
          );
        }
      }
    }
    return Response.json({ ok: true });
  }

  // ── ÉCHEC D'UNE NUIT : on défait, on n'encaisse pas ──────────────────────────────────────────
  const failure0 = failed;
  console.error(`reserve-nights : nuit sans booking (order ${orderId}) — relâchement — ${truncate(failure0.detail)}`);
  const released = await releaseOrder(service, orderId, failure0.detail);
  if (!released && !needsHuman(failure0.kind)) {
    // Non relâchée (refus de la base, commande payée entre-temps…) : c'est le seul cas qui laisse
    // une commande pendante, un humain doit le voir. Le filet reste expire_payment_order (30 min),
    // qui annulera au passage les bookings déjà créés.
    await recordFailure(service, failure0.lineId, `${failure0.detail} — relâchement impossible`);
  }

  // 409 et non 200 : refus, panne ou issue inconnue chez le prestataire — jamais un succès. Seul un
  // vrai refus est présenté comme une indisponibilité.
  const reason = failure0.kind === "refused" ? "pms_refused" : "pms_unreachable";
  return failure(409, reason, released);
}
