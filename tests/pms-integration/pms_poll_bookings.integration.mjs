// Spec 21 / P6 — test d'intégration RÉEL de l'Edge Function pms-poll-bookings contre la stack
// Supabase locale et un LobbyPMS de fixtures. Manuel (aucun job CI — décision D8 de P6) : la preuve
// est consignée au rapport qui le lance.
//
// CE QU'IL PROUVE :
//   - seule la clé service_role déclenche le job : sans en-tête, avec la clé anon, avec une clé
//     publishable → 401 ;
//   - booking disparu (404 Laravel) → apply_pms_poll_outcome : lignes du booking annulées en une
//     fois (nuit + activité), place de l'activité rendue, ledger référent reversed, UNE entrée
//     détaillée (commande payée : le dit) ;
//   - séjour réalisé (checkout_realizado = 1) → lignes échues fulfilled, commission due ;
//   - 404 de ROUTAGE et 502 HTML (qui recopie l'URL, jeton compris) → rien ne bouge, aucune entrée,
//     heartbeat `ok=false` — et le jeton n'apparaît NI dans le heartbeat, NI dans la réponse, NI dans
//     les journaux de la fonction (si FUNCTION_LOG est fourni) ;
//   - traslado, estatus inconnu (« cancelado »), deleted_at posé → UNE entrée de signal chacun, jamais
//     redoublée au passage suivant, et rien ne bouge ; un signal déjà résolu pour la même commande
//     n'est jamais reposté.
//
// PRÉREQUIS :
//   1. npx supabase start actif, le Vault SANS pms_service_role_key (sinon arrêt, exit 2) ;
//   2. la fonction servie avec LOBBY_API_BASE_URL vers la fixture de ce script (port 4545) — soit par
//      l'edge runtime (supabase/functions/.env : http://host.docker.internal:4545), soit en Deno
//      autonome (FUNCTIONS_URL=http://127.0.0.1:<port>, LOBBY_API_BASE_URL=http://127.0.0.1:4545) ;
//   3. la base ne contient aucune autre ligne bookée réclamable (le claim est global — sinon arrêt,
//      exit 2). La fixture répond 500 à tout booking qu'elle ne connaît pas : jamais « disparu ».
import pg from "pg";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
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
const FUNCTIONS_URL = localFunctionsUrl("pms-poll-bookings");
const FIXTURE_PORT = 4545;
const JOB = "pms-poll-bookings";
// Un jeton Lobby de la forme d'un vrai (60 caractères) — factice.
const LOBBY_TOKEN = "IntegPollToken0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJ";

const P = "7a7a0000-0000-4000-8000-";
const id = (n) => `${P}${String(n).padStart(12, "0")}`;
const PARTNER_ID = id(1);
const REFERRER_ID = id(2);
const ESTABLISHMENT_ID = id(11);
const LODGING_ID = id(21);
const ACTIVITY_ID = id(22);
const ACCOUNT_ID = id(31);
const ORDER_ID = id(41);
const BOOKING = {
  gone: 92000001, realized: 92000002, routing: 92000003, html: 92000004, traslado: 92000005,
  cancelado: 92000006, deleted: 92000007, resolved: 92000008,
};
const LINE = {
  goneNight: id(51), goneActivity: id(52), realized: id(53), routing: id(54), html: id(55), traslado: id(56),
  cancelado: id(57), deleted: id(58), resolved: id(59),
};
const SIGNAL_SUFFIX = " — à vérifier chez Lobby, aucune action automatique";
const TRASLADO = "traslado possible (total_alojamiento à 0, sans remise)";
const signalDetail = (booking, what) => `signal Lobby sur le booking ${booking} : ${what}${SIGNAL_SUFFIX}`;
const ACTIVITY_DATE = "2029-03-02";

