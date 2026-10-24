import { checkOrderNights, LOBBY_DEFAULT_BASE_URL, type CheckGroup } from "@hifago/domain";
import { createServiceRoleClient } from "@hifago/supabase/service";

// Spec 21 §0/§8.1 — appelé par CheckoutForm.tsx juste après un create_order réussi, et par
// OrderResult.tsx quand « Pagar » est refusé faute de lecture fraîche. service_role ; le seul input
// de confiance est l'orderId, tout le reste est relu en base.
//
// ⚠️ RETOURNEMENT DU 2026-10-23. Cette route REMPLACE reserve-nights : elle ne crée AUCUN booking chez
// Lobby. Elle LIT la disponibilité à chaud, puis tient la place dans hifago (hold_pms_nights, RPC
// anti-survente à verrou par (établissement, catégorie Lobby)) pendant le paiement. Le booking Lobby
// est écrit APRÈS l'acompte par l'Edge Function pms-book-paid-orders. Aucune écriture chez Lobby
// avant paiement : un paiement refusé ne laisse donc plus de booking vivant, et aucun e-mail
// « réservé » ne part.
//
// LE FAIT QUI LIMITE CETTE LECTURE (spec 24 §11.2, inchangé) : deux catégories du compte réel (49823,
// 18013) sont annoncées libres par Lobby mais refusées en 422 à l'écriture. Aucune lecture ne peut le
// prédire : ce risque est ACCEPTÉ (décision de Gabriel, 2026-10-23) — un 422 après paiement envoie la
// commande dans la file « à traiter » de l'admin.
//
// ÉCHEC FERMÉ (CLAUDE.md §4.4) : Lobby indisponible, nuit non cotée ou place prise → la commande est
// défaite (release_order_after_pms_refusal, panier conservé), mêmes `reason`/`released` qu'avant.
export const runtime = "nodejs";
// Une ou deux fenêtres de lecture Lobby (15 s chacune au plus) plus les écritures en base.
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_CALL_TIMEOUT_MS = 15_000;

type Service = ReturnType<typeof createServiceRoleClient>;

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function releaseOrder(service: Service, orderId: string, reason: string): Promise<boolean> {
  const { data, error } = await service.rpc("release_order_after_pms_refusal", {
    p_order_id: orderId,
    p_reason: truncate(reason),
  });
  const ok = !error && (data as { ok?: boolean } | null)?.ok === true;
  if (!ok) console.error(`check-nights : relâchement IMPOSSIBLE (order ${orderId})`, error ?? data);
  return ok;
}

// Toute réponse d'échec porte `released` : c'est le champ que CheckoutForm lit pour choisir son
// message (« fechas liberadas » vs « estamos liberando »).
function failure(status: number, reason: string, released: boolean, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, reason, released, ...extra }, { status });
}

function positiveEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

type PayloadResult =
  | { ok: true; groups: CheckGroup[] }
  | { ok: false; reason: string };

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

  const { data: payloadData, error: payloadError } = await service.rpc("get_pms_check_payload", {
    p_order_id: orderId,
  });
  if (payloadError || !payloadData) {
    // Rien n'a été touché : pas de verdict possible, et surtout pas `ok:true`.
    console.error(`check-nights : lecture de la commande impossible (order ${orderId})`, payloadError);
    return failure(503, "db_error", false);
  }
  const payload = payloadData as PayloadResult;
  if (!payload.ok) {
    switch (payload.reason) {
      case "order_not_found":
        return failure(404, "order_not_found", false);
      case "order_not_active":
        // Plus aucune ligne vivante : la commande a déjà été défaite (refus, expiration).
        return failure(409, "order_not_active", true);
      case "order_paid":
        return failure(409, "order_paid", false);
      case "pms_unavailable": {
        // CLAUDE.md §4.4 : le connecteur de l'établissement a été coupé entre create_order et ici.
        const released = await releaseOrder(service, orderId, "connecteur LobbyPMS coupé (pms_unavailable)");
        return failure(409, "pms_unavailable", released);
      }
      default:
        console.error(`check-nights : lecture refusée pour un motif inattendu (order ${orderId})`, payload.reason);
        return failure(503, "db_error", false);
    }
  }

  // Aucune nuit PMS à vérifier (toutes déjà bookées, ou commande sans hébergement PMS).
  if (payload.groups.length === 0) return Response.json({ ok: true });

  const reading = await checkOrderNights(payload.groups, {
    baseUrl: process.env.LOBBY_API_BASE_URL || LOBBY_DEFAULT_BASE_URL,
    relaySecret: process.env.LOBBY_RELAY_SECRET,
    timeoutMs: positiveEnv("LOBBY_RESERVE_TIMEOUT_MS", DEFAULT_CALL_TIMEOUT_MS),
  });
  if (!reading.ok) {
    // Corps de réponse seulement, jamais l'URL (elle porte api_token — CLAUDE.md §8).
    const failureDetail =
      reading.failure.kind === "unreachable"
        ? reading.failure.message
        : `${reading.failure.kind} (HTTP ${reading.failure.status}) ${reading.failure.bodyExcerpt}`;
    console.error(`check-nights[LOBBY_INDISPONIBLE] order ${orderId} — ${truncate(failureDetail)}`);
    const released = await releaseOrder(service, orderId, `lecture Lobby impossible : ${failureDetail}`);
    return failure(409, "pms_unreachable", released);
  }

  const { data: holdData, error: holdError } = await service.rpc("hold_pms_nights", {
    p_order_id: orderId,
    p_snapshot: reading.snapshot,
    p_read_at: reading.readAt,
  });
  if (holdError || !holdData) {
    console.error(`check-nights : hold_pms_nights en erreur (order ${orderId})`, holdError);
    return failure(503, "db_error", false);
  }
  const hold = holdData as { ok: boolean; reason?: string; [key: string]: unknown };
  if (hold.ok) return Response.json({ ok: true });

  switch (hold.reason) {
    case "order_not_found":
      return failure(404, "order_not_found", false);
    case "order_paid":
      return failure(409, "order_paid", false);
    case "order_not_active":
      return failure(409, "order_not_active", true);
    case "pms_unavailable": {
      // Connecteur coupé entre la lecture et le hold : aucune place ne peut être tenue pour ce logement.
      const released = await releaseOrder(service, orderId, "connecteur LobbyPMS coupé (pms_unavailable)");
      return failure(409, "pms_unavailable", released);
    }
    case "full":
    case "not_quoted": {
      // La place n'existe pas (ou plus) : un vrai refus, présenté comme une indisponibilité.
      const released = await releaseOrder(service, orderId, `hold_pms_nights : ${hold.reason} ${truncate(JSON.stringify(hold))}`);
      return failure(409, "pms_refused", released);
    }
    case "stale_read": {
      // La lecture est arrivée trop tard à la base : on ne tient rien sur une lecture périmée.
      const released = await releaseOrder(service, orderId, "hold_pms_nights : lecture Lobby périmée (stale_read)");
      return failure(409, "pms_unreachable", released);
    }
    default:
      console.error(`check-nights : hold refusé pour un motif inattendu (order ${orderId})`, hold);
      return failure(503, "db_error", false);
  }
}
