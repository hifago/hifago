// Miroir de disponibilité LobbyPMS — le cron qui le remplit (migrations 20260917140000 et
// 20260917160000).
//
// POURQUOI CETTE FONCTION EXISTE. `search_catalog` est du SQL pur : elle ne peut pas appeler
// LobbyPMS, donc elle ne savait pas filtrer un logement adossé au PMS par dates — elle le laissait
// passer quoi qu'il arrive (`or e.lobby_connector_active`, retiré le 2026-09-17). Un appel à chaud
// pendant la recherche ferait suivre le coût au TRAFIC, sans aucune borne, contre un quota de 60
// appels par fenêtre glissante d'une minute. Ici, c'est NOUS qui fixons le débit : le lot est borné
// par `claim_pms_sync_batch`, et le nombre d'établissements n'allonge que le délai de
// rafraîchissement, jamais le débit.
//
// L'UNITÉ DE TRAVAIL est le couple (établissement, mois), parce que c'est exactement l'unité d'UN
// appel Lobby : `getNightAvailabilityRange` demande toute la plage en une fois, SANS `category_id`,
// donc une réponse porte toutes les catégories de l'établissement. Un hôtel de 40 chambres coûte
// autant qu'un gîte d'une seule (R1 + plage, 2026-08-28 : 180 appels → 1 pour un mois chez
// Casa Kayam).
//
// ⚠️ Imports relatifs AVEC extension `.ts` : sans elle, le boot casse — invisible au typecheck, au
// lint et aux tests (.claude/rules/supabase.md). Et une Edge Function n'existe pas tant qu'elle
// n'est pas DÉPLOYÉE et que ses secrets ne sont pas posés : les trois crons PMS ont tourné à vide
// en silence du 19 au 27 août 2026 faute de `pms_service_role_key` dans le Vault.
//
// Depuis P6 (2026-10) : squelette commun des jobs (_shared/job.ts — contrôle d'appelant, budget de
// temps, heartbeat à chaque passage, aucun secret dans ce qui sort) ; délai par appel Lobby.
import { type JobOutcome, serveJob } from "../_shared/job.ts";
import { LOBBY_DEFAULT_BASE_URL } from "../../../packages/domain/src/pms/lobbyClient.ts";
import {
  getNightAvailabilityRange,
  nightsOfMonth,
} from "../../../packages/domain/src/pms/getNightAvailabilityWindow.ts";
import { toMirrorRows } from "../../../packages/domain/src/pms/toMirrorRows.ts";
import { todayInBogota } from "../../../packages/domain/src/time/bogotaDates.ts";

interface SyncBatchRow {
  establishment_id: string;
  lobby_api_token: string;
  month: string;
}

