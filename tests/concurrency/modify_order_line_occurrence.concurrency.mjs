// Déplacer la ligne d'un evento (modify_order_line, migration 20261014211700) contre un changement
// de récurrence qui retire la date visée (garde products_occurrence_change_guard, 20261014204354).
// modify_order_line lit les occurrences sous verrou PARTAGÉ de la ligne products ; l'UPDATE de
// l'admin prend le verrou exclusif. Invariant, quel que soit l'ordre : aucune ligne `reserved` ne
// finit hors des occurrences de la définition finale — soit le déplacement passe et le changement
// est refusé (HF002), soit le changement passe et le déplacement est refusé (`invalid_occurrence_date`).
//
// Deux phases par run :
//   1. DÉTERMINISTE — un coordinateur tient la ligne products ; le premier appel part et sa mise en
//      attente est constatée (par pid), puis le second ; le coordinateur relâche, la file sert le
//      premier arrivé. Les deux ordres, avec l'issue exacte de chacun.
//   2. COURSE LIBRE — N déplacements (N commandes, une ligne chacune) et le changement, libérés
//      ensemble par une barrière.
//
// Même squelette que evento_occurrence_change.concurrency.mjs. Fixtures purgées dans un `finally`.
// Stack locale uniquement.
import pg from "pg";

const { Client } = pg;
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5;
const N = 8;

const P = "a0c80000-0000-4000-8000-";
const PARTNER_ID = `${P}000000000001`;
const ESTABLISHMENT_ID = `${P}000000000011`;
const EVENTO_ID = `${P}000000000021`;
const ADMIN_ID = `${P}000000000031`;
const BUYER_ID = `${P}000000000032`;
const orderId = (i) => `a0c80000-0000-4000-8100-${String(i).padStart(12, "0")}`;
const lineId = (i) => `a0c80000-0000-4000-8200-${String(i).padStart(12, "0")}`;
// Hebdomadaire à partir de START ; le changement passe à 14 jours et retire donc TARGET.
const START = "2029-06-04";
const TARGET = "2029-06-11";
const CHANGE = `update products set recurrence_frequency_days = 14 where id = '${EVENTO_ID}'`;

const connect = async (claims) => {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  if (claims) await client.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
  return client;
};
const ADMIN = { sub: ADMIN_ID, role: "authenticated" };
const run = (client, sql, params = []) =>
  client.query(sql, params).then(
    (res) => ({ ok: true, r: res.rows[0]?.r }),
    (error) => ({ ok: false, code: error.code, message: error.message })
  );
const move = (client, i) =>
  run(client, "select modify_order_line($1::uuid, $2::date, 1, 'concurrence occurrence') as r", [lineId(i), TARGET]);

async function purge(seed) {
  const orders = `select id from orders where id::text like 'a0c80000-0000-4000-8100-%'`;
  await seed.query(
    `delete from notification_emails
      where related_id in (select id from order_lines where order_id in (${orders})) or related_id in (${orders})`
  );
  await seed.query("delete from audit_log where actor_id = $1", [ADMIN_ID]);
  await seed.query(`delete from order_lines where order_id in (${orders})`);
  await seed.query(`delete from orders where id in (${orders})`);
  await seed.query("delete from product_availability where product_id = $1", [EVENTO_ID]);
  await seed.query("delete from products where id = $1", [EVENTO_ID]);
  await seed.query("delete from partner_capabilities where account_id = $1", [ADMIN_ID]);
  await seed.query("delete from partner_accounts where id in ($1, $2)", [ADMIN_ID, BUYER_ID]);
  await seed.query("delete from auth.users where id in ($1, $2)", [ADMIN_ID, BUYER_ID]);
  await seed.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await seed.query("delete from partners where id = $1", [PARTNER_ID]);
}

