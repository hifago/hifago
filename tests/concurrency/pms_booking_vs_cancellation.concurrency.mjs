// Lobby après l'acompte (migration 20261023120000) — une prestation annulée PENDANT son booking chez
// Lobby. pms-book-paid-orders réclame la commande payée (claim_paid_order_for_pms_booking), envoie
// POST /bookings, puis enregistre le booking (record_pms_booking) ; entre les deux, l'admin
// (set_order_line_status) ou le client (cancel_order_line) annule la ligne. Le booking existe chez le
// partenaire quoi qu'il arrive : il doit TOUJOURS finir dans la file d'annulation, une fois, jamais
// perdu — et les deux chemins ne doivent jamais s'interbloquer (tous deux prennent `orders` d'abord,
// règle 8).
//
// Attendu pour chaque commande, quel que soit l'ordre : la ligne est annulée, elle porte le booking,
// UNE entrée `pending` de pms_cancellation_queue pour ce booking ; record_pms_booking répond `ok`
// s'il passe le premier, `line_not_reserved` sinon ; aucune erreur, aucun 40P01.
// Deux phases par run : (1) déterministe — chaque adversaire (admin, client) servi dans les DEUX
// ordres, par un coordinateur qui tient la commande ; (2) course libre — barrière.
//
// ⚠️ Nettoyage AVANT et APRÈS. Préfixe dédié : 7e240000-. Stack locale uniquement.
import pg from "pg";

const { Client } = pg;

const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5;
const FREE = 12; // commandes de la course libre
const CASES = [
  { kind: "admin", first: "record" },
  { kind: "admin", first: "cancel" },
  { kind: "client", first: "record" },
  { kind: "client", first: "cancel" },
];
const TOTAL = CASES.length + FREE;

const P = "7e240000-0000-4000-8000-";
const id = (n) => `${P}${String(n).padStart(12, "0")}`;
const PARTNER_ID = id(1);
const ESTABLISHMENT_ID = id(11);
const BUYER_ID = id(21);
const ADMIN_ID = id(22);
const PRODUCT_ID = id(31);
const orderId = (k) => id(100000 + k);
const lineId = (k) => id(200000 + k);
const booking = (k) => `CONC-BVC-${k}`;
// k = 1..CASES.length : phase déterministe ; au-delà : course libre, adversaire alterné.
const kindOf = (k) => (k <= CASES.length ? CASES[k - 1].kind : k % 2 === 0 ? "admin" : "client");

async function connect() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  return client;
}

async function asRole(role, sub) {
  const client = await connect();
  await client.query(`set role ${role}`);
  if (sub) await client.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub, role: "authenticated" })]);
  return client;
}

async function purge(seed) {
  await seed.query(`delete from notification_emails where related_table = 'order_lines' and related_id::text like '${P}%'`);
  await seed.query(`delete from pms_reconciliation_entries where order_line_id::text like '${P}%'`);
  await seed.query("delete from pms_cancellation_queue where pms_booking_id like 'CONC-BVC-%'");
  await seed.query("delete from pms_sync_state where establishment_id = $1", [ESTABLISHMENT_ID]);
  await seed.query("delete from audit_log where actor_id = $1", [ADMIN_ID]);
  await seed.query(`delete from ledger_entries where order_line_id::text like '${P}%'`);
  await seed.query(`delete from pms_booking_requests where order_id::text like '${P}%'`);
  await seed.query(`delete from payments where order_id::text like '${P}%'`);
  await seed.query(`delete from order_lines where order_id::text like '${P}%'`);
  await seed.query(`delete from orders where id::text like '${P}%'`);
  await seed.query("delete from products where id = $1", [PRODUCT_ID]);
  await seed.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await seed.query("delete from partner_capabilities where account_id = $1", [ADMIN_ID]);
  await seed.query("delete from partners where id = $1", [PARTNER_ID]);
  await seed.query("delete from partner_accounts where id in ($1, $2)", [BUYER_ID, ADMIN_ID]);
  await seed.query("delete from auth.users where id in ($1, $2)", [BUYER_ID, ADMIN_ID]);
}

