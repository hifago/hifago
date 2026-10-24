// Réserve chez LobbyPMS une commande DÉJÀ PAYÉE et déjà « claimée » (claim_paid_order_for_pms_booking).
// Appelé par l'Edge Function pms-book-paid-orders — Deno ET Node (tests) : imports AVEC extension,
// aucun accès à l'environnement ni à la base. Tout ce qui touche la base passe par le `BookStore`
// injecté, tout ce qui touche le temps par `nextCallTimeout`.
//
// RETOURNEMENT DU 2026-10-23 (spec 21 §8.1) — Lobby est écrit APRÈS l'acompte, plus avant. Ce module
// remplace la logique de apps/web/app/api/pms/reserve-nights/route.ts, qui tournait avant le
// paiement et défaisait la commande sur un refus. Ici l'argent est déjà encaissé :
//   - un refus (400/422) ne défait RIEN : le résultat `refused` fait écrire une entrée de
//     réconciliation « commande PAYÉE — reloger ou rembourser à la main » (aucun remboursement
//     automatique, ils sont suspendus) ;
//   - les bookings déjà obtenus sont GARDÉS (D8) : une reprise ne réserve que les lignes sans booking.
//
// LES QUATRE ISSUES d'un appel de nuit (inchangées depuis le 29/08, elles ne se traitent pas pareil) :
//   - booking obtenu → enregistré ;
//   - REFUS (400/422 — la catégorie annoncée libre mais refusée en 422) ;
//   - PANNE (autre 4xx : relais, quota, jeton ; connexion jamais établie) → `outage`, on réessaiera ;
//   - ISSUE INCONNUE (timeout, 5xx, 2xx inexploitable, connexion coupée en vol) : Lobby n'a ni clé
//     d'idempotence ni recherche de booking, le booking a PU être créé. JAMAIS retentée
//     (`needs_human`) : la clé que l'hôte retrouve dans Lobby est la note « hifago order_line <id> ».
//
// LA REMISE (D1). Lobby n'a pas de champ remise, seulement `payment`. Il porte l'acompte RÉELLEMENT
// encaissé de la ligne (relu en base par le claim), plus la note « Anticipo pagado en hifago ». Si
// Lobby REFUSE explicitement (400/422) un booking portant `payment`, UN seul nouvel essai part sans
// `payment` : s'il passe, le booking existe sans la remise et une entrée « remise à saisir à la main »
// est écrite. Jamais de second essai après une issue inconnue (le booking a pu naître).
//
// ORDRE : toutes les NUITS d'abord, arrêt à la première qui échoue ; les ACTIVITÉS ensuite, seulement
// si toutes les nuits sont réservées. Une activité refusée ne bloque jamais la confirmation.
import { createLobbyBooking, addLobbyProductService } from "./lobbyClient.ts";
import { buildEvenRatesPerDay } from "./buildEvenRatesPerDay.ts";
import { buildLobbyBookingNote } from "./buildLobbyBookingNote.ts";
import { parseLobbyBookingResponse } from "./parseLobbyBookingResponse.ts";
import { describeLobbyErrorBody } from "./describeLobbyErrorBody.ts";

export interface ClaimedLodgingLine {
  id: string;
  product_id: string;
  date: string;
  end_date: string | null;
  qty: number;
  holder_name: string;
  holder_email: string | null;
  holder_phone: string | null;
  total_cop: number;
  /** Acompte encaissé pour cette ligne — relu en base par le claim, jamais envoyé par un client. */
  acompte_cop: number;
  lobby_category_id: number | null;
}

export interface ClaimedActivityLine {
  id: string;
  product_id: string;
  qty: number;
  lobby_product_id: number;
}

export interface ClaimedGroup {
  establishment_id: string;
  api_token: string;
  /** Booking d'une nuit DÉJÀ réservée lors d'un passage précédent (rattachement des activités). */
  primary_booking_id?: string | null;
  lodging_lines: ClaimedLodgingLine[];
  activity_lines: ClaimedActivityLine[];
}

export interface ClaimedOrder {
  attribution_code?: string | null;
  attribution_source?: string | null;
  groups: ClaimedGroup[];
}

export type RecordOutcome = "ok" | "claim_stale" | "already_booked" | "line_not_reserved" | "not_recorded";

/** Les écritures en base du passage — le claim (orderId, claimedAt) est déjà capturé par l'appelant. */
export interface BookStore {
  recordBooking(orderLineId: string, bookingId: string): Promise<RecordOutcome>;
  /** Une entrée pms_reconciliation_entries (et l'e-mail admin que son trigger envoie). */
  recordReconciliation(orderLineId: string, detail: string): Promise<void>;
}

export interface BookContext {
  baseUrl: string;
  relaySecret?: string;
  /** Délai du prochain appel, ou null : budget épuisé (l'appel ne part jamais tronqué). */
  nextCallTimeout(): number | null;
  /** Texte sûr à écrire/journaliser (secrets masqués). */
  redact(text: string): string;
}

