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
// ⚠️ INVARIANT RETOURNÉ LE 2026-08-29. Cette route était fire-and-forget APRÈS confirmation, et
// répondait donc toujours `200 {ok:true}` : « un échec PMS ne défait jamais une réservation déjà
// confirmée ». Elle est désormais ATTENDUE, avant confirmation visible et avant tout encaissement
// (spec 21 §8 : « échec fermé uniquement AVANT confirmation »), et elle rend un VERDICT.
//
// LE FAIT QUI A DÉCIDÉ (spec 24 §11.2) : deux catégories du compte réel (49823, 18013) refusent
// `POST /bookings` en 422 tout en affichant une disponibilité NON NULLE, et C1 est RÉFUTÉ —
// `available-rooms` les cote comme les autres. Aucune lecture ne peut prédire le refus : seul
// l'appel d'écriture le révèle.
//
// LE CLAIM (migration 20260930221837) — trois temps, chacun sa transaction, jamais un verrou tenu
// pendant l'appel à LobbyPMS :
//   1. claim_order_for_pms_booking : relit TOUT (lignes, produits, connecteur, jeton) sous le
//      verrou de la commande et pose un bail de 5 min. Avant, quatre lectures séparées dont aucune
//      ne lisait son `error` répondaient `{ok:true}` sur une panne, et deux POST simultanés
//      créaient deux bookings — le surnuméraire, qu'aucune ligne ne référençait, n'était jamais
//      annulé ;
//   2. LobbyPMS, ligne par ligne ;
//   3. record_pms_booking : enregistre chaque booking SOUS le claim (son horodatage sert de jeton) ;
//      un booking qu'aucune ligne vivante ne peut porter part en file d'annulation, jamais perdu.
// Le claim est rendu en `finally`, quoi qu'il arrive.
//
// CE QUI DÉCLENCHE UN RELÂCHEMENT, et ce qui n'en déclenche pas :
//   - une NUIT qui n'obtient pas son booking → la commande entière est défaite
//     (release_order_after_pms_refusal), rien n'est encaissé, les places non-PMS sont rendues ;
//   - une ACTIVITÉ refusée alors que sa nuit est bien réservée → surtout PAS de relâchement : la
//     nuit existe chez le partenaire, l'annuler pour un extra serait pire que le défaut. On garde
//     l'ancien chemin (pms_reconciliation_entries), qui est exactement fait pour ça ;
//   - une activité SANS aucune nuit dans cette commande pour cet établissement → ni l'un ni
//     l'autre : Lobby n'accepte pas de vente de service isolée, c'est une limite connue.
//
// ISSUE INCONNUE (timeout, coupure réseau) : LobbyPMS n'a ni clé d'idempotence ni recherche de
// booking. Un `POST /bookings` sans réponse a PU créer le booking, et son id est perdu : la commande
// est relâchée comme sur un refus, MAIS une entrée de réconciliation est écrite quand même, avec la
// clé que l'hôte retrouve dans Lobby (la note « hifago order_line <id> »). Seul un humain peut
// vérifier.
//
// Chaque établissement PMS-backed de la commande est traité INDÉPENDAMMENT (cahier des charges
// client §5) : son propre booking, ses propres activités rattachées.
export const runtime = "nodejs";
// Une commande à plusieurs nuits enchaîne plusieurs appels LobbyPMS de 15 s au plus : sans ce
// plafond explicite, la plateforme couperait la fonction avant les timeouts.
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// `detail` répond à « pourquoi », que cette entrée ne disait pas jusqu'au 2026-08-27 : l'e-mail
// envoyé à chaque admin (notify_all_admins) et l'écran de réconciliation disaient « quelque chose a
// échoué » sans plus.
//
// ⚠️ SEULEMENT des corps de réponse, jamais l'URL de la requête : elle porte `api_token` en query
// string (hifago/CLAUDE.md §8). Tronqué à 300 caractères.
async function recordFailure(service: Service, orderLineId: string, detail: string) {
  console.error(`reserve-nights : échec PMS (order_line ${orderLineId}) — ${detail}`);
  await service.from("pms_reconciliation_entries").insert({
    order_line_id: orderLineId,
    detail: detail.length > 300 ? `${detail.slice(0, 300)}…` : detail,
  });
}