const trasladoBody = {
  data: { estatus: "completo", checkin_realizado: null, checkout_realizado: null, total_alojamiento: "0.00", descuentos: [], deleted_at: null },
};
const scenario = {
  [BOOKING.gone]: { status: 404, body: { message: "No query results for model [App\\Models\\Booking]." } },
  [BOOKING.realized]: {
    status: 200,
    body: { data: { estatus: "fin", checkin_realizado: 1, checkout_realizado: 1, total_alojamiento: "100000.00", descuentos: [], deleted_at: null } },
  },
  [BOOKING.routing]: { status: 404, body: { error: "Resource Not Found." } },
  [BOOKING.traslado]: { status: 200, body: trasladoBody },
  [BOOKING.cancelado]: {
    status: 200,
    body: { data: { estatus: "cancelado", checkin_realizado: null, checkout_realizado: null, total_alojamiento: "100000.00", descuentos: [], deleted_at: null } },
  },
  [BOOKING.deleted]: {
    status: 200,
    body: { data: { estatus: "completo", checkin_realizado: null, checkout_realizado: null, total_alojamiento: "100000.00", descuentos: [], deleted_at: "2029-02-01 10:00:00" } },
  },
  [BOOKING.resolved]: { status: 200, body: trasladoBody },
  // BOOKING.html → 502 HTML qui recopie l'URL (ci-dessous).
};

function startFixtureServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const match = url.pathname.match(/^\/api\/v1\/bookings\/(\d+)$/);
    if (req.method === "GET" && match) {
      const bookingId = Number(match[1]);
      if (bookingId === BOOKING.html) {
        // Une page d'erreur de proxy qui RECOPIE la requête, jeton compris.
        res.writeHead(502, { "Content-Type": "text/html" });
        res.end(`<html><body><h1>502 Bad Gateway</h1><p>GET ${req.url}</p></body></html>`);
        return;
      }
      const entry = scenario[bookingId];
      if (!entry) {
        // Un booking inconnu de la fixture n'est JAMAIS « disparu » : une panne, rien ne bouge.
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "booking inconnu de la fixture" }));
        return;
      }
      res.writeHead(entry.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(entry.body));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "unhandled by fixture server" }));
  });
  return new Promise((resolve) => server.listen(FIXTURE_PORT, "127.0.0.1", () => resolve(server)));
}

async function purgeFixtures(client) {
  await client.query(
    `delete from notification_emails where related_table = 'pms_reconciliation_entries' and related_id in (
       select e.id from pms_reconciliation_entries e join order_lines ol on ol.id = e.order_line_id where ol.order_id = $1)`,
    [ORDER_ID]
  );
  await client.query(
    "delete from pms_reconciliation_entries where order_line_id in (select id from order_lines where order_id = $1)",
    [ORDER_ID]
  );
  // L'annulation par le poll enfile le booking (trigger) : la file ne référence pas la ligne par FK.
  await client.query("delete from pms_cancellation_queue where pms_booking_id = any($1::text[])", [
    Object.values(BOOKING).map(String),
  ]);
  await client.query("delete from ledger_entries where order_line_id in (select id from order_lines where order_id = $1)", [ORDER_ID]);
  await client.query("delete from pms_sync_state where establishment_id = $1", [ESTABLISHMENT_ID]);
  await client.query("delete from order_lines where order_id = $1", [ORDER_ID]);
  await client.query("delete from orders where id = $1", [ORDER_ID]);
  await client.query("delete from product_availability where product_id in ($1, $2)", [LODGING_ID, ACTIVITY_ID]);
  await client.query("delete from products where id in ($1, $2)", [LODGING_ID, ACTIVITY_ID]);
  await client.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await client.query("delete from partners where id in ($1, $2)", [PARTNER_ID, REFERRER_ID]);
  await client.query("delete from partner_accounts where id = $1", [ACCOUNT_ID]);
  await client.query("delete from auth.users where id = $1", [ACCOUNT_ID]);
}