export type BookResult =
  | { kind: "booked"; warnings: string[] }
  | { kind: "refused" | "outage" | "unknown" | "unrecorded" | "not_attempted"; lineId: string; detail: string; warnings: string[] }
  // Le bail a été repris par un autre appel : celui-ci s'arrête sans rien conclure.
  | { kind: "claim_lost"; lineId: string; detail: string; warnings: string[] };

// Erreurs de la phase de connexion (undici sous Node, Deno) : la requête n'est jamais partie.
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

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error.cause as { code?: string } | undefined)?.code;
    return `${error.name} : ${error.message}${code ? ` (${code})` : ""}`;
  }
  return String(error);
}

function describeResponse(ctx: BookContext, status: number, body: unknown): string {
  return `HTTP ${status} — ${describeLobbyErrorBody(body, ctx.redact)}`;
}

type NightAttempt =
  | { ok: true; bookingId: number; withoutPayment: boolean }
  | { ok: false; kind: "refused" | "outage" | "unknown"; detail: string };

// Un POST /bookings, avec son éventuel second essai sans `payment`. La note ne porte que la clé de la
// ligne dans les détails d'erreur — la note complète porte les coordonnées du client.
async function bookNight(
  ctx: BookContext,
  group: ClaimedGroup,
  line: ClaimedLodgingLine,
  order: ClaimedOrder,
  timeouts: () => number | null
): Promise<NightAttempt | { ok: false; kind: "not_attempted"; detail: string }> {
  const payment = Math.min(Math.max(Math.round(line.acompte_cop), 0), line.total_cop);
  const input = {
    categoryId: line.lobby_category_id as number,
    startDate: line.date,
    endDate: line.end_date as string,
    totalAdults: line.qty,
    holderName: line.holder_name,
    ratesPerDay: buildEvenRatesPerDay(line.date, line.end_date as string, line.total_cop),
    note: buildLobbyBookingNote({
      orderLineId: line.id,
      promoCode: order.attribution_code ?? null,
      phone: line.holder_phone,
      email: line.holder_email,
      source: order.attribution_source ?? null,
      advancePaidCop: payment > 0 ? payment : null,
      balanceCop: payment > 0 ? line.total_cop - payment : null,
    }),
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const withPayment = attempt === 1 && payment > 0;
    const timeoutMs = timeouts();
    if (timeoutMs === null) return { ok: false, kind: "not_attempted", detail: "nuit non tentée : budget de temps épuisé" };

    let response: Awaited<ReturnType<typeof createLobbyBooking>>;
    try {
      response = await createLobbyBooking(
        ctx.baseUrl,
        group.api_token,
        withPayment ? { ...input, payment } : input,
        ctx.relaySecret,
        timeoutMs
      );
    } catch (error) {
      const code = error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined;
      if (code && CONNECT_ERROR_CODES.has(code)) {
        return { ok: false, kind: "outage", detail: `POST /bookings jamais envoyé (${ctx.redact(describeError(error))})` };
      }
      return {
        ok: false,
        kind: "unknown",
        // La clé d'abord : les textes d'erreur sont tronqués, jamais l'identifiant qui sert à retrouver le booking.
        detail: `booking PEUT-ÊTRE créé chez Lobby, à vérifier par la note « hifago order_line ${line.id} » — POST /bookings sans réponse (${ctx.redact(describeError(error))})`,
      };
    }

    const parsed = parseLobbyBookingResponse(response.body);
    if (parsed) return { ok: true, bookingId: parsed.bookingId, withoutPayment: attempt === 2 };

    const described = describeResponse(ctx, response.status, response.body);
    if (response.status === 400 || response.status === 422) {
      // Refus explicite : aucun booking n'a été créé. Avec `payment`, UN nouvel essai sans lui.
      if (withPayment) continue;
      return { ok: false, kind: "refused", detail: `POST /bookings refusé — ${described}` };
    }
    if (response.status >= 400 && response.status < 500) {
      return { ok: false, kind: "outage", detail: `POST /bookings rejeté avant Lobby — ${described}` };
    }
    return {
      ok: false,
      kind: "unknown",
      detail: `booking PEUT-ÊTRE créé chez Lobby, à vérifier par la note « hifago order_line ${line.id} » — POST /bookings sans booking_id exploitable — ${described}`,
    };
  }
  // Inatteignable : la boucle rend toujours. Échec fermé par prudence.
  return { ok: false, kind: "outage", detail: "POST /bookings : boucle de reprise épuisée" };
}

