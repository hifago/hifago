// Spec 21 — Connecteur LobbyPMS, Phase 6. Déclenchée toutes les 15 min par pg_cron/pg_net (migration
// 20260819140000_pms_jobs_cron.sql), réclame un lot de bookings dus au poll (claim_pms_poll_batch :
// une ligne par booking, jamais un établissement sans jeton, jamais un booking posé avec un jeton
// depuis remplacé) et relit chacun côté Lobby pour détecter ce que le staff a fait dans son logiciel —
// Lobby ne notifie rien (pas de webhook, client cahier des charges §5), d'où le poll.
//
// Ce que le poll CONCLUT, et rien d'autre (P6, 2026-10) :
//   - booking disparu : SEULEMENT sur le 404 Laravel du modèle Booking (isLobbyBookingGone). Un 404
//     de routage, un 401/403, un 5xx, un délai dépassé ne prouvent rien : passagers, ils comptent
//     dans le heartbeat (`ok=false`), sans une entrée de réconciliation par ligne et par passage ;
//   - séjour réalisé : `checkout_realizado === 1` ;
//   - les deux passent par apply_pms_poll_outcome (verrous, places des activités, ledger, miroir,
//     entrée détaillée) — jamais un UPDATE direct d'order_lines ;
//   - un signal inattendu (traslado, `deleted_at`, `estatus` jamais observé) : UNE entrée de
//     réconciliation par booking et par signal — jamais reposée tant que son texte ne change pas,
//     même résolue —, jamais une action automatique ;
//   - un booking réclamé mais non interrogé (budget du passage épuisé) rend son tour
//     (release_pms_poll_claim) : sinon, dans un lot stable, toujours les mêmes seraient sautés.
//
// ⚠️ Imports relatifs AVEC extension `.ts` (scripts/check-deno-imports.sh).
import { type JobOutcome, serveJob } from "../_shared/job.ts";
import { getLobbyBookingDetail, LOBBY_DEFAULT_BASE_URL } from "../../../packages/domain/src/pms/lobbyClient.ts";
import { isPossibleTraslado, isRealized } from "../../../packages/domain/src/pms/detectTraslado.ts";
import { describeUnexpectedLobbyBooking, isLobbyBookingGone } from "../../../packages/domain/src/pms/lobbyOutcomes.ts";

interface PollBatchRow {
  order_line_id: string;
  pms_booking_id: string;
  establishment_id: string;
  lobby_api_token: string;
}

interface OutcomeResult {
  ok: boolean;
  outcome?: string;
  reason?: string;
  lines?: number;
}

/** Préfixe des entrées de réconciliation posées par ce job (déduplication par ligne). */
const SIGNAL_PREFIX = "signal Lobby";