async function seedRun(seed) {
  await purge(seed);
  await seed.query("insert into partners (id, display_name) values ($1, 'Booking vs Cancel Concurrency')", [PARTNER_ID]);
  await seed.query(
    `insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token)
     values ($1, $2, jsonb_build_object('es', 'Booking vs Cancel'), true, 'tok-bvc-conc')`,
    [ESTABLISHMENT_ID, PARTNER_ID]
  );
  await seed.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id)
     values ($1, $2, $3, 'lodging', jsonb_build_object('es', 'BVC Noche'), 100000, true, 'bvc-conc-noche', 7801)`,
    [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID]
  );
  await seed.query("insert into auth.users (id, email) values ($1, 'bvc-buyer@test.local'), ($2, 'bvc-admin@test.local')", [
    BUYER_ID,
    ADMIN_ID,
  ]);
  await seed.query("insert into partner_capabilities (account_id, role, source, status) values ($1, 'admin', 'migration', 'active')", [ADMIN_ID]);
  for (let k = 1; k <= TOTAL; k++) {
    await seed.query(
      `insert into orders (id, account_id, holder_name, holder_email, payment_status) values ($1, $2, 'BVC', 'bvc-buyer@test.local', 'paid')`,
      [orderId(k), BUYER_ID]
    );
    await seed.query(
      `insert into order_lines (
         id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
         price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
         acompte_cop, referrer_commission_cop, app_commission_cop, pms_held_at
       ) values ($1, $2, $3, $4, '2030-06-01', '2030-06-02', 1, 'reserved', 'BVC',
                 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000, now())`,
      [lineId(k), orderId(k), BUYER_ID, PRODUCT_ID]
    );
  }
}

const run = (client, sql, params) =>
  client.query(sql, params).then(
    (res) => ({ ok: true, r: res.rows[0]?.r }),
    (error) => ({ ok: false, code: error.code, message: error.message })
  );

/** Le claim de l'Edge Function, dans sa propre transaction (validée) : rend l'horodatage du bail. */
async function claim(service, k) {
  const res = await run(service, "select public.claim_paid_order_for_pms_booking($1) as r", [orderId(k)]);
  if (!res.ok || res.r?.ok !== true || !res.r.claimed_at) throw new Error(`claim ${k} : ${JSON.stringify(res)}`);
  return res.r.claimed_at;
}

const recordCall = (client, k, claimedAt) =>
  run(client, "select public.record_pms_booking($1, $2::timestamptz, $3, $4) as r", [orderId(k), claimedAt, lineId(k), booking(k)]);

const cancelCall = (kind, client, k) =>
  kind === "admin"
    ? run(client, "select public.set_order_line_status($1, 'cancelled_by_provider', 'concurrence booking') as r", [lineId(k)])
    : run(client, "select public.cancel_order_line($1) as r", [lineId(k)]);

const cancelClient = (kind) => (kind === "admin" ? asRole("authenticated", ADMIN_ID) : asRole("authenticated", BUYER_ID));

function withTimeout(promise, label, ms = 20000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} : délai dépassé (${ms} ms) — interblocage ?`)), ms)),
  ]);
}

async function waitForLockWait(seed, fragment) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await seed.query(
      "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like $1",
      [`%${fragment}%`]
    );
    if (rows[0].n >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`aucune attente de verrou constatée pour ${fragment}`);
}

const FRAGMENT = { record: "record_pms_booking", admin: "set_order_line_status", client: "cancel_order_line" };

async function serveInOrder(seed, service, k, { kind, first }) {
  const claimedAt = await claim(service, k);
  const coordinator = await connect();
  const recorder = await asRole("service_role");
  const canceller = await cancelClient(kind);
  try {
    await coordinator.query("begin");
    await coordinator.query("select 1 from orders where id = $1 for update", [orderId(k)]);
    const launch = (who) => (who === "record" ? recordCall(recorder, k, claimedAt) : cancelCall(kind, canceller, k));
    const order = first === "record" ? ["record", "cancel"] : ["cancel", "record"];
    const fragment = (who) => (who === "record" ? FRAGMENT.record : FRAGMENT[kind]);
    const a = launch(order[0]);
    await waitForLockWait(seed, fragment(order[0]));
    const b = launch(order[1]);
    await waitForLockWait(seed, fragment(order[1]));
    await coordinator.query("rollback");
    const [ra, rb] = await withTimeout(Promise.all([a, b]), `commande ${k}`);
    const byWho = { [order[0]]: ra, [order[1]]: rb };
    return { k, kind, first, record: byWho.record, cancel: byWho.cancel };
  } finally {
    await Promise.all([coordinator, recorder, canceller].map((c) => c.end().catch(() => {})));
  }
}