export async function bookClaimedOrder(
  order: ClaimedOrder,
  store: BookStore,
  ctx: BookContext
): Promise<BookResult> {
  const warnings: string[] = [];
  const primaryBookings = new Map<string, string>();
  for (const group of order.groups) {
    if (group.primary_booking_id) primaryBookings.set(group.establishment_id, group.primary_booking_id);
  }

  // ── Phase 1 : les nuits, arrêt au premier échec ────────────────────────────────────────────────
  for (const group of order.groups) {
    for (const line of group.lodging_lines) {
      if (!line.end_date || line.lobby_category_id == null) {
        return {
          kind: "refused",
          lineId: line.id,
          detail: `ligne inexploitable : end_date=${line.end_date ?? "null"}, lobby_category_id=${line.lobby_category_id ?? "null"}`,
          warnings,
        };
      }

      const attempt = await bookNight(ctx, group, line, order, ctx.nextCallTimeout);
      if (!attempt.ok) {
        if (attempt.kind === "unknown") {
          // TOUT DE SUITE, avant de rendre la main : si la plateforme coupait la fonction avant la
          // résolution de la demande, cette entrée serait la SEULE trace du booking peut-être créé
          // (resolve_pms_booking_request n'en écrit pas de seconde sur la même ligne).
          await store.recordReconciliation(line.id, `commande PAYÉE — issue inconnue — ${attempt.detail}`);
        }
        return { kind: attempt.kind, lineId: line.id, detail: attempt.detail, warnings };
      }

      const bookingId = String(attempt.bookingId);
      if (attempt.withoutPayment) {
        const paid = Math.min(Math.max(Math.round(line.acompte_cop), 0), line.total_cop);
        const detail = `remise à saisir à la main dans Lobby : le booking ${bookingId} a été créé SANS le paiement de ${paid} COP (Lobby a refusé le champ payment) — le client a déjà payé cet acompte à hifago`;
        warnings.push(detail);
        await store.recordReconciliation(line.id, detail);
      }

      const outcome = await store.recordBooking(line.id, bookingId);
      if (outcome === "ok") {
        if (!primaryBookings.has(group.establishment_id)) primaryBookings.set(group.establishment_id, bookingId);
        continue;
      }
      if (outcome === "claim_stale") {
        // Le bail a expiré et un autre appel a repris la commande : ce booking est déjà parti en file
        // d'annulation. On s'arrête sans rien conclure — c'est l'autre appel qui conclut.
        return { kind: "claim_lost", lineId: line.id, detail: `claim perdu — booking ${bookingId} mis en annulation`, warnings };
      }
      if (outcome === "already_booked") {
        // La ligne porte déjà un AUTRE booking : celui-ci, surnuméraire, est en file d'annulation. La
        // nuit est réservée, mais pas par ce booking : il ne sert jamais de booking principal.
        continue;
      }
      if (outcome === "line_not_reserved") {
        // La ligne est morte entre-temps (annulée après le paiement) ; le booking est en file
        // d'annulation. Les autres lignes de la commande se réservent normalement.
        warnings.push(`ligne ${line.id} plus réservée au retour de Lobby — booking ${bookingId} mis en annulation`);
        continue;
      }
      await store.recordReconciliation(line.id, `commande PAYÉE — booking ${bookingId} créé chez Lobby mais NON enregistré en base — à annuler à la main`);
      return {
        kind: "unrecorded",
        lineId: line.id,
        detail: `booking ${bookingId} créé chez Lobby mais NON enregistré en base — à annuler à la main`,
        warnings,
      };
    }
  }

  // ── Phase 2 : les activités, seulement si toutes les nuits sont réservées ──────────────────────
  for (const group of order.groups) {
    const primaryBookingId = primaryBookings.get(group.establishment_id);
    for (const line of group.activity_lines) {
      if (primaryBookingId === undefined) {
        // Aucune nuit pour cet établissement : Lobby n'accepte pas de vente de service isolée
        // (add-product-service exige un vrai booking) — limite connue, pas un incident.
        warnings.push(`service Lobby non reflété (order_line ${line.id}) — aucune nuit dans la commande pour cet établissement`);
        continue;
      }
      const timeoutMs = ctx.nextCallTimeout();
      if (timeoutMs === null) {
        await store.recordReconciliation(line.id, `service non ajouté au booking ${primaryBookingId} : budget de temps épuisé`);
        continue;
      }
      try {
        const response = await addLobbyProductService(
          ctx.baseUrl,
          group.api_token,
          Number(primaryBookingId),
          [{ productId: line.lobby_product_id, qty: line.qty }],
          ctx.relaySecret,
          timeoutMs
        );
        if (response.status !== 200) {
          await store.recordReconciliation(
            line.id,
            `add-product-service refusé — ${describeResponse(ctx, response.status, response.body)}`
          );
          continue;
        }
        const outcome = await store.recordBooking(line.id, primaryBookingId);
        if (outcome !== "ok") {
          await store.recordReconciliation(
            line.id,
            `service ajouté au booking ${primaryBookingId} mais non enregistré sur la ligne (${outcome})`
          );
        }
      } catch (error) {
        await store.recordReconciliation(
          line.id,
          `add-product-service sans réponse (${ctx.redact(describeError(error))}) — service PEUT-ÊTRE ajouté au booking ${primaryBookingId}`
        );
      }
    }
  }

  return { kind: "booked", warnings };
}