serveJob("pms-poll-bookings", async (ctx): Promise<JobOutcome> => {
  const { supabase } = ctx;
  const baseUrl = Deno.env.get("LOBBY_API_BASE_URL") || LOBBY_DEFAULT_BASE_URL;
  const relaySecret = Deno.env.get("LOBBY_RELAY_SECRET");

  const { data: batch, error } = await supabase.rpc("claim_pms_poll_batch", { p_limit: 20 });
  if (error) {
    return { ok: false, error: `claim_pms_poll_batch — ${ctx.describe(error)}`, stats: {}, status: 500 };
  }

  const rows = (batch ?? []) as PollBatchRow[];
  for (const row of rows) ctx.addSecret(row.lobby_api_token);
  const stats = {
    claimed: rows.length,
    polled: 0,
    gone: 0,
    realized: 0,
    signaled: 0,
    unchanged: 0,
    token_replaced: 0,
    errors: 0,
    skipped: 0,
  };
  // Les échecs par genre et par établissement (« HTTP 403 (établissement 1a2b3c4d) ») : le motif du
  // heartbeat — le seul texte que l'admin reçoit du watchdog — dit quoi et où.
  const failures = new Map<string, number>();
  const fail = (kind: string, row: PollBatchRow) => {
    stats.errors++;
    const key = `${kind} (établissement ${row.establishment_id.slice(0, 8)})`;
    failures.set(key, (failures.get(key) ?? 0) + 1);
  };

  async function applyOutcome(row: PollBatchRow, outcome: "gone" | "realized", detail: string) {
    const { data, error: rpcError } = await supabase.rpc("apply_pms_poll_outcome", {
      p_order_line_id: row.order_line_id,
      p_outcome: outcome,
      p_detail: detail,
    });
    if (rpcError) {
      fail("apply_pms_poll_outcome", row);
      console.error(`pms-poll-bookings : booking ${row.pms_booking_id} — ${ctx.describe(rpcError)}`);
      return;
    }
    const result = (data ?? {}) as OutcomeResult;
    if (result.ok) {
      if (outcome === "gone") stats.gone++;
      else stats.realized++;
    } else if (result.reason === "token_replaced") {
      // Jeton remplacé depuis le claim : la vérification est manuelle (migration 20261004005336),
      // rien à faire ici.
      stats.token_replaced++;
    } else {
      // no_live_line : plus aucune ligne vivante sur ce booking (annulée, expirée entre-temps).
      stats.unchanged++;
    }
  }

  // UNE entrée par booking et par signal, quel que soit son statut : un signal qui dure (un traslado
  // est permanent) n'est pas reposé — avec son e-mail à chaque admin — à chaque passage après que
  // l'admin l'a résolu ; il ne revient que si son texte change. Cherché dans toute la COMMANDE : la
  // ligne représentante du booking peut changer d'un passage à l'autre, et modify_order_line déplace
  // les entrées ouvertes vers sa ligne de remplacement.
  async function signal(row: PollBatchRow, what: string) {
    const detail = `${SIGNAL_PREFIX} sur le booking ${row.pms_booking_id} : ${what} — à vérifier chez Lobby, aucune action automatique`;
    const { data: line, error: lineError } = await supabase
      .from("order_lines")
      .select("order_id")
      .eq("id", row.order_line_id)
      .single();
    if (lineError || !line) {
      fail("lecture de la ligne", row);
      return;
    }
    const { data: existing, error: readError } = await supabase
      .from("pms_reconciliation_entries")
      .select("id, order_lines!inner(order_id)")
      .eq("detail", detail)
      .eq("order_lines.order_id", line.order_id)
      .limit(1);
    if (readError) {
      fail("lecture des entrées", row);
      return;
    }
    if ((existing ?? []).length > 0) return;
    const { error: insertError } = await supabase.from("pms_reconciliation_entries").insert({
      order_line_id: row.order_line_id,
      detail,
    });
    if (insertError) fail("écriture d'une entrée", row);
    else stats.signaled++;
  }

  for (const [index, row] of rows.entries()) {
    const timeoutMs = ctx.nextCallTimeout();
    if (timeoutMs === null) {
      // Budget du passage épuisé : ces bookings, marqués interrogés par le claim sans l'avoir été,
      // rendent leur tour — ils passent en tête au passage suivant.
      const skipped = rows.slice(index);
      stats.skipped = skipped.length;
      const { error: releaseError } = await supabase.rpc("release_pms_poll_claim", {
        p_order_line_ids: skipped.map((r) => r.order_line_id),
      });
      if (releaseError) {
        // Les bookings sautés restent marqués interrogés : ils attendront leur tour normal — le dire.
        fail("écriture release_pms_poll_claim", skipped[0]);
        console.error(`pms-poll-bookings : rendu du tour impossible — ${ctx.describe(releaseError)}`);
      }
      break;
    }
    stats.polled++;

    let response;
    try {
      response = await getLobbyBookingDetail(baseUrl, row.lobby_api_token, Number(row.pms_booking_id), relaySecret, timeoutMs);
    } catch (err) {
      fail(err instanceof Error ? err.name : "erreur réseau", row);
      console.warn(`pms-poll-bookings : booking ${row.pms_booking_id} injoignable — ${ctx.describe(err)}`);
      continue;
    }

    if (isLobbyBookingGone(response.status, response.body)) {
      await applyOutcome(row, "gone", `GET ${response.status}`);
      continue;
    }
    if (response.status !== 200) {
      fail(`HTTP ${response.status}`, row);
      continue;
    }

    const data = (response.body as { data?: Record<string, unknown> } | null)?.data;
    if (!data || typeof data !== "object") {
      fail("200 sans data", row);
      continue;
    }

    const detailData = {
      checkin_realizado: (data.checkin_realizado as number | null) ?? null,
      checkout_realizado: (data.checkout_realizado as number | null) ?? null,
      total_alojamiento: String(data.total_alojamiento ?? "0"),
      descuentos: (data.descuentos as unknown[] | null) ?? null,
      deleted_at: (data.deleted_at as string | null) ?? null,
    };

    const realized = isRealized(detailData);
    if (realized) await applyOutcome(row, "realized", "checkout_realizado");

    const signals = [
      isPossibleTraslado(detailData) ? "traslado possible (total_alojamiento à 0, sans remise)" : null,
      describeUnexpectedLobbyBooking(data),
    ].filter((s): s is string => s !== null);
    if (signals.length > 0) await signal(row, signals.join(" ; "));
    else if (!realized) stats.unchanged++;
  }

  const summary = [...failures.entries()].map(([kind, n]) => `${kind} ×${n}`).join(", ");
  return {
    ok: stats.errors === 0,
    error: stats.errors > 0 ? `lobby : ${stats.errors} échec(s) sur ${stats.polled} booking(s) — ${summary}` : null,
    stats,
  };
});
