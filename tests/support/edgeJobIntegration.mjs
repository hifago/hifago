// Gardes communes des tests d'intégration MANUELS des Edge Functions de jobs (P6, décision D8 : aucun
// job CI, la preuve est consignée au rapport qui les lance). Ils écrivent dans la pile locale
// partagée et appellent une fonction dont le lot est GLOBAL : avant toute écriture, ils s'arrêtent
// (exit 2) plutôt que de toucher autre chose que leurs fixtures.
import { readFileSync } from "node:fs";

export const CONNECTION_STRING = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Clés de DÉMO de la pile locale (publiques, imprimées par `supabase status`) — surchargeables.
export const KEYS = {
  serviceRole:
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
  anon:
    process.env.SUPABASE_ANON_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
  publishable: process.env.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
};

function stop(message) {
  console.error(`ARRÊT avant toute écriture — ${message}`);
  process.exit(2);
}

/** L'URL de la fonction : edge runtime local par défaut, Deno autonome via FUNCTIONS_URL — jamais une
 *  autre machine (la clé service_role partirait avec). */
export function localFunctionsUrl(name) {
  const url = process.env.FUNCTIONS_URL ?? `http://127.0.0.1:54321/functions/v1/${name}`;
  const { hostname } = new URL(url);
  if (hostname !== "127.0.0.1" && hostname !== "localhost") stop(`FUNCTIONS_URL vise ${hostname}, pas la machine locale`);
  return url;
}

/** Les crons de jobs n'appellent leurs fonctions que si le Vault porte leur clé : présente, un cron
 *  pourrait passer pendant le test, sur ses fixtures comme sur le reste de la base. */
export async function refuseIfCronsCanFire(client) {
  const { rows } = await client.query("select count(*)::int as n from vault.secrets where name = 'pms_service_role_key'");
  if (rows[0].n > 0) stop("le Vault porte pms_service_role_key : les crons appelleraient la fonction pendant le test");
}

/** `sql` compte ce que le lot global réclamerait EN PLUS des fixtures (`$1…` = `params`). */
export async function refuseIfForeignRows(client, what, sql, params = []) {
  const { rows } = await client.query(sql, params);
  if (rows[0].n > 0) stop(`${rows[0].n} ${what} hors fixtures — le lot de la fonction est global`);
}

async function call(url, authorization) {
  const headers = { "Content-Type": "application/json" };
  if (authorization) headers.Authorization = authorization;
  const response = await fetch(url, { method: "POST", headers, body: "{}" });
  return { status: response.status, text: await response.text() };
}

/** Sans en-tête, clé publishable : 401 (passerelle ou fonction). Clé anon : la passerelle la laisse
 *  passer (JWT valide), c'est la FONCTION qui refuse — son corps le prouve. */
export async function callerChecks(url) {
  const checks = [];
  for (const [label, authorization] of [
    ["sans en-tête", null],
    ["clé publishable", `Bearer ${KEYS.publishable}`],
  ]) {
    const { status, text } = await call(url, authorization);
    checks.push([status === 401, `${label} → 401 (obtenu ${status} ${text.slice(0, 80)})`]);
  }
  const anon = await call(url, `Bearer ${KEYS.anon}`);
  let reason = null;
  try {
    reason = JSON.parse(anon.text).reason ?? null;
  } catch {
    // corps non JSON : `reason` reste null, la vérification échoue.
  }
  checks.push([anon.status === 401 && reason === "unauthorized", `clé anon → 401 refusé par la fonction (obtenu ${anon.status} ${anon.text.slice(0, 80)})`]);
  return checks;
}

export function runAsServiceRole(url, body = "{}") {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEYS.serviceRole}` },
    body,
  }).then(async (response) => ({ status: response.status, text: await response.text() }));
}

export async function snapshotHeartbeat(client, job) {
  const { rows } = await client.query("select * from job_heartbeats where job_name = $1", [job]);
  return rows[0] ?? null;
}

/** La pile est partagée : le heartbeat du job revient exactement à son état d'avant le test. */
export async function restoreHeartbeat(client, job, before) {
  await client.query("delete from job_heartbeats where job_name = $1", [job]);
  if (before) {
    await client.query(
      "insert into job_heartbeats (job_name, last_run_at, last_ok_at, last_error, stats, alerted_at, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
      [before.job_name, before.last_run_at, before.last_ok_at, before.last_error, before.stats, before.alerted_at, before.created_at]
    );
  }
}

/** Les secrets du test n'apparaissent pas dans les journaux de la fonction (si FUNCTION_LOG est fourni). */
export function logChecks(secrets) {
  if (!process.env.FUNCTION_LOG) return [];
  const log = readFileSync(process.env.FUNCTION_LOG, "utf8");
  return [[secrets.every((s) => !log.includes(s)), `aucun secret du test dans les journaux de la fonction (${process.env.FUNCTION_LOG})`]];
}

export function report(checks, name) {
  let failed = 0;
  for (const [ok, label] of checks) {
    console.log(`${ok ? "OK " : "FAIL"} — ${label}`);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? `${name} : intégration vérifiée (${checks.length} contrôles).` : `${name} : ÉCHEC (${failed}/${checks.length}).`);
  return failed === 0 ? 0 : 1;
}
