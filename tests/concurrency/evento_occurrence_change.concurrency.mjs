// Changer la récurrence d'un evento (migration 20261014204354) contre create_order sur l'occurrence
// que ce changement retire. L'UPDATE de l'admin prend le verrou exclusif de la ligne products ;
// create_order lit les occurrences d'un evento en ligne sous verrou PARTAGÉ de cette même ligne.
// Invariant, quel que soit l'ordre : aucune ligne `reserved` ne finit hors des occurrences de la
// définition finale de l'evento — soit le changement passe et la commande est refusée
// (`invalid_occurrence_date`), soit la commande passe et le changement est refusé (HF002).
//
// Deux phases par run :
//   1. DÉTERMINISTE — un coordinateur tient la ligne products ; le premier appel part et sa mise en
//      attente est constatée, puis le second ; le coordinateur relâche, la file sert le premier
//      arrivé. Les deux ordres, avec l'issue exacte de chacun.
//   2. COURSE LIBRE — N acheteurs et le changement, libérés ensemble par une barrière.
//
// Même squelette que les autres fichiers du dossier (driver `pg`, barrière, jamais de sleep pour
// synchroniser). Fixtures purgées dans un `finally`. Stack locale uniquement.
import pg from "pg";

const { Client } = pg;
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5;
const N = 10;

const P = "a0c60000-0000-4000-8000-";
const PARTNER_ID = `${P}000000000001`;
const ESTABLISHMENT_ID = `${P}000000000011`;
const EVENTO_ID = `${P}000000000021`;
const BUYER_SEGMENT = "8100";
const buyerId = (i) => `a0c60000-0000-4000-${BUYER_SEGMENT}-${String(i).padStart(12, "0")}`;
// Hebdomadaire à partir de START ; le changement passe à 14 jours et retire donc REMOVED.
const START = "2029-06-04";
const REMOVED = "2029-06-11";
const CHANGE = `update products set recurrence_frequency_days = 14 where id = '${EVENTO_ID}'`;

const connect = async () => {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  return client;
};
const run = (client, sql, params = []) =>
  client.query(sql, params).then(
    (res) => ({ ok: true, r: res.rows[0]?.r }),
    (error) => ({ ok: false, code: error.code, message: error.message })
  );

async function purge(seed) {
  const lines = `select id from order_lines where product_id = '${EVENTO_ID}'`;
  await seed.query(
    `delete from notification_emails where (related_table = 'order_lines' and related_id in (${lines}))
        or (related_table = 'orders' and related_id in (select order_id from order_lines where product_id = $1))`,
    [EVENTO_ID]
  );
  await seed.query(`delete from ledger_entries where order_line_id in (${lines})`);
  const { rows } = await seed.query("select distinct order_id from order_lines where product_id = $1", [EVENTO_ID]);
  await seed.query("delete from order_lines where product_id = $1", [EVENTO_ID]);
  await seed.query("delete from orders where id = any($1::uuid[])", [rows.map((r) => r.order_id)]);
  const like = `a0c60000-0000-4000-${BUYER_SEGMENT}-%`;
  await seed.query("delete from cart_items where account_id::text like $1", [like]);
  await seed.query("delete from carts where account_id::text like $1", [like]);
  await seed.query("delete from partner_accounts where id::text like $1", [like]);
  await seed.query("delete from auth.users where id::text like $1", [like]);
  await seed.query("delete from product_availability where product_id = $1", [EVENTO_ID]);
  await seed.query("delete from products where id = $1", [EVENTO_ID]);
  await seed.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await seed.query("delete from partners where id = $1", [PARTNER_ID]);
}

async function seedRun(seed) {
  await seed.query("insert into partners (id, display_name) values ($1, 'Occurrence Change Concurrency')", [PARTNER_ID]);
  await seed.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID,
    PARTNER_ID,
    JSON.stringify({ es: "Occurrence Change Concurrency" }),
  ]);
  await seed.query(
    `insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop, online_bookable,
                           evento_capacity_mode, evento_payment_mode, default_capacity, evento_occupies_resource,
                           occurrence_type, occurrence_date, recurrence_frequency_days)
     values ($1, $2, $3, 'evento', jsonb_build_object('es', 'Evento semanal'), 'occurrence-change-concurrency', true,
             30000, true, 'metered', 'online', 100, false, 'recurring', $4, 7)`,
    [EVENTO_ID, PARTNER_ID, ESTABLISHMENT_ID, START]
  );
}

// Un acheteur par connexion : create_order lit le panier du compte appelant.
async function connectBuyer(open, i) {
  const client = await connect();
  open.push(client);
  await client.query("insert into auth.users (id, email) values ($1, $2)", [buyerId(i), `occurrence-buyer-${i}@hifago.test`]);
  await client.query("insert into cart_items (account_id, product_id, date, qty) values ($1, $2, $3, 1)", [
    buyerId(i),
    EVENTO_ID,
    REMOVED,
  ]);
  await client.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: buyerId(i), role: "authenticated" }),
  ]);
  return client;
}
const order = (client) =>
  run(client, "select create_order('Occurrence Buyer', p_holder_email => 'occurrence-buyer@hifago.test') as r");