async function check(seed, outcomes) {
  const problems = [];
  for (const o of outcomes) {
    const { rows } = await seed.query(
      `select ol.status, ol.pms_booking_id,
              (select count(*)::int from pms_cancellation_queue q
                where q.pms_booking_id = $2 and q.establishment_id = $3 and q.status = 'pending') as file
         from order_lines ol where ol.id = $1`,
      [lineId(o.k), booking(o.k), ESTABLISHMENT_ID]
    );
    const s = rows[0];
    const cancelledStatus = o.kind === "admin" ? "cancelled_by_provider" : "cancelled_by_client";
    const cancelOk = o.cancel.ok && o.cancel.r?.ok === true;
    const recordOk =
      o.record.ok && (o.first === "record" ? o.record.r?.ok === true
        : o.first === "cancel" ? o.record.r?.reason === "line_not_reserved"
        : o.record.r?.ok === true || o.record.r?.reason === "line_not_reserved");
    if (!cancelOk || !recordOk || s.status !== cancelledStatus || s.pms_booking_id !== booking(o.k) || s.file !== 1) {
      problems.push(`commande ${o.k} (${o.kind}, ${o.first ?? "libre"}) : record ${JSON.stringify(o.record)}, annulation ${JSON.stringify(o.cancel)}, état ${JSON.stringify(s)}`);
    }
  }
  return problems;
}

async function runOnce(runNumber, seed) {
  await seedRun(seed);
  const service = await asRole("service_role");
  try {
    // Phase 1 — déterministe.
    const deterministic = [];
    for (let k = 1; k <= CASES.length; k++) deterministic.push(await serveInOrder(seed, service, k, CASES[k - 1]));

    // Phase 2 — course libre : claims validés d'abord (le bail de l'Edge Function), puis record et
    // annulation de chaque commande lâchés ensemble.
    const claims = {};
    for (let k = CASES.length + 1; k <= TOTAL; k++) claims[k] = await claim(service, k);
    const recorders = await Promise.all(Array.from({ length: FREE }, () => asRole("service_role")));
    const cancellers = await Promise.all(Array.from({ length: FREE }, (_, i) => cancelClient(kindOf(CASES.length + 1 + i))));
    let ready = 0;
    let release;
    const go = new Promise((resolve) => (release = resolve));
    const arm = () => {
      if (++ready === FREE * 2) release();
    };
    const free = await withTimeout(
      Promise.all(
        Array.from({ length: FREE }, (_, i) => CASES.length + 1 + i).map(async (k, i) => {
          const [record, cancel] = await Promise.all([
            (async () => {
              arm();
              await go;
              return recordCall(recorders[i], k, claims[k]);
            })(),
            (async () => {
              arm();
              await go;
              return cancelCall(kindOf(k), cancellers[i], k);
            })(),
          ]);
          return { k, kind: kindOf(k), first: null, record, cancel };
        })
      ),
      `run ${runNumber} course libre`
    );
    await Promise.all([...recorders, ...cancellers].map((c) => c.end().catch(() => {})));

    const all = [...deterministic, ...free];
    const deadlocks = all.filter((o) => o.record.code === "40P01" || o.cancel.code === "40P01").length;
    const problems = await check(seed, all);
    console.log(
      `  run ${runNumber} : ${all.length} commandes (${CASES.length} ordonnées, ${FREE} en course libre), en défaut ${problems.length}, interblocages ${deadlocks}`
    );
    for (const p of problems) console.error(`    ${p}`);
    return problems.length === 0 && deadlocks === 0;
  } finally {
    await service.end().catch(() => {});
  }
}

async function main() {
  const seed = await connect();
  let allClean = true;
  try {
    for (let runNumber = 1; runNumber <= RUNS && allClean; runNumber++) {
      try {
        if (!(await runOnce(runNumber, seed))) allClean = false;
      } catch (err) {
        console.error(`  run ${runNumber} a levé une erreur : ${err.message}`);
        allClean = false;
      }
    }
  } finally {
    await purge(seed);
    await seed.end();
  }
  if (!allClean) {
    console.error("ÉCHEC : un booking perdu, enfilé deux fois, ou un interblocage.");
    process.exit(1);
  }
  console.log(`${RUNS} runs consécutifs propres — un booking annulé pendant sa pose finit toujours, une fois, en file d'annulation.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
