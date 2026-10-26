// Lobby APRÈS l'acompte (spec 21 §8.2) — test d'intégration RÉEL de l'Edge Function
// pms-book-paid-orders contre la stack Supabase locale et un LobbyPMS de fixtures. Lancé par le job
// CI `integration-edge`, et à la main en local.
//
// CE QU'IL PROUVE, de bout en bout (create_order → hold → intent → webhook `approved` → fonction) :
//   - seule la clé service_role déclenche le job (sans en-tête, anon, publishable → 401) ;
//   - commande payée, Lobby accepte : booking enregistré, envoyé AVEC `payment` = l'acompte encaissé
//     et la note « Anticipo pagado en hifago », demande `done`, UN e-mail client ;
//   - Lobby refuse (422) même sans `payment` : demande `failed`, entrée de réconciliation « commande
//     PAYÉE — Lobby a refusé », AUCUN e-mail client, la commande reste payée (jamais de dé-paiement) ;
//   - Lobby refuse seulement le champ `payment` : un second essai sans lui, booking obtenu, entrée
//     « remise à saisir à la main » ;
//   - issue inconnue (connexion coupée) : `needs_human`, UN seul POST même après un second passage,
//     entrée de réconciliation portant la note « hifago order_line <id> » ;
//   - LE MARQUEUR DURABLE (revue du 2026-10-23) : POST sans réponse, PUIS la résolution de la demande
//     ÉCHOUE (erreur simulée par un trigger) → la demande reste `pending` ; au passage suivant (la
//     panne levée, la demande de nouveau due) AUCUN second POST ne part : le marqueur posé en base
//     avant l'appel fait passer la demande en `needs_human` avec son entrée de réconciliation ;
//   - heartbeat `ok` avec un avertissement (commandes payées à traiter), jeton nulle part.
//
// PRÉREQUIS : npx supabase start (edge runtime compris), le Vault SANS pms_service_role_key ; la
// fonction servie avec LOBBY_API_BASE_URL=http://host.docker.internal:4545 (supabase/functions/.env,
// écrit AVANT le démarrage) ; aucune demande en attente hors fixtures (le claim est global — sinon
// arrêt, exit 2).
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
const FUNCTIONS_URL = localFunctionsUrl("pms-book-paid-orders");
const FIXTURE_PORT = 4545;
const JOB = "pms-book-paid-orders";
const LOBBY_TOKEN = "IntegBookPaidToken0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";

// Une catégorie Lobby par scénario : c'est elle qui dit à la fixture comment répondre.
const CATEGORY = { accepted: 781001, refused: 781002, paymentRefused: 781003, dropped: 781004, resolveFails: 781005 };
const SCENARIOS = Object.keys(CATEGORY);

const ids = { partner: randomUUID(), establishment: randomUUID() };
const scenario = Object.fromEntries(
  SCENARIOS.map((name) => [name, { product: randomUUID(), buyer: randomUUID(), orderId: null, lineId: null }])
);
const postBookings = []; // { category_id, payment, note }
let nextBookingId = 95000001;

function startFixtureServer() {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.method === "POST" && req.url === "/api/v1/bookings") {
        postBookings.push({ category_id: body.category_id, payment: body.payment, note: body.note, tokenInBody: body.api_token === LOBBY_TOKEN });
        if (body.category_id === CATEGORY.dropped || body.category_id === CATEGORY.resolveFails) return void req.socket.destroy();
        const refuse =
          body.category_id === CATEGORY.refused ||
          (body.category_id === CATEGORY.paymentRefused && body.payment !== undefined);
        if (refuse) {
          res.writeHead(422, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error_code: "INPUT_PARAMETERS", error: "fixture: refus", input: body }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ booking: { booking_id: nextBookingId++, room_id: 1 } }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "unhandled by fixture server" }));
    });
  });
  // Toutes les interfaces (cf. pms_cancel_bookings) : la fonction joint la fixture par
  // host.docker.internal.
  return new Promise((resolve) => server.listen(FIXTURE_PORT, () => resolve(server)));
}