async function waitForLockWait(seed, fragment) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await seed.query(
      "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like $1",
      [`%${fragment}%`]
    );
    if (rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`aucune attente de verrou constatée pour ${fragment}`);
}

/** Lignes `reserved` de l'evento hors des occurrences de sa définition FINALE. */
async function orphans(seed) {
  const { rows } = await seed.query(
    `select count(*)::int as n from order_lines ol
      where ol.product_id = $1 and ol.status = 'reserved'
        and not exists (select 1 from public.expand_event_occurrences($1, ol.date, ol.date))`,
    [EVENTO_ID]
  );
  return rows[0].n;
}
const frequency = async (seed) =>
  (await seed.query("select recurrence_frequency_days as f from products where id = $1", [EVENTO_ID])).rows[0].f;

async function deterministic(seed, open, first) {
  const coordinator = await connect();
  open.push(coordinator);
  const buyer = await connectBuyer(open, 0);
  const admin = await connect();
  open.push(admin);
  await coordinator.query("begin");
  await coordinator.query("select 1 from products where id = $1 for update", [EVENTO_ID]);
  let buyerCall;
  let adminCall;
  if (first === "buyer") {
    buyerCall = order(buyer);
    await waitForLockWait(seed, "create_order");
    adminCall = run(admin, CHANGE);
    await waitForLockWait(seed, "recurrence_frequency_days");
  } else {
    adminCall = run(admin, CHANGE);
    await waitForLockWait(seed, "recurrence_frequency_days");
    buyerCall = order(buyer);
    await waitForLockWait(seed, "create_order");
  }
  await coordinator.query("rollback");
  const [b, a] = await Promise.all([buyerCall, adminCall]);
  const f = await frequency(seed);
  const expected =
    first === "buyer"
      ? b.ok && b.r?.ok === true && !a.ok && a.code === "HF002" && f === 7
      : a.ok && f === 14 && b.ok && b.r?.ok === false && b.r?.reason === "invalid_occurrence_date";
  return { first, ok: expected && (await orphans(seed)) === 0, b, a, f };
}

async function freeRace(seed, open) {
  const buyers = await Promise.all(Array.from({ length: N }, (_, i) => connectBuyer(open, 100 + i)));
  const admin = await connect();
  open.push(admin);
  let ready = 0;
  let go;
  const gate = new Promise((resolve) => (go = resolve));
  const arm = () => {
    if (++ready === N + 1) go();
  };
  const results = await Promise.all([
    ...buyers.map(async (client) => {
      arm();
      await gate;
      return { who: "buyer", ...(await order(client)) };
    }),
    (async () => {
      arm();
      await gate;
      return { who: "admin", ...(await run(admin, CHANGE)) };
    })(),
  ]);
  const unexpected = results.filter(
    (r) =>
      (r.who === "buyer" && !(r.ok && (r.r?.ok === true || r.r?.reason === "invalid_occurrence_date"))) ||
      (r.who === "admin" && !(r.ok || r.code === "HF002"))
  );
  return { unexpected, orphans: await orphans(seed), results };
}

async function runOnce(runNumber) {
  const seed = await connect();
  const open = [];
  try {
    const outcomes = [];
    for (const first of ["buyer", "admin"]) {
      await purge(seed);
      await seedRun(seed);
      outcomes.push(await deterministic(seed, open, first));
    }
    await purge(seed);
    await seedRun(seed);
    const race = await freeRace(seed, open);
    const tally = {};
    for (const r of race.results) {
      const key = `${r.who}:${r.ok ? r.r?.reason ?? "ok" : r.code}`;
      tally[key] = (tally[key] ?? 0) + 1;
    }
    console.log(
      `  run ${runNumber}: ordres déterministes ${outcomes.filter((o) => o.ok).length}/2, ` +
        `course libre : inattendus ${race.unexpected.length}, lignes hors occurrence ${race.orphans} — ${JSON.stringify(tally)}`
    );
    for (const o of outcomes.filter((x) => !x.ok)) console.error(`    ordre ${o.first} : ${JSON.stringify(o)}`);
    for (const r of race.unexpected) console.error(`    inattendu : ${JSON.stringify(r)}`);
    return outcomes.every((o) => o.ok) && race.unexpected.length === 0 && race.orphans === 0;
  } finally {
    await Promise.allSettled(open.map((c) => c.end()));
    await purge(seed);
    await seed.end();
  }
}

async function main() {
  console.log(`\n=== changement de récurrence d'un evento contre create_order (N=${N}, ${RUNS} runs) ===`);
  for (let i = 1; i <= RUNS; i++) {
    let clean;
    try {
      clean = await runOnce(i);
    } catch (err) {
      console.error(`  run ${i} a levé une erreur : ${err.message}`);
      clean = false;
    }
    if (!clean) {
      console.error(`\nÉCHEC — run ${i}/${RUNS}.`);
      process.exit(1);
    }
  }
  console.log(`\n${RUNS} runs propres — jamais une réservation hors des dates de l'evento, dans les deux ordres et en course libre.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
