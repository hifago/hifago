// P6 — test d'intégration RÉEL de l'Edge Function pms-nightly-contract-check contre la stack
// Supabase locale et un LobbyPMS de fixtures. Lancé par le job CI `integration-edge` (audit P12d ;
// P6 l'avait laissé manuel, décision D8), et à la main en local.
//
// CE QU'IL PROUVE :
//   - seule la clé service_role déclenche le job (sans en-tête, anon, publishable → 401) ;
//   - un GET /rooms en échec (ici une page 502 qui RECOPIE l'URL, jeton compris) rend le passage
//     `ok=false` — et le jeton n'apparaît ni dans les dérives rendues, ni dans le heartbeat, ni dans
//     les journaux (si FUNCTION_LOG est fourni) ;
//   - les annulations en échec « jeton Lobby remplacé » (migration 20261004005336) sont comptées À
//     PART de celles qui ont épuisé leurs tentatives, et les bookings de l'ancien jeton en attente de
//     vérification aussi ;
//   - le coût en appels Lobby : 2 par établissement contrôlé, 1 quand GET /rooms échoue.
//
// PRÉREQUIS : npx supabase start, le Vault SANS pms_service_role_key ; la fonction servie avec
// LOBBY_API_BASE_URL vers la fixture de ce script (port 4545) ; aucun autre établissement au
// connecteur actif, aucune autre annulation en échec, aucune autre entrée « jeton remplacé » ouverte
// (le job les lit toutes — sinon arrêt, exit 2).
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
const FUNCTIONS_URL = localFunctionsUrl("pms-nightly-contract-check");
const FIXTURE_PORT = 4545;
const JOB = "pms-nightly-contract-check";
const GOOD_TOKEN = "IntegNightlyGoodToken0123456789abcdefghijklmnopqrstuvwxyzABC";
const BAD_TOKEN = "IntegNightlyBadToken0123456789abcdefghijklmnopqrstuvwxyzABCD";

const P = "7a7c0000-0000-4000-8000-";
const PARTNER_ID = `${P}000000000001`;
const GOOD_ID = `${P}000000000011`;
const BAD_ID = `${P}000000000012`;
const LODGING_ID = `${P}000000000021`;
const ACCOUNT_ID = `${P}000000000031`;
const ORDER_ID = `${P}000000000041`;
const LINE_ID = `${P}000000000051`;
const REPLACED_DETAIL = "jeton Lobby remplacé : booking 94000003 posé avec l'ancien jeton — à vérifier à la main";
const ROOMS = {
  data: [{ category_id: 777001, name: "Doble", type: "room", capacity: 2, quantity: 1, descriptions: [{ lang: "es", text: "Doble" }], photos: [{ url: "https://example.test/p.jpg" }] }],
  meta: { total_records: 1, total_pages: 1 },
};
let lobbyCalls = 0;

function startFixtureServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    lobbyCalls++;
    const token = url.searchParams.get("api_token");
    if (req.method === "GET" && url.pathname === "/api/v1/rooms") {
      if (token === BAD_TOKEN) {
        res.writeHead(502, { "Content-Type": "text/html" });
        res.end(`<html><body><h1>502 Bad Gateway</h1><p>GET ${req.url}</p></body></html>`);
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(ROOMS));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/v2/available-rooms") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ date: url.searchParams.get("start_date"), categories: [{ category_id: 777001, available_rooms: 1, plans: [] }] }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Resource Not Found." }));
  });
  // Toutes les interfaces, pas 127.0.0.1 : la fonction tourne dans le conteneur du runtime Edge et
  // joint la fixture par host.docker.internal — sous Linux (job CI integration-edge), une écoute
  // limitée au loopback de l'hôte lui est injoignable. Même écoute que pms_sync_availability.
  return new Promise((resolve) => server.listen(FIXTURE_PORT, () => resolve(server)));
}