async function purgeFixtures(client) {
  const accounts = SCENARIOS.map((name) => scenario[name].buyer);
  const products = SCENARIOS.map((name) => scenario[name].product);
  await client.query("delete from cart_items where account_id = any($1::uuid[])", [accounts]);
  await client.query("delete from carts where account_id = any($1::uuid[])", [accounts]);
  const { rows: orders } = await client.query(
    "select distinct order_id from order_lines where product_id = any($1::uuid[])",
    [products]
  );
  const orderIds = orders.map((row) => row.order_id);
  await client.query("delete from notification_emails where related_table = 'orders' and related_id = any($1::uuid[])", [orderIds]);
  await client.query("delete from pms_booking_requests where order_id = any($1::uuid[])", [orderIds]);
  await client.query(
    `delete from pms_cancellation_queue where establishment_id = $1`,
    [ids.establishment]
  );
  await client.query(
    "delete from pms_reconciliation_entries where order_line_id in (select id from order_lines where product_id = any($1::uuid[]))",
    [products]
  );
  await client.query(
    "delete from ledger_entries where order_line_id in (select id from order_lines where product_id = any($1::uuid[]))",
    [products]
  );
  await client.query("delete from payment_reconciliation_entries where payment_id in (select id from payments where order_id = any($1::uuid[]))", [orderIds]);
  await client.query("delete from payments where order_id = any($1::uuid[])", [orderIds]);
  await client.query("delete from order_lines where product_id = any($1::uuid[])", [products]);
  await client.query("delete from orders where id = any($1::uuid[])", [orderIds]);
  await client.query("delete from products where id = any($1::uuid[])", [products]);
  await client.query("delete from pms_sync_state where establishment_id = $1", [ids.establishment]);
  await client.query("delete from establishments where id = $1", [ids.establishment]);
  await client.query("delete from partners where id = $1", [ids.partner]);
  await client.query("delete from auth.users where id = any($1::uuid[])", [accounts]);
}

async function setUp(client) {
  await purgeFixtures(client);
  await client.query("insert into partners (id, display_name) values ($1, 'Book Paid Integration Owner')", [ids.partner]);
  await client.query(
    `insert into establishments (id, partner_id, name, slug, status, lobby_connector_active, lobby_api_token)
     values ($1, $2, '{"es":"Book Paid Integration"}'::jsonb, $3, 'active', true, $4)`,
    [ids.establishment, ids.partner, `book-paid-${ids.establishment.slice(0, 8)}`, LOBBY_TOKEN]
  );
  for (const name of SCENARIOS) {
    await client.query(
      `insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop,
                             lobby_category_id, capacity, unit_count, lodging_kind, min_qty, max_qty)
       values ($1, $2, $3, 'lodging', $4::jsonb, $5, true, 100000, $6, 2, 3, 'private', null, null)`, // ni min ni max pour un logement (migration 20261025120000)
      [scenario[name].product, ids.partner, ids.establishment, JSON.stringify({ es: `Chambre ${name}` }),
        `chambre-book-paid-${name}-${scenario[name].product.slice(0, 8)}`, CATEGORY[name]]
    );
  }
}

