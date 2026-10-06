// P6 — test d'intégration RÉEL de l'Edge Function pms-cancel-bookings contre la stack Supabase
// locale et un LobbyPMS de fixtures. Manuel (aucun job CI — décision D8 de P6) : la preuve est
// consignée au rapport qui le lance.
//
// CE QU'IL PROUVE :
//   - seule la clé service_role déclenche le job (sans en-tête, anon, publishable → 401) ;
//   - annulation acceptée (`{cancel_booking}`, statut ≠ 200) → done ;
//   - « déjà annulé » = 422 RECORD_NOT_FOUND → done ;
//   - 404 de ROUTAGE → JAMAIS un succès : réessai (entrée en attente, motif court, aux 1re ET 2e
//     tentatives), puis échec au plafond (3e) ;
//   - 422 RESTRICTED_RESERVATION → close avec son code ;
//   - heartbeat `ok=false` avec son motif exact, et le jeton nulle part (heartbeat, file, réponse,
//     journaux si FUNCTION_LOG est fourni).
//
// PRÉREQUIS : npx supabase start, le Vault SANS pms_service_role_key ; la fonction servie avec
// LOBBY_API_BASE_URL vers la fixture de ce script (port 4545) ; aucune autre annulation en attente
// dans la base (le claim est global — sinon arrêt, exit 2). La fixture répond 500 à tout booking
// qu'elle ne connaît pas : jamais « déjà annulé ».
import pg from "pg";
import { createServer } from "node:http";
import {
  CONNECTION_STRING,
  callerChecks,
  localFunctionsUrl,
  logChecks,
  refuseIfCronsCanFire,
  refuseIfForeignRows,
  report,
  restoreHeartbeat,
  runAsServiceRole,
  snapshotHeartbeat,
} from "../support/edgeJobIntegration.mjs";

const { Client } = pg;
const FUNCTIONS_URL = localFunctionsUrl("pms-cancel-bookings");
const FIXTURE_PORT = 4545;
const JOB = "pms-cancel-bookings";
const LOBBY_TOKEN = "IntegCancelToken0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH";

const P = "7a7b0000-0000-4000-8000-";
const PARTNER_ID = `${P}000000000001`;
const ESTABLISHMENT_ID = `${P}000000000011`;
// Booking → réponse de la fixture.
const BOOKING = {
  accepted: 93000001, alreadyDone: 93000002, routing: 93000003, restricted: 93000004, lastTry: 93000005, secondTry: 93000006,
};
const RESPONSES = {
  [BOOKING.accepted]: { status: 201, body: { cancel_booking: BOOKING.accepted } },
  [BOOKING.alreadyDone]: { status: 422, body: { error_code: "RECORD_NOT_FOUND" } },
  [BOOKING.routing]: { status: 404, body: { error: "Resource Not Found." } },
  [BOOKING.restricted]: { status: 422, body: { error_code: "RESTRICTED_RESERVATION" } },
  [BOOKING.lastTry]: { status: 404, body: { error: "Resource Not Found." } },
  [BOOKING.secondTry]: { status: 404, body: { error: "Resource Not Found." } },
};
const calls = [];

function startFixtureServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const match = url.pathname.match(/^\/api\/v1\/cancel-booking\/(\d+)$/);
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (req.method === "POST" && match) {
        const bookingId = Number(match[1]);
        calls.push({ bookingId, tokenInBody: JSON.parse(raw || "{}").api_token === LOBBY_TOKEN });
        const entry = RESPONSES[bookingId] ?? { status: 500, body: { message: "booking inconnu de la fixture" } };
        res.writeHead(entry.status, { "Content-Type": "application/json" });
        // Un 404 de routage (relais) qui RECOPIE la requête reçue, jeton compris : la vérification
        // « aucun jeton dans la file » porte sur une valeur réellement présente.
        res.end(JSON.stringify(entry.status === 404 ? { ...entry.body, input: JSON.parse(raw || "{}") } : entry.body));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "unhandled by fixture server" }));
    });
  });
  return new Promise((resolve) => server.listen(FIXTURE_PORT, "127.0.0.1", () => resolve(server)));
}

async function purgeFixtures(client) {
  await client.query("delete from pms_cancellation_queue where establishment_id = $1", [ESTABLISHMENT_ID]);
  await client.query("delete from pms_sync_state where establishment_id = $1", [ESTABLISHMENT_ID]);
  await client.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await client.query("delete from partners where id = $1", [PARTNER_ID]);
}

