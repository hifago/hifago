// C2 (spec 25) — draine la file `pms_cancellation_queue` et annule chez LobbyPMS les bookings dont
// plus aucune ligne hifago n'est réservée. Jumelle de pms-poll-bookings : même patron de claim en
// lot, même lecture du jeton PAR LA BASE (jamais par une variable d'environnement), même principe
// de non-blocage — une annulation hifago n'attend jamais Lobby pour être effective.
//
// Le sens de circulation est important : hifago fait foi sur l'annulation, Lobby la reçoit. Le sens
// inverse (annulation faite par le partenaire dans son PMS) est observé par pms-poll-bookings et
// n'est PAS traité ici — sa règle métier n'est pas écrite (spec 25 §4).
//
// Depuis P6 (2026-10) : squelette commun des jobs (_shared/job.ts — contrôle d'appelant, budget de
// temps, heartbeat à chaque passage, aucun secret dans ce qui sort) ; « déjà annulé » se lit sur le
// 422 RECORD_NOT_FOUND (isLobbyCancelAlreadyDone), jamais sur un 404 ; délai par appel.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type JobContext, type JobOutcome, serveJob } from "../_shared/job.ts";
import { cancelLobbyBooking, LOBBY_DEFAULT_BASE_URL } from "../../../packages/domain/src/pms/lobbyClient.ts";
import { describeLobbyErrorBody } from "../../../packages/domain/src/pms/describeLobbyErrorBody.ts";
import { isLobbyCancelAlreadyDone } from "../../../packages/domain/src/pms/lobbyOutcomes.ts";

interface CancellationRow {
  entry_id: string;
  pms_booking_id: string;
  establishment_id: string;
  lobby_api_token: string;
  hifago_status: string | null;
  // Retourné par claim_pms_cancellation_batch depuis 20260827260000 — déjà incrémenté par le claim.
  attempts: number;
}

// LobbyPMS n'accepte PAS un motif libre : `cancellation_reason` est un CODE pris dans une liste
// fermée (docs/3-integrations/lobby_pms_api.md § Cancel Booking). Envoyer du texte donne
// `422 {"error_code":"INPUT_PARAMETERS","error":"The selected cancellation reason is invalid."}` —
// constaté en conditions réelles le 2026-08-27, contre le compte de Casa Kayam. Le texte humain va
// dans `description`, qui est le champ prévu pour ça.
//
//   NS  no show · RC room change · RE registration errors
//   TTC timely customer cancellation · CC customer without communication · OTH other
function lobbyReasonCode(hifagoStatus: string | null): string {
  switch (hifagoStatus) {
    case "cancelled_by_client":
      return "TTC";
    // Annulation par l'établissement, commande jamais payée, ligne remplacée : aucun code Lobby ne
    // correspond exactement, et en inventer un fausserait leurs statistiques d'annulation. `OTH` est
    // le code prévu pour ça — `description` porte le détail.
    default:
      return "OTH";
  }
}

// LE SUCCÈS SE LIT DANS LE CORPS, PAS DANS LE STATUT. La réponse documentée d'une annulation
// réussie est `{"cancel_booking": <id>}` (docs/3-integrations/lobby_pms_api.md), et LobbyPMS ne la
// renvoie PAS avec un 200 — constaté en conditions réelles le 2026-08-27 : la première version
// testait `status === 200`, a donc classé en échec une annulation qui avait parfaitement réussi, et
// l'aurait retentée trois fois avant d'alerter pour rien.
//
// Même leçon que le 422 juste en dessous, et que le `{"raw":"forbidden"}` du job nocturne le même
// jour : chez LobbyPMS, le statut HTTP n'est jamais le contrat — le corps l'est.
function isCancellationAccepted(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  return "cancel_booking" in (body as Record<string, unknown>);
}

function lobbyErrorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const code = (body as { error_code?: unknown }).error_code;
  return typeof code === "string" ? code : null;
}

// Les 422 dont hifago ne peut RIEN faire : l'entrée est close, il n'y a pas d'action possible.
// À distinguer absolument d'INPUT_PARAMETERS, qui signale un bug de NOTRE côté (cf. plus bas).
// (RECORD_NOT_FOUND, « déjà annulé », est traité à part : c'est l'objectif atteint.)
const TERMINAL_LOBBY_ERRORS = new Set([
  "RESTRICTED_RESERVATION",   // le booking porte déjà une charge — spec 21 §0
  "BOOKING_CHECK_IN_COMPLETE", // le client est arrivé, la réservation ne s'annule plus
]);

// Au-delà, l'entrée est close en 'failed' plutôt que réessayée indéfiniment. Trois passages du cron
// suffisent à absorber une indisponibilité passagère du relais ou de Lobby ; au-delà c'est une
// panne qui demande un humain, et la retenter en boucle ne fait qu'ajouter du bruit.
const MAX_ATTEMPTS = 3;