// Le VRAI chemin, comme le tunnel : panier → create_order → hold (la lecture Lobby est simulée par un
// instantané) → intent → webhook `approved`. Aucune écriture directe sur les tables du paiement.
async function payOrder(name, nightsIso) {
  const entry = scenario[name];
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  try {
    await client.query("insert into auth.users (id, email) values ($1, $2)", [entry.buyer, `book-paid-${name}-${entry.buyer.slice(0, 8)}@hifago.test`]);
    await client.query("insert into cart_items (account_id, product_id, date, end_date, qty) values ($1, $2, $3, $4, 1)", [
      entry.buyer, entry.product, nightsIso.start, nightsIso.end,
    ]);
    await client.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: entry.buyer, role: "authenticated" })]);
    const { rows: created } = await client.query("select create_order($1, $2, $3, $4) as result", [
      `Cliente ${name}`, `book-paid-${name}-${entry.buyer.slice(0, 8)}@hifago.test`, "+573001234567", false,
    ]);
    entry.orderId = created[0].result?.order_id;
    if (!entry.orderId) throw new Error(`create_order a échoué (${name}) : ${JSON.stringify(created[0].result)}`);

    const snapshot = {
      [ids.establishment]: { [String(CATEGORY[name])]: Object.fromEntries(nightsIso.nights.map((night) => [night, 3])) },
    };
    const { rows: held } = await client.query("select hold_pms_nights($1, $2::jsonb, now()) as result", [entry.orderId, JSON.stringify(snapshot)]);
    if (held[0].result?.ok !== true) throw new Error(`hold_pms_nights a refusé (${name}) : ${JSON.stringify(held[0].result)}`);

    const { rows: intent } = await client.query("select create_payment_intent($1) as result", [entry.orderId]);
    if (intent[0].result?.ok !== true) throw new Error(`create_payment_intent a refusé (${name}) : ${JSON.stringify(intent[0].result)}`);
    await client.query("select set_config('request.jwt.claims', '', false)");
    const { rows: applied } = await client.query(
      "select apply_payment_webhook_checked($1, $2::uuid, 'approved', $3::numeric, '{}'::jsonb) as result",
      [`mp-${randomUUID()}`, intent[0].result.payment_id, intent[0].result.amount_cop]
    );
    const { rows: line } = await client.query("select id, acompte_cop from order_lines where order_id = $1", [entry.orderId]);
    entry.lineId = line[0].id;
    entry.acompte = line[0].acompte_cop;
    return applied[0].result;
  } finally {
    await client.end();
  }
}

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  await refuseIfCronsCanFire(client);
  await refuseIfForeignRows(
    client,
    "demande(s) de booking en attente",
    "select count(*)::int as n from pms_booking_requests where status = 'pending'"
  );
  const fixtureServer = await startFixtureServer();
  let exitCode = 0;
  const heartbeatBefore = await snapshotHeartbeat(client, JOB);

  try {
    await setUp(client);
    const { rows: days } = await client.query(
      `select to_char(today_in_bogota() + 20, 'YYYY-MM-DD') as start, to_char(today_in_bogota() + 22, 'YYYY-MM-DD') as "end",
              to_char(today_in_bogota() + 20, 'YYYY-MM-DD') as n1, to_char(today_in_bogota() + 21, 'YYYY-MM-DD') as n2`
    );
    const nights = { start: days[0].start, end: days[0].end, nights: [days[0].n1, days[0].n2] };
    for (const name of SCENARIOS) await payOrder(name, nights);

    const checks = [];
    checks.push(...(await callerChecks(FUNCTIONS_URL)));
    checks.push([postBookings.length === 0, `aucun refus n'a appelé Lobby, ni le paiement (${postBookings.length} POST)`]);

    const { rows: before } = await client.query(
      "select o.payment_status, (select count(*)::int from notification_emails where event_type = 'client_order_confirmed' and related_id = o.id) as mails from orders o where o.id = any($1::uuid[])",
      [SCENARIOS.map((name) => scenario[name].orderId)]
    );
    checks.push([
      before.every((row) => row.payment_status === "paid" && row.mails === 0),
      "les 5 commandes sont payées, la demande est posée par le webhook et AUCUN e-mail client n'est parti (différé)",
    ]);

    // La résolution de la demande `resolveFails` échouera (panne simulée de la base juste après le POST).
    await client.query(`create or replace function public._it_fail_resolve() returns trigger language plpgsql as $$
      begin
        if new.status = 'needs_human' then raise exception 'panne simulée de resolve_pms_booking_request'; end if;
        return new;
      end; $$`);
    await client.query(`drop trigger if exists _it_fail_resolve on public.pms_booking_requests`);
    await client.query(
      `create trigger _it_fail_resolve before update on public.pms_booking_requests
         for each row when (new.order_id = '${scenario.resolveFails.orderId}') execute function public._it_fail_resolve()`
    );

    // 5 demandes, 3 par passage : deux passages. Le second ne reprend jamais l'issue inconnue.
    const first = await runAsServiceRole(FUNCTIONS_URL);
    console.log("Passage 1 :", first.status, first.text);
    const second = await runAsServiceRole(FUNCTIONS_URL);
    console.log("Passage 2 :", second.status, second.text);
    const firstSummary = JSON.parse(first.text);
    checks.push([first.status === 200 && firstSummary.claimed === 3, `passage 1 : 3 demandes réclamées (${first.text.slice(0, 200)})`]);

    const requests = Object.fromEntries(
      (await client.query("select order_id, status, attempts, last_error from pms_booking_requests where order_id = any($1::uuid[])", [
        SCENARIOS.map((name) => scenario[name].orderId),
      ])).rows.map((row) => [row.order_id, row])
    );
    const lines = Object.fromEntries(
      (await client.query("select id, pms_booking_id, status from order_lines where id = any($1::uuid[])", [
        SCENARIOS.map((name) => scenario[name].lineId),
      ])).rows.map((row) => [row.id, row])
    );
    const mails = async (name) =>
      (await client.query("select count(*)::int as n from notification_emails where event_type = 'client_order_confirmed' and related_id = $1", [scenario[name].orderId])).rows[0].n;
    const entries = async (name) =>
      (await client.query("select detail from pms_reconciliation_entries where order_line_id = $1", [scenario[name].lineId])).rows.map((row) => row.detail ?? "");
    const postsFor = (name) => postBookings.filter((post) => post.category_id === CATEGORY[name]);
    const paid = async (name) =>
      (await client.query("select payment_status from orders where id = $1", [scenario[name].orderId])).rows[0].payment_status;

    // ── accepté ────────────────────────────────────────────────────────────────────────────────
    const acc = scenario.accepted;
    checks.push(
      [requests[acc.orderId]?.status === "done" && lines[acc.lineId]?.pms_booking_id != null,
        `Lobby accepte : demande done, booking enregistré (${requests[acc.orderId]?.status}, ${lines[acc.lineId]?.pms_booking_id})`],
      [postsFor("accepted").length === 1 && Number(postsFor("accepted")[0].payment) === Number(acc.acompte),
        `le booking part avec payment = l'acompte encaissé (${postsFor("accepted")[0]?.payment} / ${acc.acompte})`],
      [/Anticipo pagado en hifago: \$[\d.]+ — saldo: \$[\d.]+/.test(postsFor("accepted")[0]?.note ?? ""), `la note porte « Anticipo pagado en hifago » (${postsFor("accepted")[0]?.note})`],
      [(await mails("accepted")) === 1, `UN e-mail client une fois le booking obtenu (${await mails("accepted")})`]
    );

    // ── refusé ─────────────────────────────────────────────────────────────────────────────────
    const ref = scenario.refused;
    checks.push(
      [requests[ref.orderId]?.status === "failed", `Lobby refuse (422) : demande failed (${requests[ref.orderId]?.status})`],
      [postsFor("refused").length === 2 && postsFor("refused")[1].payment === undefined, `deux POST, le second sans payment (${postsFor("refused").length})`],
      [(await entries("refused")).some((d) => d.includes("commande PAYÉE — Lobby a refusé")), "entrée de réconciliation « commande PAYÉE — Lobby a refusé »"],
      [(await mails("refused")) === 0, "AUCUN e-mail client"],
      [(await paid("refused")) === "paid" && lines[ref.lineId]?.status === "reserved", "la commande reste payée, la ligne réservée — jamais de dé-paiement"]
    );

    // ── seul `payment` refusé ──────────────────────────────────────────────────────────────────
    const pay = scenario.paymentRefused;
    checks.push(
      [requests[pay.orderId]?.status === "done" && lines[pay.lineId]?.pms_booking_id != null, "payment refusé puis accepté sans lui : booking obtenu, demande done"],
      [(await entries("paymentRefused")).some((d) => d.includes("remise à saisir à la main")), "entrée « remise à saisir à la main dans Lobby »"],
      [(await mails("paymentRefused")) === 1, "UN e-mail client"]
    );

    // ── issue inconnue ─────────────────────────────────────────────────────────────────────────
    const drop = scenario.dropped;
    checks.push(
      [requests[drop.orderId]?.status === "needs_human", `issue inconnue : needs_human (${requests[drop.orderId]?.status})`],
      [postsFor("dropped").length === 1, `jamais retentée : UN seul POST après deux passages (${postsFor("dropped").length})`],
      [(await entries("dropped")).some((d) => d.includes(`hifago order_line ${drop.lineId}`)), "entrée portant la clé « hifago order_line <id> »"],
      [(await mails("dropped")) === 0, "AUCUN e-mail client"]
    );

    // ── résolution en panne après un POST sans réponse : JAMAIS de second POST ───────────────────
    const rf = scenario.resolveFails;
    const apresPanne = (await client.query("select status, attempts from pms_booking_requests where order_id = $1", [rf.orderId])).rows[0];
    checks.push(
      [apresPanne?.status === "pending", `la résolution a échoué : la demande est restée pending (${apresPanne?.status})`],
      [postsFor("resolveFails").length === 1, `un seul POST parti avant la panne (${postsFor("resolveFails").length})`],
      [(await client.query("select pms_attempt_started_at is not null as marque from order_lines where id = $1", [rf.lineId])).rows[0].marque === true,
        "le marqueur de tentative est posé en base (il survit à la panne de résolution)"]
    );
    await client.query("drop trigger _it_fail_resolve on public.pms_booking_requests");
    await client.query("update pms_booking_requests set next_attempt_at = now() where order_id = $1", [rf.orderId]);
    const third = await runAsServiceRole(FUNCTIONS_URL);
    console.log("Passage 3 :", third.status, third.text);
    const finale = (await client.query("select status from pms_booking_requests where order_id = $1", [rf.orderId])).rows[0];
    checks.push(
      [postsFor("resolveFails").length === 1, `AUCUN second POST au passage suivant (${postsFor("resolveFails").length})`],
      [finale?.status === "needs_human", `la demande passe needs_human (${finale?.status})`],
      [(await entries("resolveFails")).some((d) => d.includes(`hifago order_line ${rf.lineId}`)), "entrée de réconciliation portant la clé « hifago order_line <id> »"],
      [(await mails("resolveFails")) === 0, "AUCUN e-mail client"]
    );

    const { rows: heartbeat } = await client.query("select last_error, last_warning from job_heartbeats where job_name = $1", [JOB]);
    checks.push(
      [postBookings.every((post) => post.tokenInBody), "le jeton part dans le CORPS du POST (jamais dans l'URL)"],
      [!JSON.stringify(heartbeat).includes(LOBBY_TOKEN) && !first.text.includes(LOBBY_TOKEN) && !second.text.includes(LOBBY_TOKEN),
        "le jeton n'apparaît ni dans le heartbeat ni dans les réponses"],
      [!(await client.query("select detail from pms_reconciliation_entries where order_line_id = any($1::uuid[])", [SCENARIOS.map((n) => scenario[n].lineId)])).rows.some((r) => (r.detail ?? "").includes(LOBBY_TOKEN)),
        "le jeton (recopié par le 422 de la fixture) est masqué dans les entrées de réconciliation"],
      ...logChecks([LOBBY_TOKEN])
    );

    exitCode = report(checks, JOB);
  } catch (err) {
    console.error(err);
    exitCode = 1;
  } finally {
    await client.query("drop trigger if exists _it_fail_resolve on public.pms_booking_requests").catch(() => {});
    await client.query("drop function if exists public._it_fail_resolve()").catch(() => {});
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
