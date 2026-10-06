// Spec 23 Tranche 1 — test d'intégration RÉEL de l'Edge Function send-notification-emails contre
// la stack Supabase locale, miroir exact de tests/pms-integration/pms_poll_bookings.integration.mjs
// (driver `pg` direct, process.exit, serveur de fixtures node:http — jamais un vrai envoi Resend).
//
// PRÉREQUIS avant de lancer ce script :
//   1. npx supabase start actif (redémarré après tout changement de supabase/functions/.env).
//   2. supabase/functions/.env contient RESEND_API_BASE_URL=http://host.docker.internal:4546 et
//      RESEND_API_KEY=<valeur factice> — SANS ce réglage, la fonction pointerait vers le vrai
//      api.resend.com, jamais souhaitable en test.
//      Ou la fonction en Deno autonome : FUNCTIONS_URL=http://127.0.0.1:<port>,
//      RESEND_API_BASE_URL=http://127.0.0.1:4546.
//
// P6 (2026-10) : seule la clé service_role déclenche le job (sans en-tête, anon, publishable → 401) ;
// un refus GLOBAL de Resend (401, 403, 429) arrête le passage et rend tout le lot SANS consommer de
// tentative ; une PANNE (503) compte la tentative de la ligne tentée, arrête le passage et rend le
// reste ; heartbeat `ok=false` avec son motif exact ; la clé Resend n'apparaît nulle part (heartbeat,
// file, réponse, journaux si FUNCTION_LOG est fourni).
//
// Le Vault SANS pms_service_role_key, et aucun autre e-mail réclamable dans la base (le claim est
// global — sinon arrêt, exit 2). La fixture répond 500 à tout destinataire qu'elle ne connaît pas :
// jamais « envoyé ».
import pg from "pg";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  CONNECTION_STRING,
  callerChecks,
  localFunctionsUrl,
  refuseIfCronsCanFire,
  refuseIfForeignRows,
  restoreHeartbeat,
  runAsServiceRole,
  snapshotHeartbeat,
} from "../support/edgeJobIntegration.mjs";

const { Client } = pg;
const FUNCTIONS_URL = localFunctionsUrl("send-notification-emails");
// La clé Resend FACTICE que la fonction doit avoir reçue (RESEND_API_KEY) : elle ne doit apparaître
// nulle part dans ce qui sort.
const RESEND_KEY = process.env.RESEND_API_KEY ?? "";
if (RESEND_KEY.length < 8) {
  // Sans elle, la vérification « aucune clé dans ce qui sort » ne prouverait rien.
  console.error("ARRÊT avant toute écriture — RESEND_API_KEY (la clé factice donnée à la fonction) n'est pas fournie au test");
  process.exit(2);
}
const FIXTURE_PORT = 4546;
const JOB = "send-notification-emails";
const REFUSED_EMAILS = ["notification-integration-refused-1@test.local", "notification-integration-refused-2@test.local"];
const OUTAGE_EMAILS = [
  "notification-integration-outage-1@test.local",
  "notification-integration-outage-2@test.local",
  "notification-integration-outage-3@test.local",
];
// Débit (A2) : trois lignes envoyées avec succès ; la première réponse annonce, si le scénario le
// demande, une fenêtre de débit épuisée (`ratelimit-remaining: 0`, `ratelimit-reset`).
const PACE_EMAILS = [
  "notification-integration-pace-1@test.local",
  "notification-integration-pace-2@test.local",
  "notification-integration-pace-3@test.local",
];
let resendRefusal = null; // un statut global (401, 403, 429, 503) quand le scénario le demande
let resendCalls = 0;
let rateResetOnce = null; // secondes annoncées par la PROCHAINE réponse, fenêtre épuisée
const callTimes = []; // instant (ms) de chaque appel reçu par la fixture

// Deux lignes : une qui doit réussir (succès Resend simulé), une qui doit échouer (statut 422
// simulé) — prouve que send-notification-emails traite chaque ligne isolément (spec 23 §8.2 —
// même discipline d'isolation par destinataire que côté SQL) et ne bloque jamais le lot entier sur
// une seule ligne en échec.
const OK_EMAIL = "notification-integration-ok@test.local";
const FAIL_EMAIL = "notification-integration-fail@test.local";
const receivedIdempotencyKeys = [];

function startFixtureServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/emails") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const payload = JSON.parse(raw);
        resendCalls++;
        callTimes.push(performance.now());
        receivedIdempotencyKeys.push(req.headers["idempotency-key"]);
        if (resendRefusal !== null) {
          res.writeHead(resendRefusal, { "Content-Type": "application/json" });
          // Une panne (5xx) dont la page RECOPIE la requête reçue, en-tête Authorization compris.
          const echo = resendRefusal >= 500 ? { request_headers: { authorization: req.headers.authorization } } : {};
          res.end(JSON.stringify({ statusCode: resendRefusal, name: "validation_error", message: "API key is invalid", ...echo }));
          return;
        }
        if (payload.to === FAIL_EMAIL) {
          res.writeHead(422, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "simulated Resend rejection" }));
          return;
        }
        if (payload.to !== OK_EMAIL && !PACE_EMAILS.includes(payload.to)) {
          // Un destinataire inconnu de la fixture n'est JAMAIS « envoyé ».
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "destinataire inconnu de la fixture" }));
          return;
        }
        const rateHeaders = rateResetOnce === null ? {} : { "ratelimit-remaining": "0", "ratelimit-reset": String(rateResetOnce) };
        rateResetOnce = null;
        res.writeHead(200, { "Content-Type": "application/json", ...rateHeaders });
        res.end(JSON.stringify({ id: `fixture-message-${randomUUID()}` }));
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "unhandled by fixture server" }));
  });
  return new Promise((resolve) => server.listen(FIXTURE_PORT, "127.0.0.1", () => resolve(server)));
}

async function purgeFixtures(client) {
  await client.query("delete from notification_emails where recipient_email = any($1::text[])", [
    [OK_EMAIL, FAIL_EMAIL, ...REFUSED_EMAILS, ...OUTAGE_EMAILS, ...PACE_EMAILS],
  ]);
}

const FIXTURE_EMAILS = () => [OK_EMAIL, FAIL_EMAIL, ...REFUSED_EMAILS, ...OUTAGE_EMAILS, ...PACE_EMAILS];