// Motif envoyé à Lobby. En espagnol : il s'affiche tel quel dans le logiciel du partenaire, qui
// n'est pas francophone.
const CANCELLATION_DESCRIPTION = "Cancelado desde hifago";

serveJob("pms-cancel-bookings", async (ctx): Promise<JobOutcome> => {
  const { supabase } = ctx;
  const baseUrl = Deno.env.get("LOBBY_API_BASE_URL") || LOBBY_DEFAULT_BASE_URL;
  const relaySecret = Deno.env.get("LOBBY_RELAY_SECRET");

  const { data: batch, error } = await supabase.rpc("claim_pms_cancellation_batch", { p_limit: 20 });
  if (error) {
    return { ok: false, error: `claim_pms_cancellation_batch — ${ctx.describe(error)}`, stats: {}, status: 500 };
  }

  const rows = (batch ?? []) as CancellationRow[];
  for (const row of rows) ctx.addSecret(row.lobby_api_token);
  const summary = { claimed: rows.length, cancelled: 0, already_gone: 0, restricted: 0, retried: 0, failed: 0, skipped: 0 };
  // Les échecs par genre et par établissement : le motif du heartbeat dit quoi et où.
  const failures = new Map<string, number>();
  const fail = (kind: string, row: CancellationRow) => {
    const key = `${kind} (établissement ${row.establishment_id.slice(0, 8)})`;
    failures.set(key, (failures.get(key) ?? 0) + 1);
  };
  // Une écriture de la file qui échoue après la réponse de Lobby : l'entrée reste en attente (le
  // passage suivant la rattrape — RECORD_NOT_FOUND si l'annulation est faite), mais la supervision
  // le dit : jamais `ok` sur une file qui n'a pas enregistré ce qui s'est passé.
  let writeErrors = 0;
  const writeFailed = (row: CancellationRow, rpc: string, writeError: unknown) => {
    writeErrors++;
    fail(`écriture ${rpc}`, row);
    console.error(`pms-cancel-bookings : booking ${row.pms_booking_id} — ${rpc} — ${ctx.describe(writeError)}`);
  };
  const resolve = async (row: CancellationRow, args: Record<string, unknown>) => {
    const { error: resolveError } = await supabase.rpc("resolve_pms_cancellation", { p_entry_id: row.entry_id, ...args });
    if (resolveError) writeFailed(row, "resolve_pms_cancellation", resolveError);
  };

  for (const [index, row] of rows.entries()) {
    const timeoutMs = ctx.nextCallTimeout();
    if (timeoutMs === null) {
      // Budget du passage épuisé : ces entrées n'ont pas été tentées — la tentative que le claim
      // leur a comptée est rendue (release_pms_cancellation_claim), leur dernier motif réel gardé.
      const skipped = rows.slice(index);
      summary.skipped = skipped.length;
      const { error: releaseError } = await supabase.rpc("release_pms_cancellation_claim", {
        p_entry_ids: skipped.map((r) => r.entry_id),
      });
      if (releaseError) writeFailed(skipped[0], "release_pms_cancellation_claim", releaseError);
      break;
    }
    try {
      const response = await cancelLobbyBooking(
        baseUrl,
        row.lobby_api_token,
        Number(row.pms_booking_id),
        lobbyReasonCode(row.hifago_status),
        CANCELLATION_DESCRIPTION,
        relaySecret,
        timeoutMs
      );

      // Annulé — cas nominal, reconnu au CORPS et non au statut (cf. isCancellationAccepted).
      if (isCancellationAccepted(response.body)) {
        summary.cancelled++;
        await resolve(row, { p_outcome: "done", p_lobby_status_code: response.status });
        continue;
      }

      // Déjà annulé chez Lobby (par nous lors d'un passage précédent, ou par le partenaire) :
      // l'objectif est atteint, c'est un SUCCÈS — ce qui rend le job rejouable à volonté (spec 25
      // §3.5). Lobby le dit par le code RECORD_NOT_FOUND (observé le 2026-08-27), JAMAIS par un 404
      // nu : un 404 sans ce code est celui du routage de Lobby ou du relais, il ne dit rien du
      // booking — le compter en succès clôturait l'entrée, chambre encore bloquée chez le partenaire.
      if (isLobbyCancelAlreadyDone(response.status, response.body)) {
        summary.already_gone++;
        await resolve(row, { p_outcome: "done", p_lobby_status_code: response.status });
        continue;
      }

      // 422 — et surtout PAS « tout 422 est attendu », ce qui était le défaut de la première
      // version : elle classait en succès un `INPUT_PARAMETERS` qui signalait NOTRE propre bug, et
      // laissait le booking ouvert sans que personne ne le sache. C'est le corps qui tranche, pas
      // le statut. Trouvé en conditions réelles le 2026-08-27, jamais par un test local.
      //
      // Les cas terminaux sont ceux où hifago ne peut RIEN faire : charge déjà attachée, client
      // arrivé. L'entrée est close avec le code conservé. Les traiter comme des incidents
      // déclencherait notify_all_admins sans dédup, soit un e-mail à chaque admin à chaque
      // annulation — le défaut C9, corrigé le 2026-08-26 sur le chemin jumeau.
      const code = lobbyErrorCode(response.body);
      if (response.status === 422 && TERMINAL_LOBBY_ERRORS.has(code ?? "")) {
        summary.restricted++;
        console.warn(`pms-cancel-bookings : booking ${row.pms_booking_id} non annulable par API (422 ${code})`);
        await resolve(row, { p_outcome: "done", p_lobby_status_code: 422, p_error: `422 ${code}` });
        continue;
      }

      // Tout le reste est une vraie panne : réessai borné, puis clôture en échec. Le statut est
      // recopié DANS le message : `requeue_pms_cancellation` ne conserve que `last_error`, et sans
      // ça un réessai perd l'information la plus utile au diagnostic (constaté le 2026-08-27 —
      // `lobby_status_code` restait null sur une entrée requeue, il a fallu deviner). Le corps,
      // court et masqué, distingue un 403 du relais d'un 403 de Lobby.
      fail(`HTTP ${response.status}`, row);
      await recordFailure(
        ctx, row, summary, response.status,
        `HTTP ${response.status} — ${describeLobbyErrorBody(response.body, ctx.redact)}`,
        writeFailed
      );
    } catch (err) {
      // Un délai dépassé sur un POST : l'issue est INCONNUE (Lobby a pu annuler). Le réessai est
      // sans risque — il répondra RECORD_NOT_FOUND s'il l'a fait.
      fail(err instanceof Error ? err.name : "erreur réseau", row);
      await recordFailure(ctx, row, summary, null, ctx.describe(err), writeFailed);
    }
  }

  const failed = summary.retried + summary.failed;
  const head = [
    failed > 0 ? `${failed} annulation(s) en échec` : null,
    writeErrors > 0 ? `${writeErrors} écriture(s) de la file en échec` : null,
  ].filter((part): part is string => part !== null).join(", ");
  return {
    ok: failed === 0 && writeErrors === 0,
    error: head
      ? `lobby : ${head} sur ${rows.length} — ${[...failures.entries()].map(([k, n]) => `${k} ×${n}`).join(", ")}`
      : null,
    stats: { ...summary, write_errors: writeErrors },
  };
}, {
  // Un POST d'annulation consomme une tentative : il ne part qu'avec un délai complet (8 s), jamais
  // un délai tronqué par le budget — sinon un Lobby lent ferait échouer le dernier appel de chaque
  // passage, tentative facturée.
  minCallMs: 8_000,
});