async function seedRun(seed, lines) {
  await seed.query("insert into partners (id, display_name) values ($1, 'Modify Occurrence Concurrency')", [PARTNER_ID]);
  await seed.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID,
    PARTNER_ID,
    JSON.stringify({ es: "Modify Occurrence Concurrency" }),
  ]);
  await seed.query("insert into auth.users (id, email) values ($1, $2), ($3, $4)", [
    ADMIN_ID,
    "modify-occurrence-admin@hifago.test",
    BUYER_ID,
    "modify-occurrence-buyer@hifago.test",
  ]);
  await seed.query(
    "insert into partner_capabilities (account_id, role, source, status) values ($1, 'admin', 'migration', 'active')",
    [ADMIN_ID]
  );
  await seed.query(
    `insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop, online_bookable,
                           evento_capacity_mode, evento_payment_mode, default_capacity, evento_occupies_resource,
                           occurrence_type, occurrence_date, recurrence_frequency_days)
     values ($1, $2, $3, 'evento', jsonb_build_object('es', 'Evento semanal'), 'modify-occurrence-concurrency', true,
             30000, true, 'metered', 'online', 100, false, 'recurring', $4, 7)`,
    [EVENTO_ID, PARTNER_ID, ESTABLISHMENT_ID, START]
  );
  await seed.query("insert into product_availability (product_id, date, capacity, booked) values ($1, $2, 100, $3)", [
    EVENTO_ID,
    START,
    lines,
  ]);
  for (let i = 0; i < lines; i++) {
    await seed.query("insert into orders (id, account_id, holder_name, holder_email) values ($1, $2, 'Holder', $3)", [
      orderId(i),
      BUYER_ID,
      "modify-occurrence-buyer@hifago.test",
    ]);
    await seed.query(
      `insert into order_lines (id, order_id, account_id, product_id, date, qty, status, holder_name, price_cop, total_cop,
                                commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop,
                                app_commission_cop)
       values ($1, $2, $3, $4, $5, 1, 'reserved', 'Holder', 30000, 30000, 'direct', 0, 0, 0, 0, 0, 0)`,
      [lineId(i), orderId(i), BUYER_ID, EVENTO_ID, START]
    );
  }
}

// Par pid : une autre session de la pile partagée ne peut pas passer pour celle-ci.
async function waitForLockWait(seed, client, who) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await seed.query(
      "select count(*)::int as n from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'",
      [client.processID]
    );
    if (rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`aucune attente de verrou constatée pour ${who}`);
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
  const mover = await connect(ADMIN);
  open.push(mover);
  const admin = await connect(ADMIN);
  open.push(admin);
  await coordinator.query("begin");
  await coordinator.query("select 1 from products where id = $1 for update", [EVENTO_ID]);
  let moveCall;
  let changeCall;
  if (first === "move") {
    moveCall = move(mover, 0);
    await waitForLockWait(seed, mover, "le déplacement");
    changeCall = run(admin, CHANGE);
    await waitForLockWait(seed, admin, "le changement");
  } else {
    changeCall = run(admin, CHANGE);
    await waitForLockWait(seed, admin, "le changement");
    moveCall = move(mover, 0);
    await waitForLockWait(seed, mover, "le déplacement");
  }
  await coordinator.query("rollback");
  const [m, c] = await Promise.all([moveCall, changeCall]);
  const f = await frequency(seed);
  const expected =
    first === "move"
      ? m.ok && m.r?.ok === true && !c.ok && c.code === "HF002" && f === 7
      : c.ok && f === 14 && m.ok && m.r?.ok === false && m.r?.reason === "invalid_occurrence_date";
  return { first, ok: expected && (await orphans(seed)) === 0, m, c, f };
}

async function freeRace(seed, open) {
  const movers = await Promise.all(Array.from({ length: N }, () => connect(ADMIN)));
  open.push(...movers);
  const admin = await connect(ADMIN);
  open.push(admin);
  let ready = 0;
  let go;
  const gate = new Promise((resolve) => (go = resolve));
  const arm = () => {
    if (++ready === N + 1) go();
  };
  const results = await Promise.all([
    ...movers.map(async (client, i) => {
      arm();
      await gate;
      return { who: "move", ...(await move(client, i)) };
    }),
    (async () => {
      arm();
      await gate;
      return { who: "change", ...(await run(admin, CHANGE)) };
    })(),
  ]);
  const unexpected = results.filter(
    (r) =>
      (r.who === "move" && !(r.ok && (r.r?.ok === true || r.r?.reason === "invalid_occurrence_date"))) ||
      (r.who === "change" && !(r.ok || r.code === "HF002"))
  );
  return { unexpected, orphans: await orphans(seed), results };
}

async function runOnce(runNumber) {
  const seed = await connect();
  const open = [];
  try {
    const outcomes = [];
    for (const first of ["move", "change"]) {
      await purge(seed);
      await seedRun(seed, 1);
      outcomes.push(await deterministic(seed, open, first));
    }
    await purge(seed);
    await seedRun(seed, N);
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
  console.log(`\n=== déplacement d'une ligne d'evento contre changement de récurrence (N=${N}, ${RUNS} runs) ===`);
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
  console.log(`\n${RUNS} runs propres — jamais une ligne déplacée hors des dates de l'evento, dans les deux ordres et en course libre.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