async function purgeFixtures(client) {
  await client.query(
    `delete from notification_emails where related_table = 'pms_reconciliation_entries' and related_id in (
       select id from pms_reconciliation_entries where order_line_id = $1)`,
    [LINE_ID]
  );
  await client.query("delete from pms_reconciliation_entries where order_line_id = $1", [LINE_ID]);
  await client.query("delete from order_lines where order_id = $1", [ORDER_ID]);
  await client.query("delete from orders where id = $1", [ORDER_ID]);
  await client.query("delete from products where id = $1", [LODGING_ID]);
  await client.query("delete from pms_cancellation_queue where establishment_id in ($1, $2)", [GOOD_ID, BAD_ID]);
  await client.query("delete from establishments where id in ($1, $2)", [GOOD_ID, BAD_ID]);
  await client.query("delete from partners where id = $1", [PARTNER_ID]);
  await client.query("delete from auth.users where id = $1", [ACCOUNT_ID]);
}

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  await refuseIfCronsCanFire(client);
  await refuseIfForeignRows(
    client,
    "établissement(s) au connecteur actif",
    "select count(*)::int as n from establishments where lobby_connector_active and id not in ($1, $2)",
    [GOOD_ID, BAD_ID]
  );
  await refuseIfForeignRows(
    client,
    "annulation(s) en échec",
    "select count(*)::int as n from pms_cancellation_queue where status = 'failed' and establishment_id not in ($1, $2)",
    [GOOD_ID, BAD_ID]
  );
  await refuseIfForeignRows(
    client,
    "entrée(s) « jeton remplacé » ouverte(s)",
    `select count(*)::int as n from pms_reconciliation_entries
      where status in ('open', 'retrying') and detail like 'jeton Lobby remplacé%' and order_line_id <> $1`,
    [LINE_ID]
  );
  const fixtureServer = await startFixtureServer();
  let exitCode = 0;
  const heartbeatBefore = await snapshotHeartbeat(client, JOB);

  try {
    await purgeFixtures(client);
    await client.query("insert into partners (id, display_name) values ($1, 'Nightly Integration Owner')", [PARTNER_ID]);
    await client.query(
      `insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token) values
         ($1, $3, '{"es":"Nightly OK"}'::jsonb, true, $4), ($2, $3, '{"es":"Nightly KO"}'::jsonb, true, $5)`,
      [GOOD_ID, BAD_ID, PARTNER_ID, GOOD_TOKEN, BAD_TOKEN]
    );
    await client.query(
      `insert into pms_cancellation_queue (pms_booking_id, establishment_id, hifago_status, status, last_error) values
         ('94000001', $1, 'expired', 'failed', 'HTTP 503 — {"message":"Service Unavailable"}'),
         ('94000002', $1, 'expired', 'failed', 'jeton Lobby remplacé : annulation à vérifier à la main avant tout renvoi')`,
      [GOOD_ID]
    );
    // Un booking posé avec l'ancien jeton, en attente de vérification manuelle (entrée muette ouverte).
    await client.query("insert into auth.users (id, email) values ($1, 'nightly-integration@test.local')", [ACCOUNT_ID]);
    await client.query(
      `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id)
       values ($1, $2, $3, 'lodging', '{"es":"Nightly Noche"}'::jsonb, 100000, true, 'nightly-integration-noche', 777001)`,
      [LODGING_ID, PARTNER_ID, GOOD_ID]
    );
    await client.query(
      `insert into orders (id, account_id, holder_name, holder_email, payment_status, reference)
       values ($1, $2, 'Nightly', 'nightly-integration@test.local', 'paid', 'NIGHTLY-INT-1')`,
      [ORDER_ID, ACCOUNT_ID]
    );
    await client.query(
      `insert into order_lines (id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
         price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
         acompte_cop, referrer_commission_cop, app_commission_cop, pms_booking_id)
       values ($1, $2, $3, $4, '2029-03-01', '2029-03-02', 1, 'reserved', 'Nightly', 100000, 100000, 'direct',
               0.17, 0, 0.17, 17000, 0, 17000, '94000003')`,
      [LINE_ID, ORDER_ID, ACCOUNT_ID, LODGING_ID]
    );
    await client.query("insert into pms_reconciliation_entries (order_line_id, detail) values ($1, $2)", [LINE_ID, REPLACED_DETAIL]);

    const checks = [];
    checks.push(...(await callerChecks(FUNCTIONS_URL)));
    checks.push([lobbyCalls === 0, `aucun refus n'a appelé Lobby (${lobbyCalls})`]);

    const { status, text } = await runAsServiceRole(FUNCTIONS_URL);
    console.log("Passage :", status, text.slice(0, 600));
    const result = JSON.parse(text);
    const { rows: heartbeat } = await client.query("select last_error from job_heartbeats where job_name = $1", [JOB]);
    checks.push(
      [status === 200 && result.ok === false && result.checked === 2 && result.unchecked === 0,
        `passage → 200, ok=false (un GET /rooms en échec), 2 établissements contrôlés, 0 sauté (${result.ok}, ${result.checked}, ${result.unchecked})`],
      [result.failed_cancellations === 1 && result.token_replaced_cancellations === 1 && result.token_replaced_bookings === 1,
        `comptés à part : ${result.failed_cancellations} annulation après tentatives, ${result.token_replaced_cancellations} « jeton remplacé », ${result.token_replaced_bookings} booking en attente de vérification`],
      [lobbyCalls === 3, `appels Lobby : 2 pour l'établissement sain, 1 pour celui dont GET /rooms échoue (${lobbyCalls})`],
      [result.drifts.some((d) => d.includes(BAD_ID) && d.includes("status 502")), "la dérive du GET /rooms en échec est rendue"],
      [heartbeat[0]?.last_error === `lobby : GET /rooms en échec pour 1 établissement(s) (${BAD_ID.slice(0, 8)})`,
        `heartbeat ok=false, motif exact (${heartbeat[0]?.last_error})`],
      [!text.includes(BAD_TOKEN) && !text.includes(GOOD_TOKEN) && !JSON.stringify(heartbeat).includes(BAD_TOKEN),
        "aucun jeton dans la réponse ni dans le heartbeat (la page 502 recopiait l'URL)"],
      ...logChecks([BAD_TOKEN, GOOD_TOKEN])
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