async function resetFixtures(client) {
  await purgeFixtures(client);
  await client.query("insert into auth.users (id, email) values ($1, 'pms-poll-integration@test.local')", [ACCOUNT_ID]);
  await client.query("insert into partners (id, display_name) values ($1, 'Poll Integration Owner'), ($2, 'Poll Integration Referrer')", [
    PARTNER_ID,
    REFERRER_ID,
  ]);
  await client.query(
    `insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token)
     values ($1, $2, $3, true, $4)`,
    [ESTABLISHMENT_ID, PARTNER_ID, JSON.stringify({ es: "Poll Integration Establishment" }), LOBBY_TOKEN]
  );
  await client.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id) values
       ($1, $3, $4, 'lodging', $5, 100000, true, $6, 9631),
       ($2, $3, $4, 'activity', $7, 30000, true, $8, null)`,
    [LODGING_ID, ACTIVITY_ID, PARTNER_ID, ESTABLISHMENT_ID, JSON.stringify({ es: "Poll Integration Lodging" }),
     `poll-integration-${randomUUID()}`, JSON.stringify({ es: "Poll Integration Activity" }), `poll-integration-${randomUUID()}`]
  );
  // L'activité du booking disparu tient 2 places le ACTIVITY_DATE (5 prises en tout).
  await client.query("insert into product_availability (product_id, date, capacity, booked) values ($1, $2, 10, 5)", [
    ACTIVITY_ID,
    ACTIVITY_DATE,
  ]);
  await client.query(
    `insert into orders (id, account_id, holder_name, holder_email, payment_status, reference)
     values ($1, $2, 'Poll Integration', 'pms-poll-integration@test.local', 'paid', 'POLL-INT-1')`,
    [ORDER_ID, ACCOUNT_ID]
  );
  const line = (lineId, productId, date, endDate, qty, booking, referrer) =>
    client.query(
      `insert into order_lines (
         id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
         price_cop, total_cop, commission_case, referrer_partner_id, acompte_pct, referrer_pct, app_pct,
         acompte_cop, referrer_commission_cop, app_commission_cop, pms_booking_id, pms_last_polled_at
       ) values ($1, $2, $3, $4, $5, $6, $7, 'reserved', 'Poll Integration', 100000, 100000,
                 $8, $9, 0.17, $10::numeric, 0.17 - $10::numeric, 17000, $11::bigint, 17000 - $11::bigint, $12, '2000-01-01')`,
      [lineId, ORDER_ID, ACCOUNT_ID, productId, date, endDate, qty,
       referrer ? "external_referrer" : "direct", referrer ? REFERRER_ID : null,
       referrer ? 0.1 : 0, referrer ? 10000 : 0, String(booking)]
    );
  await line(LINE.goneNight, LODGING_ID, "2029-03-01", "2029-03-03", 1, BOOKING.gone, false);
  await line(LINE.goneActivity, ACTIVITY_ID, ACTIVITY_DATE, null, 2, BOOKING.gone, true);
  // Séjour PASSÉ (realized ne réalise que des lignes échues), commission référent.
  await line(LINE.realized, LODGING_ID, "2026-01-01", "2026-01-03", 1, BOOKING.realized, true);
  await line(LINE.routing, LODGING_ID, "2029-04-01", "2029-04-02", 1, BOOKING.routing, false);
  await line(LINE.html, LODGING_ID, "2029-05-01", "2029-05-02", 1, BOOKING.html, false);
  await line(LINE.traslado, LODGING_ID, "2029-06-01", "2029-06-02", 1, BOOKING.traslado, false);
  await line(LINE.cancelado, LODGING_ID, "2029-07-01", "2029-07-02", 1, BOOKING.cancelado, false);
  await line(LINE.deleted, LODGING_ID, "2029-08-01", "2029-08-02", 1, BOOKING.deleted, false);
  await line(LINE.resolved, LODGING_ID, "2029-09-01", "2029-09-02", 1, BOOKING.resolved, false);
  // Le même signal, déjà posé ET résolu par un admin pour cette commande : jamais reposté.
  await client.query("insert into pms_reconciliation_entries (order_line_id, detail, status) values ($1, $2, 'resolved')", [
    LINE.resolved,
    signalDetail(BOOKING.resolved, TRASLADO),
  ]);
  await client.query(
    `insert into ledger_entries (order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status)
     values ($1, 'referrer', $3, 'referral_earned', 10000, 'estimated'), ($2, 'referrer', $3, 'referral_earned', 10000, 'estimated')`,
    [LINE.goneActivity, LINE.realized, REFERRER_ID]
  );
}

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  await refuseIfCronsCanFire(client);
  await refuseIfForeignRows(
    client,
    "ligne(s) bookée(s) réclamable(s)",
    `select count(*)::int as n from order_lines ol join products p on p.id = ol.product_id join establishments e on e.id = p.establishment_id
      where ol.pms_booking_id is not null and ol.status = 'reserved' and e.lobby_connector_active and e.lobby_api_token is not null
        and ol.order_id <> $1`,
    [ORDER_ID]
  );
  const fixtureServer = await startFixtureServer();
  let exitCode = 0;
  // Le heartbeat de ce job, tel qu'avant le test — restauré à la fin (la pile est partagée).
  const heartbeatBefore = await snapshotHeartbeat(client, JOB);

  try {
    await resetFixtures(client);
    const checks = [];

    // ── Contrôle d'appelant ──────────────────────────────────────────────────────────────────
    checks.push(...(await callerChecks(FUNCTIONS_URL)));
    const { rows: untouched } = await client.query(
      "select count(*)::int as n from order_lines where order_id = $1 and pms_last_polled_at = '2000-01-01'",
      [ORDER_ID]
    );
    checks.push([untouched[0].n === 9, `aucun refus n'a réclamé de ligne (${untouched[0].n}/9 intactes)`]);

    // ── Deux passages avec la clé service_role ───────────────────────────────────────────────
    const first = await runAsServiceRole(FUNCTIONS_URL);
    const second = await runAsServiceRole(FUNCTIONS_URL);
    console.log("Passage 1 :", first.status, first.text);
    console.log("Passage 2 :", second.status, second.text);
    checks.push([first.status === 200 && second.status === 200, `deux passages → 200 (${first.status}, ${second.status})`]);
    const summary = JSON.parse(first.text);
    checks.push([
      summary.ok === false && summary.polled === 8 && summary.gone === 1 && summary.realized === 1 && summary.signaled === 3 &&
        summary.errors === 2,
      `résumé du 1er passage : 8 interrogés, 1 disparu, 1 réalisé, 3 signaux (le 4e déjà résolu), 2 échecs passagers, ok=false (${first.text.slice(0, 200)})`,
    ]);
    const secondSummary = JSON.parse(second.text);
    checks.push([secondSummary.polled === 6 && secondSummary.signaled === 0,
      `2e passage : 6 interrogés (disparu et réalisé clos), aucun signal reposté (${secondSummary.polled}, ${secondSummary.signaled})`]);

    const { rows: lines } = await client.query("select id, status from order_lines where order_id = $1", [ORDER_ID]);
    const status = Object.fromEntries(lines.map((r) => [r.id, r.status]));
    checks.push(
      [status[LINE.goneNight] === "cancelled_by_provider" && status[LINE.goneActivity] === "cancelled_by_provider",
        `404 Laravel → nuit ET activité du booking cancelled_by_provider (${status[LINE.goneNight]}, ${status[LINE.goneActivity]})`],
      [status[LINE.realized] === "fulfilled", `checkout_realizado=1 → fulfilled (${status[LINE.realized]})`],
      [[LINE.routing, LINE.html, LINE.traslado, LINE.cancelado, LINE.deleted, LINE.resolved].every((l) => status[l] === "reserved"),
        `404 de routage, 502 HTML et signaux → rien ne bouge (${[LINE.routing, LINE.html, LINE.traslado, LINE.cancelado, LINE.deleted, LINE.resolved].map((l) => status[l]).join(", ")})`]
    );

    const { rows: capacity } = await client.query("select booked from product_availability where product_id = $1 and date = $2", [
      ACTIVITY_ID,
      ACTIVITY_DATE,
    ]);
    checks.push([capacity[0].booked === 3, `place de l'activité rendue (booked 5 → ${capacity[0].booked}, attendu 3)`]);

    const { rows: ledger } = await client.query(
      "select order_line_id, status from ledger_entries where order_line_id = any($1::uuid[])",
      [[LINE.goneActivity, LINE.realized]]
    );
    const ledgerStatus = Object.fromEntries(ledger.map((r) => [r.order_line_id, r.status]));
    checks.push(
      [ledgerStatus[LINE.goneActivity] === "reversed", `ledger du booking disparu → reversed (${ledgerStatus[LINE.goneActivity]})`],
      [ledgerStatus[LINE.realized] === "due", `ledger du séjour réalisé → due (${ledgerStatus[LINE.realized]})`]
    );

    const { rows: entries } = await client.query(
      `select ol.pms_booking_id, e.detail, e.status from pms_reconciliation_entries e join order_lines ol on ol.id = e.order_line_id
        where ol.order_id = $1 order by ol.pms_booking_id`,
      [ORDER_ID]
    );
    const byBooking = (b) => entries.filter((e) => e.pms_booking_id === String(b));
    checks.push(
      [byBooking(BOOKING.gone).length === 1 && /introuvable chez Lobby.*PAYÉE/.test(byBooking(BOOKING.gone)[0].detail),
        `booking disparu → UNE entrée détaillée, commande payée signalée (${byBooking(BOOKING.gone).map((e) => e.detail).join(" | ")})`],
      [byBooking(BOOKING.traslado).length === 1 && byBooking(BOOKING.traslado)[0].detail === signalDetail(BOOKING.traslado, TRASLADO),
        `traslado → UNE entrée de signal sur deux passages (${byBooking(BOOKING.traslado).map((e) => e.detail).join(" | ")})`],
      [byBooking(BOOKING.cancelado).length === 1 && byBooking(BOOKING.cancelado)[0].detail === signalDetail(BOOKING.cancelado, "estatus « cancelado »"),
        `estatus inconnu → UNE entrée de signal (${byBooking(BOOKING.cancelado).map((e) => e.detail).join(" | ")})`],
      [byBooking(BOOKING.deleted).length === 1 && byBooking(BOOKING.deleted)[0].detail === signalDetail(BOOKING.deleted, "deleted_at posé"),
        `deleted_at posé → UNE entrée de signal (${byBooking(BOOKING.deleted).map((e) => e.detail).join(" | ")})`],
      [byBooking(BOOKING.resolved).length === 1 && byBooking(BOOKING.resolved)[0].status === "resolved",
        `signal déjà résolu → jamais reposté (${byBooking(BOOKING.resolved).map((e) => e.status).join(", ")})`],
      [byBooking(BOOKING.routing).length === 0 && byBooking(BOOKING.html).length === 0,
        "404 de routage et 502 → aucune entrée de réconciliation"]
    );

    const { rows: heartbeat } = await client.query("select last_ok_at, last_error, stats from job_heartbeats where job_name = $1", [JOB]);
    const hb = heartbeat[0];
    // Le motif du DERNIER passage : le 2e n'interroge plus que 6 bookings (disparu et réalisé sont clos).
    const expectedError = `lobby : 2 échec(s) sur 6 booking(s) — HTTP 404 (établissement ${ESTABLISHMENT_ID.slice(0, 8)}) ×1, HTTP 502 (établissement ${ESTABLISHMENT_ID.slice(0, 8)}) ×1`;
    checks.push(
      [hb?.last_error === expectedError, `heartbeat ok=false, motif exact (${hb?.last_error})`],
      [!JSON.stringify(hb ?? {}).includes(LOBBY_TOKEN) && !first.text.includes(LOBBY_TOKEN) && !second.text.includes(LOBBY_TOKEN),
        "le jeton n'apparaît ni dans le heartbeat ni dans les réponses"],
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