serveJob("pms-sync-availability", async (ctx): Promise<JobOutcome> => {
  const { supabase, request } = ctx;
  const baseUrl = Deno.env.get("LOBBY_API_BASE_URL") || LOBBY_DEFAULT_BASE_URL;
  const relaySecret = Deno.env.get("LOBBY_RELAY_SECRET");

  // Le cron poste `{}`. Un appel manuel peut resserrer le lot pour observer sans consommer de
  // quota — jamais l'élargir au-delà de ce que le quota supporte.
  let limit = 6;
  try {
    const body = (await request.json()) as { limit?: number } | null;
    if (body && typeof body.limit === "number") limit = Math.max(1, Math.min(body.limit, 12));
  } catch {
    // corps vide ou non-JSON : le cas normal du cron.
  }

  const { data: batch, error } = await supabase.rpc("claim_pms_sync_batch", { p_limit: limit });
  if (error) {
    return { ok: false, error: `claim_pms_sync_batch — ${ctx.describe(error)}`, stats: {}, status: 500 };
  }

  const rows = (batch ?? []) as SyncBatchRow[];
  for (const row of rows) ctx.addSecret(row.lobby_api_token);
  const summary = { claimed: rows.length, synced: 0, nights: 0, failed: 0, skipped: 0 };
  // Les échecs par genre et statut (`rejected 401`, `rate_limited 429`…) : le motif du heartbeat
  // les résume.
  const failures = new Map<string, number>();
  const today = todayInBogota();

  // UN SEUL site de comptage et d'écriture d'échec. Les trois sorties d'échec de cette fonction
  // répétaient le même appel RPC et le même `summary.failed++` ; une quatrième ajoutée plus tard
  // pouvait oublier le compteur sans que rien ne le signale.
  const echouer = async (row: SyncBatchRow, genre: string, motif: string, retryAfterSeconds: number | null = null) => {
    failures.set(genre, (failures.get(genre) ?? 0) + 1);
    const { error: failError } = await supabase.rpc("fail_pms_sync", {
      p_establishment_id: row.establishment_id,
      p_month: row.month,
      p_error: motif,
      // Un `Retry-After` de Lobby (429) prime sur le backoff calculé s'il l'excède (20260918170000),
      // borné au plafond de ce backoff (24 h).
      p_retry_after_seconds: retryAfterSeconds === null ? null : Math.min(retryAfterSeconds, 86_400),
    });
    if (failError) console.error(`fail_pms_sync ${row.establishment_id} ${row.month} — ${ctx.describe(failError)}`);
    summary.failed++;
  };

  async function traiterUnCouple(row: SyncBatchRow): Promise<void> {
    // Le mois COURANT ne commence pas au 1er : les nuits passées ne sont ni vendables ni utiles au
    // filtre, et les demander gaspillerait de la charge utile. `nightsOfMonth` borne pour nous.
    const nights = nightsOfMonth(row.month, today);
    if (nights.length === 0) {
      // Mois entièrement passé — ne devrait pas être réclamé (l'horizon part du mois courant),
      // mais le dire plutôt que de le traiter comme un succès vide.
      await echouer(row, "mois passé", "mois entièrement passé");
      return;
    }

    // Les couples partent en parallèle : chacun a son délai (8 s), le budget du passage n'est jamais
    // épuisé ici (`skipped` reste à 0 tant que le lot tient en un seul tour). S'il l'était, le
    // couple réclamé redeviendrait réclamable à l'expiration de sa visibilité (10 min) — jamais
    // marqué en échec, ce n'est pas Lobby qui a failli.
    const timeoutMs = ctx.nextCallTimeout();
    if (timeoutMs === null) {
      summary.skipped++;
      return;
    }
    const result = await getNightAvailabilityRange(baseUrl, row.lobby_api_token, nights, relaySecret, timeoutMs);

    if (!result.ok) {
      // ÉCHEC : on ne touche PAS au miroir. Sa donnée vieillit, `search_catalog` retombe en
      // doctrine optimiste au-delà de six heures — jamais en faisant disparaître le partenaire du
      // site. Vider le miroir sur un échec serait exactement l'inverse du but de ce lot.
      //
      // `describeLobbyErrorBody` n'est pas utilisé ici : on ne consigne que le genre d'échec, et
      // JAMAIS l'URL de la requête, qui porte `api_token` en query string (CLAUDE.md §8).
      const failure = result.failure;
      const genre = failure.kind === "unreachable" ? failure.kind : `${failure.kind} ${failure.status}`;
      const detail =
        failure.kind === "rate_limited" ? `${genre} (retry-after ${failure.retryAfterSeconds ?? "?"}s)` : genre;
      console.warn(`sync ${row.establishment_id} ${row.month} : ${detail}`);
      await echouer(row, genre, detail, failure.kind === "rate_limited" ? failure.retryAfterSeconds : null);
      return;
    }

    // Aplatir (nuit → catégories) en (catégorie, nuit) — partagé avec le repli de lot B
    // (`night-availability/route.ts`), même catalogue, même transformation.
    const mirrorRows = toMirrorRows(result.nights);

    const { error: writeError } = await supabase.rpc("sync_pms_availability_month", {
      p_establishment_id: row.establishment_id,
      p_month: row.month,
      p_rows: mirrorRows,
    });
    if (writeError) {
      console.error(`écriture du miroir ${row.establishment_id} ${row.month} — ${ctx.describe(writeError)}`);
      await echouer(row, "écriture", `écriture ${ctx.describe(writeError)}`);
      return;
    }

    summary.synced++;
    summary.nights += mirrorRows.length;
  }

  // EN PARALLÈLE, pas en série. Le lot est borné à `p_limit` (6 par défaut), donc le débit reste
  // fixé par la taille du lot et la fréquence du cron — jamais par le parallélisme intra-lot, qui
  // ne change pas le nombre d'appels. En série, le temps de mur était `6 × latence Lobby` sous un
  // `timeout_milliseconds := 25000` (migration du cron) : au-delà de ~4 s par appel, pg_net
  // enregistrait un timeout sur un job qui avait pourtant abouti — et `net._http_response` est le
  // SEUL canal de supervision de ces crons. C'est aussi le patron du domaine, où
  // `getNightAvailabilityWindow` fait des lots séquentiels d'appels parallèles (CHUNK_SIZE = 6).
  await Promise.all(rows.map(traiterUnCouple));

  return {
    ok: summary.failed === 0,
    error: summary.failed > 0
      ? `lobby : ${summary.failed} mois en échec sur ${rows.length} — ${[...failures.entries()].map(([k, n]) => `${k} ×${n}`).join(", ")}`
      : null,
    stats: summary,
  };
});