async function insertEmails(client, emails, subject) {
  const { rows } = await client.query(
    `insert into notification_emails (event_type, recipient_email, subject, body_html)
     select 'partner_invitation', e, $2, '<p>r</p>' from unnest($1::text[]) e returning id`,
    [emails, subject]
  );
  return rows.map((r) => r.id);
}

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  await refuseIfCronsCanFire(client);
  await refuseIfForeignRows(
    client,
    "e-mail(s) réclamable(s)",
    "select count(*)::int as n from notification_emails where status in ('pending', 'sending') and not (recipient_email = any($1::text[]))",
    [FIXTURE_EMAILS()]
  );
  const fixtureServer = await startFixtureServer();
  let exitCode = 0;
  const heartbeatBefore = await snapshotHeartbeat(client, JOB);
  const outputs = [];

  try {
    await purgeFixtures(client);

    const authChecks = await callerChecks(FUNCTIONS_URL);
    authChecks.push([resendCalls === 0, `aucun refus n'a appelé Resend (${resendCalls})`]);

    const { rows: inserted } = await client.query(
      `insert into notification_emails (event_type, recipient_email, subject, body_html)
       values ('partner_invitation', $1, 'Integration OK', '<p>ok</p>'),
              ('partner_invitation', $2, 'Integration FAIL', '<p>fail</p>')
       returning id, recipient_email`,
      [OK_EMAIL, FAIL_EMAIL]
    );
    const okId = inserted.find((r) => r.recipient_email === OK_EMAIL).id;
    const failId = inserted.find((r) => r.recipient_email === FAIL_EMAIL).id;

    const response = await runAsServiceRole(FUNCTIONS_URL);
    if (response.status !== 200) {
      throw new Error(`send-notification-emails a répondu ${response.status} : ${response.text}`);
    }
    const summary = JSON.parse(response.text);
    console.log("Réponse send-notification-emails :", summary);
    outputs.push(JSON.stringify(summary));

    const checks = [
      ...authChecks,
      [
        !("recipient_email" in summary) && !("subject" in summary) && !("body_html" in summary),
        "réponse HTTP strictement agrégée, aucune PII (spec 23 §8.6)",
      ],
    ];

    const { rows } = await client.query(
      "select id, status, provider_message_id, last_error, attempts from notification_emails where id = any($1)",
      [[okId, failId]]
    );
    const ok = rows.find((r) => r.id === okId);
    const fail = rows.find((r) => r.id === failId);

    checks.push(
      [ok?.status === "sent", `ligne OK → status='sent' (obtenu: ${ok?.status})`],
      [!!ok?.provider_message_id, `ligne OK → provider_message_id renseigné (obtenu: ${ok?.provider_message_id})`],
      [fail?.status === "pending" && fail?.attempts === 1, `ligne FAIL → reste 'pending' pour retry après 1 tentative (obtenu: ${fail?.status}/${fail?.attempts})`],
      [!!fail?.last_error, "ligne FAIL → last_error renseigné"],
      [receivedIdempotencyKeys.includes(okId), "en-tête Idempotency-Key transmis à Resend (spec 23 §8.4)"],
      [summary.ok === true, `un refus propre à UNE ligne (422) ne rend pas le passage ok=false (${summary.ok})`]
    );

    // ── Débit (A2) ─────────────────────────────────────────────────────────────────────────────
    // a) Espacement : jamais deux envois à moins de 250 ms (4/s, sous les 10/s par équipe de Resend).
    // b) Fenêtre épuisée, remise à zéro courte (1 s) : le job attend, puis envoie le reste.
    // c) Fenêtre épuisée, remise à zéro longue (5 s > 2 s) : le reste du lot est rendu, sans tentative.
    const gaps = (from) => callTimes.slice(from).slice(1).map((t, i) => t - callTimes[from + i]);
    for (const [label, reset] of [["espacement", null], ["fenêtre courte", 1], ["fenêtre longue", 5]]) {
      await purgeFixtures(client);
      const paceIds = await insertEmails(client, PACE_EMAILS, `Integration débit ${label}`);
      const from = callTimes.length;
      rateResetOnce = reset;
      const paceRun = await runAsServiceRole(FUNCTIONS_URL);
      const paceSummary = JSON.parse(paceRun.text);
      console.log(`Réponse (débit, ${label}) :`, paceSummary, "écarts (ms) :", gaps(from).map(Math.round));
      outputs.push(paceRun.text);
      const { rows: afterPace } = await client.query(
        "select status, attempts, last_error from notification_emails where id = any($1) order by status, attempts",
        [paceIds]
      );
      if (reset === null) {
        checks.push([paceSummary.ok === true && paceSummary.sent === 3 && gaps(from).length === 2 && gaps(from).every((g) => g >= 240),
          `débit : 3 envois espacés d'au moins 250 ms (écarts ${gaps(from).map(Math.round).join(", ")} ms)`]);
      } else if (reset === 1) {
        checks.push([paceSummary.ok === true && paceSummary.sent === 3 && gaps(from)[0] >= 990 && gaps(from)[1] >= 240,
          `fenêtre épuisée (remise 1 s) : le job attend sa remise à zéro puis envoie le reste (écarts ${gaps(from).map(Math.round).join(", ")} ms)`]);
      } else {
        checks.push(
          [paceSummary.ok === true && paceSummary.sent === 1 && paceSummary.rate_deferred === 2 && paceSummary.released === 2 &&
            callTimes.length - from === 1,
            `fenêtre épuisée (remise 5 s) : 1 envoi, puis le reste rendu au passage suivant, passage ok (${paceRun.text})`],
          [afterPace.filter((r) => r.status === "pending").every((r) => r.attempts === 0) && afterPace.filter((r) => r.status === "pending").length === 2,
            `fenêtre longue : les 2 lignes rendues n'ont consommé aucune tentative (${JSON.stringify(afterPace)})`]
        );
      }
    }

    // ── Refus GLOBAUX de Resend (clé, domaine/compte, quota) : tout le lot rendu, aucune tentative ──
    for (const refusal of [401, 403, 429]) {
      await purgeFixtures(client);
      const refusedIds = await insertEmails(client, REFUSED_EMAILS, `Integration refusée ${refusal}`);
      resendRefusal = refusal;
      const callsBefore = resendCalls;
      const refusedRun = await runAsServiceRole(FUNCTIONS_URL);
      const refusedSummary = JSON.parse(refusedRun.text);
      console.log(`Réponse (Resend ${refusal}) :`, refusedSummary);
      outputs.push(refusedRun.text);
      const { rows: afterRefusal } = await client.query(
        "select status, attempts, last_error from notification_emails where id = any($1)",
        [refusedIds]
      );
      const { rows: heartbeat } = await client.query("select last_error from job_heartbeats where job_name = $1", [JOB]);
      outputs.push(JSON.stringify(afterRefusal), JSON.stringify(heartbeat));
      checks.push(
        [refusedSummary.ok === false && refusedSummary.released === 2 && refusedSummary.sent === 0 && resendCalls - callsBefore === 1,
          `Resend ${refusal} → passage arrêté au 1er appel, 2 e-mails rendus (${refusedRun.text})`],
        [afterRefusal.length === 2 && afterRefusal.every((r) => r.status === "pending" && r.attempts === 0 && r.last_error === `resend ${refusal}`),
          `Resend ${refusal} → rendus en attente SANS tentative consommée (${JSON.stringify(afterRefusal)})`],
        [heartbeat[0]?.last_error === `resend ${refusal} — envoi arrêté, lot rendu sans tentative consommée`,
          `Resend ${refusal} → heartbeat ok=false, motif exact (${heartbeat[0]?.last_error})`]
      );
    }

    // ── PANNE de Resend (503) : la ligne tentée compte sa tentative, le reste est rendu ──
    await purgeFixtures(client);
    const outageIds = await insertEmails(client, OUTAGE_EMAILS, "Integration panne");
    resendRefusal = 503;
    const callsBeforeOutage = resendCalls;
    const outageRun = await runAsServiceRole(FUNCTIONS_URL);
    const outageSummary = JSON.parse(outageRun.text);
    console.log("Réponse (Resend 503) :", outageSummary);
    outputs.push(outageRun.text);
    const { rows: afterOutage } = await client.query(
      "select status, attempts, last_error from notification_emails where id = any($1) order by attempts desc",
      [outageIds]
    );
    const { rows: outageHeartbeat } = await client.query("select last_error from job_heartbeats where job_name = $1", [JOB]);
    outputs.push(JSON.stringify(afterOutage), JSON.stringify(outageHeartbeat));
    checks.push(
      [outageSummary.ok === false && outageSummary.failed === 1 && outageSummary.released === 2 && outageSummary.transport_errors === 1 &&
        resendCalls - callsBeforeOutage === 1,
        `Resend 503 → 1 tentative, passage arrêté, 2 e-mails rendus (${outageRun.text})`],
      [afterOutage.length === 3 && afterOutage[0].status === "pending" && afterOutage[0].attempts === 1 && /^Resend 503/.test(afterOutage[0].last_error ?? "") &&
        /\[secret\]/.test(afterOutage[0].last_error ?? "") && !(afterOutage[0].last_error ?? "").includes(RESEND_KEY) &&
        afterOutage.slice(1).every((r) => r.status === "pending" && r.attempts === 0 && r.last_error === "resend 503"),
        `Resend 503 → la ligne tentée compte 1 tentative, les 2 autres aucune (${JSON.stringify(afterOutage)})`],
      [outageHeartbeat[0]?.last_error === "resend 503 — envoi arrêté, reste du lot rendu",
        `Resend 503 → heartbeat ok=false, motif exact (${outageHeartbeat[0]?.last_error})`]
    );
    const log = process.env.FUNCTION_LOG ? readFileSync(process.env.FUNCTION_LOG, "utf8") : "";
    checks.push([!outputs.join("\n").includes(RESEND_KEY) && !log.includes(RESEND_KEY),
      "la clé Resend n'apparaît ni dans les réponses, ni dans la file, ni dans le heartbeat, ni dans les journaux"]);

    let failed = false;
    for (const [okCheck, label] of checks) {
      console.log(`${okCheck ? "OK " : "FAIL"} — ${label}`);
      if (!okCheck) failed = true;
    }

    if (failed) {
      console.error(
        "Échec — vérifier que supabase/functions/.env pointe bien RESEND_API_BASE_URL vers " +
          `http://host.docker.internal:${FIXTURE_PORT} et que supabase a été redémarré après ce réglage.`
      );
      exitCode = 1;
    } else {
      console.log("send-notification-emails : intégration bout en bout vérifiée.");
    }
  } catch (err) {
    console.error(err);
    exitCode = 1;
  } finally {
    await purgeFixtures(client).catch((err) => console.error("Nettoyage final a échoué :", err));
    await restoreHeartbeat(client, JOB, heartbeatBefore).catch((err) => console.error("Restauration du heartbeat a échoué :", err));
    await client.end();
    await new Promise((resolve) => fixtureServer.close(resolve));
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