async function recordFailure(
  ctx: JobContext,
  row: CancellationRow,
  summary: { retried: number; failed: number },
  statusCode: number | null,
  rawError: string,
  writeFailed: (row: CancellationRow, rpc: string, writeError: unknown) => void
) {
  // `SupabaseClient` et non `ReturnType<typeof createClient>` : ce dernier résout les génériques
  // sur leurs valeurs par défaut, ce qui donne un schéma `never` — le client réel n'y était plus
  // assignable, ET les arguments des `rpc()` ci-dessous devenaient de type `undefined`, donc plus
  // vérifiés du tout. Trouvé le 2026-08-27 en branchant `deno check` en CI.
  const supabase: SupabaseClient = ctx.supabase;
  // Jamais un secret dans `last_error` (affiché, journalisé) : masqué et court.
  const error = ctx.redact(rawError);
  // `attempts` vient du claim, qui l'a incrémenté dans son propre UPDATE et le RETOURNE depuis
  // 20260827260000 : plus de relecture de la table ici — elle est RPC-only, et cette lecture
  // directe était le seul endroit du job qui l'ignorait. On compare donc au nombre de passages
  // effectués, pas à celui d'avant l'appel.
  const attempts = row.attempts;

  if (attempts >= MAX_ATTEMPTS) {
    summary.failed++;
    console.error(
      `pms-cancel-bookings : booking ${row.pms_booking_id} abandonné après ${attempts} tentatives — ${error}`
    );
    const { error: resolveError } = await supabase.rpc("resolve_pms_cancellation", {
      p_entry_id: row.entry_id, p_outcome: "failed", p_lobby_status_code: statusCode, p_error: error,
    });
    if (resolveError) writeFailed(row, "resolve_pms_cancellation", resolveError);
    return;
  }

  summary.retried++;
  const { error: requeueError } = await supabase.rpc("requeue_pms_cancellation", { p_entry_id: row.entry_id, p_error: error });
  if (requeueError) writeFailed(row, "requeue_pms_cancellation", requeueError);
}