async function resetFixtures(client) {
  await purgeFixtures(client);
  await client.query("insert into partners (id, display_name) values ($1, 'Cancel Integration Owner')", [PARTNER_ID]);
  await client.query(
    `insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token)
     values ($1, $2, $3, true, $4)`,
    [ESTABLISHMENT_ID, PARTNER_ID, JSON.stringify({ es: "Cancel Integration Establishment" }), LOBBY_TOKEN]
  );
  // `lastTry` est à sa dernière tentative (le claim l'incrémente à 3 = MAX_ATTEMPTS) ; `secondTry` à
  // sa deuxième (→ 2, encore en attente).
  await client.query(
    `insert into pms_cancellation_queue (pms_booking_id, establishment_id, hifago_status, attempts)
     select b, $1, 'expired', case when b = $3 then 2 when b = $4 then 1 else 0 end from unnest($2::text[]) b`,
    [ESTABLISHMENT_ID, Object.values(BOOKING).map(String), String(BOOKING.lastTry), String(BOOKING.secondTry)]
  );
}

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  await refuseIfCronsCanFire(client);
  await refuseIfForeignRows(
    client,
    "annulation(s) en attente",
    "select count(*)::int as n from pms_cancellation_queue where status = 'pending' and establishment_id <> $1",
    [ESTABLISHMENT_ID]
  );
  const fixtureServer = await startFixtureServer();
  let exitCode = 0;
  const heartbeatBefore = await snapshotHeartbeat(client, JOB);

  try {
    await resetFixtures(client);
    const checks = [];

    checks.push(...(await callerChecks(FUNCTIONS_URL)));
    checks.push([calls.length === 0, `aucun refus n'a appelé Lobby (${calls.length} appel(s))`]);

    const run = await runAsServiceRole(FUNCTIONS_URL);
    console.log("Passage :", run.status, run.text);
    const summary = JSON.parse(run.text);
    checks.push([
      run.status === 200 && summary.ok === false && summary.claimed === 6 && summary.cancelled === 1 && summary.already_gone === 1 &&
        summary.restricted === 1 && summary.retried === 2 && summary.failed === 1 && summary.skipped === 0,
      `résumé : 6 réclamées, 1 annulée, 1 déjà annulée (422), 1 close (RESTRICTED), 2 retentées, 1 en échec, ok=false (${run.text.slice(0, 220)})`,
    ]);
    checks.push([calls.every((c) => c.tokenInBody), "le jeton part dans le CORPS du POST (jamais dans l'URL)"]);

    const { rows } = await client.query(
      "select pms_booking_id, status, attempts, lobby_status_code, last_error from pms_cancellation_queue where establishment_id = $1",
      [ESTABLISHMENT_ID]
    );
    const byBooking = Object.fromEntries(rows.map((r) => [Number(r.pms_booking_id), r]));
    checks.push(
      [byBooking[BOOKING.accepted]?.status === "done", `cancel_booking (201) → done (${byBooking[BOOKING.accepted]?.status})`],
      [byBooking[BOOKING.alreadyDone]?.status === "done", `422 RECORD_NOT_FOUND → done (${byBooking[BOOKING.alreadyDone]?.status})`],
      [byBooking[BOOKING.routing]?.status === "pending" && /^HTTP 404/.test(byBooking[BOOKING.routing]?.last_error ?? ""),
        `404 de routage → jamais un succès : en attente, motif « ${byBooking[BOOKING.routing]?.last_error} »`],
      [byBooking[BOOKING.restricted]?.status === "done" && byBooking[BOOKING.restricted]?.last_error === "422 RESTRICTED_RESERVATION",
        `422 RESTRICTED_RESERVATION → close avec son code (${byBooking[BOOKING.restricted]?.last_error})`],
      [byBooking[BOOKING.lastTry]?.status === "failed" && byBooking[BOOKING.lastTry]?.lobby_status_code === 404,
        `404 à la dernière tentative → failed (${byBooking[BOOKING.lastTry]?.status}, ${byBooking[BOOKING.lastTry]?.lobby_status_code})`],
      [byBooking[BOOKING.secondTry]?.status === "pending" && byBooking[BOOKING.secondTry]?.attempts === 2,
        `404 à la 2e tentative → encore en attente, 2 tentatives comptées (${byBooking[BOOKING.secondTry]?.status}, ${byBooking[BOOKING.secondTry]?.attempts})`]
    );

    const { rows: heartbeat } = await client.query("select last_error from job_heartbeats where job_name = $1", [JOB]);
    const expectedError = `lobby : 3 annulation(s) en échec sur 6 — HTTP 404 (établissement ${ESTABLISHMENT_ID.slice(0, 8)}) ×3`;
    checks.push(
      [heartbeat[0]?.last_error === expectedError, `heartbeat ok=false, motif exact (${heartbeat[0]?.last_error})`],
      [!JSON.stringify(rows).includes(LOBBY_TOKEN) && !JSON.stringify(heartbeat).includes(LOBBY_TOKEN) && !run.text.includes(LOBBY_TOKEN) &&
        /\[secret\]/.test(byBooking[BOOKING.routing]?.last_error ?? ""),
        `le 404 recopiait le jeton : masqué dans la file (${byBooking[BOOKING.routing]?.last_error}), absent du heartbeat et de la réponse`],
      ...logChecks([LOBBY_TOKEN])
    );

    exitCode = report(checks, JOB);
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