function describeLobbyResponse(status: number, body: unknown): string {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return `HTTP ${status} — ${text || "corps vide"}`;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name} : ${error.message}`;
  return String(error);
}

interface LodgingFailure {
  lineId: string;
  detail: string;
  // Vrai quand un booking existe (ou a pu être créé) chez Lobby sans être porté par une ligne :
  // l'entrée de réconciliation est alors écrite MÊME si la commande est relâchée.
  needsHuman: boolean;
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
    p_reason: reason.slice(0, 300),
  });
  const ok = !error && (data as { ok?: boolean } | null)?.ok === true;
  if (!ok) {
    console.error(`reserve-nights : relâchement IMPOSSIBLE (order ${orderId})`, error ?? data);
  }
  return ok;
}

// Toute réponse d'échec porte `released` : c'est le seul champ que CheckoutForm lit pour choisir
// son message (« fechas liberadas » vs « estamos liberando »).
function failure(status: number, reason: string, released: boolean, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, reason, released, ...extra }, { status });
}

export async function POST(request: Request) {
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
      case "order_paid":
        return failure(409, "order_paid", false);
      case "claim_in_progress":
        return failure(409, "pms_claim_in_progress", false);
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
    // Rien à réserver chez Lobby (aucune ligne PMS-backed sans booking) — pas une erreur.
    return Response.json({ ok: true });
  }

  const claimedAt = claim.claimed_at;
  try {
    return await reserveClaimedOrder(service, orderId, claimedAt, claim);
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

async function reserveClaimedOrder(
  service: Service,
  orderId: string,
  claimedAt: string,
  claim: Extract<ClaimResult, { ok: true }>
): Promise<Response> {
  const baseUrl = process.env.LOBBY_API_BASE_URL || LOBBY_DEFAULT_BASE_URL;
  const relaySecret = process.env.LOBBY_RELAY_SECRET;
  const timeoutMs = Number(process.env.LOBBY_RESERVE_TIMEOUT_MS) || 15_000;

  // Les échecs de NUIT sont collectés, pas enregistrés au fil de l'eau : si la commande est
  // relâchée juste après, insérer dans pms_reconciliation_entries déclencherait notify_all_admins
  // (sans dédup) pour un incident déjà défait — sauf `needsHuman`, cf. plus bas.
  const lodgingFailures: LodgingFailure[] = [];

  for (const group of claim.groups) {
    let primaryBookingId: number | null = null;

    for (const line of group.lodging_lines) {
      if (!line.end_date || line.lobby_category_id == null) {
        lodgingFailures.push({
          lineId: line.id,
          detail: `ligne inexploitable : end_date=${line.end_date ?? "null"}, lobby_category_id=${line.lobby_category_id ?? "null"}`,
          needsHuman: false,
        });
        continue;
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
        // Timeout ou coupure APRÈS l'envoi : Lobby a pu créer le booking. Jamais traité comme un
        // simple refus — un humain doit vérifier dans Lobby, par la clé de la note (sans les
        // coordonnées du client, qui n'ont rien à faire dans un e-mail admin).
        lodgingFailures.push({
          lineId: line.id,
          detail: `POST /bookings sans réponse (${describeError(error)}) — booking PEUT-ÊTRE créé chez Lobby, à vérifier par la note « hifago order_line ${line.id} »`,
          needsHuman: true,
        });
        continue;
      }

      const parsed = parseLobbyBookingResponse(response.body);
      if (!parsed) {
        // LE cas du 422 : Lobby cote la catégorie comme disponible et refuse de la réserver.
        lodgingFailures.push({
          lineId: line.id,
          detail: `POST /bookings sans booking_id exploitable — ${describeLobbyResponse(response.status, response.body)}`,
          needsHuman: false,
        });
        continue;
      }

      const bookingId = String(parsed.bookingId);
      const outcome = await recordBooking(service, orderId, claimedAt, line.id, bookingId);
      if (outcome === "ok") {
        primaryBookingId ??= parsed.bookingId;
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
        lodgingFailures.push({
          lineId: line.id,
          detail: `ligne plus réservée au retour de Lobby — booking ${bookingId} mis en annulation`,
          needsHuman: false,
        });
        continue;
      }
      // not_recorded : le booking existe chez Lobby et AUCUNE ligne ne le porte. Seul un humain peut
      // l'annuler — l'entrée de réconciliation porte son id.
      lodgingFailures.push({
        lineId: line.id,
        detail: `booking ${bookingId} créé chez Lobby mais NON enregistré en base — à annuler à la main`,
        needsHuman: true,
      });
    }

    for (const line of group.activity_lines) {
      if (primaryBookingId === null) {
        // (a) aucune nuit dans la commande pour cet établissement : vendre un service Lobby seul est
        //     structurellement impossible (add-product-service exige un vrai booking, piège
        //     empirique confirmé v1) — pas un incident, une limite connue, donc aucune entrée
        //     (notify_all_admins enverrait un e-mail à chaque admin à chaque vente) ;
        // (b) il y avait des nuits mais aucune n'a son booking : la commande va être relâchée, et
        //     c'est l'échec des NUITS qui le décide — rien à enregistrer ici.
        if (group.lodging_lines.length === 0) {
          console.warn(
            `reserve-nights : service Lobby non reflété (order_line ${line.id}) — aucune nuit dans la commande pour cet établissement, Lobby n'accepte pas de vente de service isolée`
          );
        }
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

  if (lodgingFailures.length === 0) {
    return Response.json({ ok: true });
  }

  // ── ÉCHEC D'UNE NUIT : on défait, on n'encaisse pas ──────────────────────────────────────────
  console.error(
    `reserve-nights : ${lodgingFailures.length} nuit(s) sans booking (order ${orderId}) — relâchement`,
    lodgingFailures.map((entry) => entry.detail)
  );
  const released = await releaseOrder(service, orderId, lodgingFailures[0].detail);

  // Relâchée : seules les issues qui ont besoin d'un humain sont enregistrées (un booking a pu
  // survivre chez Lobby). Non relâchée (refus de la base, commande payée entre-temps…) : TOUT est
  // enregistré — c'est le seul cas qui laisse une commande pendante, le filet restant
  // expire_payment_order (30 minutes), qui annulera au passage les bookings frères déjà créés.
  const toRecord = released ? lodgingFailures.filter((entry) => entry.needsHuman) : lodgingFailures;
  await Promise.all(
    toRecord.map((entry) =>
      recordFailure(service, entry.lineId, released ? entry.detail : `${entry.detail} — relâchement impossible`)
    )
  );

  // 409 et non 200 : c'est un refus ou une issue inconnue chez le prestataire, pas une panne de
  // hifago, et il doit se voir dans la supervision comme dans le front.
  const reason = lodgingFailures.some((entry) => entry.needsHuman) ? "pms_unreachable" : "pms_refused";
  return failure(409, reason, released, { failedLines: lodgingFailures.length });
}
