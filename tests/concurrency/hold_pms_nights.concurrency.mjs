// Lobby après l'acompte (migration 20261023120000) — test de concurrence RÉELLE de hold_pms_nights, la
// tenue anti-survente des nuits PMS : la disponibilité vient de Lobby (lue à chaud par la route
// check-nights), le verrou de catégorie (pms_category_locks) sérialise les décisions, et la lecture
// « en vol » (tenues des autres commandes, bookings récents) se fait APRÈS ce verrou.
//
// Pourquoi pas pgTAP : chaque fichier pgTAP tourne dans UNE transaction annulée — structurellement
// incapable de faire se croiser deux verrous (hifago/CLAUDE.md §6.3). Squelette de
// docs/05-reference-technique.md §2 (driver `pg`, connexions indépendantes, barrière), plus le
// coordinateur de claim_order_for_pms_booking.concurrency.mjs (il tient le verrou disputé jusqu'à ce
// que tous les appels soient bloqués dessus, puis le rend).
//
// Scénarios, chacun sur ≥ 5 runs consécutifs, aucun échec toléré :
//   1. dernière unité — N commandes, une ligne de qty 1 chacune, même catégorie, même nuit, lecture
//      dispo = 1 : EXACTEMENT 1 tenue, les autres `full` (en vol 1). Deux phases : (a) coordonnée
//      (verrou de catégorie tenu, tous attendent dessus) ; (b) course libre, verrou à matérialiser
//      (la ligne pms_category_locks n'existe pas encore : insertions concurrentes) ;
//   2. dispo = 3, N commandes → EXACTEMENT 3 tenues ;
//   3. booking enregistré ENTRE la lecture de B et son verrou : (a) A, tenue et payée, est bookée
//      (record_pms_booking) pendant que B attend le verrou, sur une lecture faite avant → B refusée ;
//      (a') pareil avec une ligne A jamais tenue (booking de l'ancien flux) : seule la lecture APRÈS
//      verrou la voit → B refusée ; (b) A bookée longtemps avant la lecture (hors marge de 30 s),
//      lecture dispo 0 → refus sur la dispo, sans double comptage (en vol 0) ; (c) même chose, dispo 1
//      → B tenue ;
//   4. interblocage — des commandes à deux catégories, lignes dans des ordres opposés (et deux
//      établissements), lancées ensemble : aucun 40P01, aucune requête pendue, toutes tenues ;
//   5. (une fois) garde d'isolation — appelée sous repeatable read, la fonction refuse.
// Mutations exécutées le 2026-10-23 (rapport de la campagne) : sans le `for update` du verrou de
// catégorie, 1a tient 6 commandes sur 1 unité et 2 en tient 7 sur 3 ; sans la règle (b) « booking
// récent », 3a et 3a' tiennent B sur une unité déjà bookée — rouge à chaque fois.
//
// ⚠️ Nettoyage AVANT et APRÈS (job CI `concurrence` : comptes de lignes avant/après). Préfixe dédié :
// 7e210000-. Contre la stack Supabase locale uniquement (127.0.0.1:54322).
import pg from "pg";

const { Client } = pg;

const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5;
const N = 10; // tenues concurrentes sur la même unité
const PAIRS = 12; // commandes à deux catégories (scénario 4)

const P = "7e210000-0000-4000-8000-";
const id = (n) => `${P}${String(n).padStart(12, "0")}`;
const PARTNER_ID = id(1);
const E1 = id(11);
const E2 = id(12);
const BUYER_ID = id(21);
const P1 = id(31); // E1, catégorie 7501
const P2 = id(32); // E1, catégorie 7502
const P3 = id(33); // E2, catégorie 7501
const CAT1 = 7501;
const CAT2 = 7502;
const NIGHT = "2030-03-01";
const CHECKOUT = "2030-03-02";
const orderId = (k) => id(100000 + k);
const lineId = (k) => id(200000 + k);
const line2Id = (k) => id(300000 + k);

const snapshot = (entries) => {
  const s = {};
  for (const [est, cat, night, n] of entries) {
    s[est] ??= {};
    s[est][String(cat)] ??= {};
    s[est][String(cat)][night] = n;
  }
  return s;
};

async function connect(role) {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  if (role) await client.query(`set role ${role}`);
  return client;
}

async function purge(seed) {
  await seed.query(`delete from pms_cancellation_queue where pms_booking_id like 'CONC-HOLD-%'`);
  await seed.query("delete from pms_sync_state where establishment_id in ($1, $2)", [E1, E2]);
  await seed.query("delete from pms_category_locks where establishment_id in ($1, $2)", [E1, E2]);
  await seed.query(`delete from order_lines where order_id::text like '${P}%'`);
  await seed.query(`delete from orders where id::text like '${P}%'`);
  await seed.query("delete from products where id in ($1, $2, $3)", [P1, P2, P3]);
  await seed.query("delete from establishments where id in ($1, $2)", [E1, E2]);
  await seed.query("delete from partners where id = $1", [PARTNER_ID]);
  await seed.query("delete from partner_accounts where id = $1", [BUYER_ID]);
  await seed.query("delete from auth.users where id = $1", [BUYER_ID]);
}

async function seedBase(seed) {
  await purge(seed);
  await seed.query("insert into partners (id, display_name) values ($1, 'Hold Concurrency Partner')", [PARTNER_ID]);
  await seed.query(
    `insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token) values
       ($1, $3, jsonb_build_object('es', 'Hold Conc Uno'), true, 'tok-hold-conc-1'),
       ($2, $3, jsonb_build_object('es', 'Hold Conc Dos'), true, 'tok-hold-conc-2')`,
    [E1, E2, PARTNER_ID]
  );
  await seed.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id) values
       ($1, $4, $5, 'lodging', jsonb_build_object('es', 'Hold Conc A'), 100000, true, 'hold-conc-a', ${CAT1}),
       ($2, $4, $5, 'lodging', jsonb_build_object('es', 'Hold Conc B'), 100000, true, 'hold-conc-b', ${CAT2}),
       ($3, $4, $6, 'lodging', jsonb_build_object('es', 'Hold Conc C'), 100000, true, 'hold-conc-c', ${CAT1})`,
    [P1, P2, P3, PARTNER_ID, E1, E2]
  );
  await seed.query("insert into auth.users (id, email) values ($1, 'hold-conc@test.local')", [BUYER_ID]);
}

async function insertOrder(seed, k, { status = "unpaid", claimedAt = null } = {}) {
  await seed.query(
    `insert into orders (id, account_id, holder_name, holder_email, payment_status, pms_reserve_claimed_at)
     values ($1, $2, 'Hold Conc', 'hold-conc@test.local', $3, $4)`,
    [orderId(k), BUYER_ID, status, claimedAt]
  );
}

async function insertLine(seed, lid, k, product, { held = false, from = NIGHT, to = CHECKOUT } = {}) {
  await seed.query(
    `insert into order_lines (
       id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
       price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
       acompte_cop, referrer_commission_cop, app_commission_cop, pms_held_at
     ) values ($1, $2, $3, $4, $5, $6, 1, 'reserved', 'Hold Conc',
               100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000,
               case when $7 then now() - interval '1 minute' end)`,
    [lid, orderId(k), BUYER_ID, product, from, to, held]
  );
}

/** Commandes 1..count, une ligne de qty 1 chacune sur (E1, CAT1, NIGHT), jamais tenues. */
async function seedSingleUnit(seed, count) {
  await seedBase(seed);
  for (let k = 1; k <= count; k++) {
    await insertOrder(seed, k);
    await insertLine(seed, lineId(k), k, P1);
  }
}

async function dbNow(client) {
  const { rows } = await client.query("select clock_timestamp() as t");
  return rows[0].t;
}

const holdSql = "select public.hold_pms_nights($1, $2::jsonb, $3::timestamptz) as r";

const run = (client, sql, params) =>
  client.query(sql, params).then(
    (res) => ({ ok: true, r: res.rows[0]?.r }),
    (error) => ({ ok: false, code: error.code, message: error.message })
  );

function withTimeout(promise, label, ms = 20000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} : délai dépassé (${ms} ms) — interblocage ?`)), ms)),
  ]);
}

/**
 * Attend que `count` sessions soient bloquées sur un verrou en exécutant hold_pms_nights. Rend false
 * au bout de 5 s sans les avoir vues : l'appelant relâche quand même et juge sur le résultat (une
 * version sans verrou de catégorie n'attend jamais — le décompte des tenues le montre).
 */
async function waitForLockWait(seed, count) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await seed.query(
      "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like '%hold_pms_nights%'"
    );
    if (rows[0].n >= count) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  console.error(`    ⚠️ moins de ${count} tenue(s) constatée(s) en attente du verrou de catégorie`);
  return false;
}

async function countHeld(seed) {
  const { rows } = await seed.query(
    `select count(*)::int as n from order_lines where order_id::text like '${P}%' and pms_held_at > now() - interval '30 seconds'`
  );
  return rows[0].n;
}

// ── Scénarios 1 et 2 ────────────────────────────────────────────────────────────────────────
async function lastUnits(seed, label, { available, coordinated }) {
  await seedSingleUnit(seed, N);
  const readAt = await dbNow(seed);
  const snap = JSON.stringify(snapshot([[E1, CAT1, NIGHT, available]]));
  if (coordinated) {
    // La ligne de verrou existe déjà : le coordinateur la tient, tous les appels attendent dessus.
    await seed.query("insert into pms_category_locks (establishment_id, lobby_category_id) values ($1, $2)", [E1, CAT1]);
  }
  const clients = await Promise.all(Array.from({ length: N }, () => connect("service_role")));
  const coordinator = await connect(null);
  try {
    if (coordinated) {
      await coordinator.query("begin");
      await coordinator.query("select 1 from pms_category_locks where establishment_id = $1 and lobby_category_id = $2 for update", [E1, CAT1]);
    }
    let ready = 0;
    let release;
    const go = new Promise((resolve) => (release = resolve));
    const pending = Promise.all(
      clients.map(async (client, i) => {
        if (++ready === N) release();
        await go;
        return run(client, holdSql, [orderId(i + 1), snap, readAt]);
      })
    );
    let waited = true;
    if (coordinated) {
      await go;
      waited = await waitForLockWait(seed, N);
      await coordinator.query("commit");
    }
    const results = await withTimeout(pending, label);
    const errors = results.filter((r) => !r.ok);
    const held = results.filter((r) => r.ok && r.r?.ok === true);
    const full = results.filter((r) => r.ok && r.r?.reason === "full" && Number(r.r.in_flight) === available);
    const inBase = await countHeld(seed);
    const clean =
      waited && errors.length === 0 && held.length === available && full.length === N - available && inBase === available;
    console.log(
      `  ${label} : tenues ${held.length} / ${N} (attendu ${available}), full ${full.length}, erreurs ${errors.length}, tenues en base ${inBase}`
    );
    for (const e of errors) console.error(`    erreur : ${e.code ?? ""} ${e.message}`);
    if (!clean) for (const r of results) console.error(`    ${JSON.stringify(r)}`);
    return clean;
  } finally {
    await coordinator.query("rollback").catch(() => {});
    await Promise.all([...clients, coordinator].map((c) => c.end().catch(() => {})));
  }
}

// ── Scénario 3 ──────────────────────────────────────────────────────────────────────────────
// A = commande 1 (payée, bail posé) ; B = commande 2 (une ligne non tenue, même nuit).
async function bookedBetweenReadAndLock(seed, label, { aHeld }) {
  await seedBase(seed);
  const claimedAt = await dbNow(seed);
  await insertOrder(seed, 1, { status: "paid", claimedAt });
  await insertLine(seed, lineId(1), 1, P1, { held: aHeld });
  await insertOrder(seed, 2);
  await insertLine(seed, lineId(2), 2, P1);
  await seed.query("insert into pms_category_locks (establishment_id, lobby_category_id) values ($1, $2)", [E1, CAT1]);

  // B « lit » Lobby : A n'y est pas encore → 1 libre.
  const readAt = await dbNow(seed);
  const snap = JSON.stringify(snapshot([[E1, CAT1, NIGHT, 1]]));
  const coordinator = await connect(null);
  const b = await connect("service_role");
  const a = await connect("service_role");
  try {
    await coordinator.query("begin");
    await coordinator.query("select 1 from pms_category_locks where establishment_id = $1 and lobby_category_id = $2 for update", [E1, CAT1]);
    const holdB = run(b, holdSql, [orderId(2), snap, readAt]);
    const waited = await waitForLockWait(seed, 1);
    // A est bookée PENDANT que B attend — après la lecture de B, avant son verrou.
    const recorded = await run(a, "select public.record_pms_booking($1, $2::timestamptz, $3, 'CONC-HOLD-A') as r", [
      orderId(1),
      claimedAt,
      lineId(1),
    ]);
    await coordinator.query("commit");
    const resB = await withTimeout(holdB, label);
    const clean =
      waited && recorded.ok && recorded.r?.ok === true &&
      resB.ok && resB.r?.reason === "full" && Number(resB.r.in_flight) === 1 && Number(resB.r.available) === 1;
    console.log(`  ${label} : record A ${JSON.stringify(recorded.r ?? recorded.message)}, B ${JSON.stringify(resB.r ?? resB.message)}`);
    return clean;
  } finally {
    await coordinator.query("rollback").catch(() => {});
    await Promise.all([coordinator, a, b].map((c) => c.end().catch(() => {})));
  }
}

async function bookedLongBeforeRead(seed, label, { available, expectHeld }) {
  await seedBase(seed);
  const claimedAt = await dbNow(seed);
  await insertOrder(seed, 1, { status: "paid", claimedAt });
  await insertLine(seed, lineId(1), 1, P1, { held: true });
  await insertOrder(seed, 2);
  await insertLine(seed, lineId(2), 2, P1);
  const a = await connect("service_role");
  const b = await connect("service_role");
  try {
    const recorded = await run(a, "select public.record_pms_booking($1, $2::timestamptz, $3, 'CONC-HOLD-B') as r", [
      orderId(1),
      claimedAt,
      lineId(1),
    ]);
    // Le booking a « 50 s » au moment de la lecture de B (lue il y a 5 s) : hors de la marge de 30 s,
    // Lobby l'avait déjà — la lecture le reflète.
    await a.query("reset role");
    await a.query("update order_lines set pms_recorded_at = clock_timestamp() - interval '50 seconds' where id = $1", [lineId(1)]);
    const readAt = (await a.query("select clock_timestamp() - interval '5 seconds' as t")).rows[0].t;
    const res = await run(b, holdSql, [orderId(2), JSON.stringify(snapshot([[E1, CAT1, NIGHT, available]])), readAt]);
    const clean = expectHeld
      ? recorded.ok && res.ok && res.r?.ok === true
      : recorded.ok && res.ok && res.r?.reason === "full" && Number(res.r.in_flight) === 0 && Number(res.r.available) === available;
    console.log(`  ${label} : B ${JSON.stringify(res.r ?? res.message)}`);
    return clean;
  } finally {
    await Promise.all([a, b].map((c) => c.end().catch(() => {})));
  }
}

// ── Scénario 4 ──────────────────────────────────────────────────────────────────────────────
async function noDeadlock(seed, label) {
  await seedBase(seed);
  // Des commandes à deux nuits de deux catégories ; la ligne de plus petit id est tantôt sur CAT1,
  // tantôt sur CAT2, tantôt dans l'autre établissement : un verrouillage dans l'ordre des lignes
  // (au lieu de l'ordre global des catégories) s'interbloquerait.
  for (let k = 1; k <= PAIRS; k++) {
    await insertOrder(seed, k);
    const [first, second] =
      k % 3 === 0 ? [P1, P2] : k % 3 === 1 ? [P2, P1] : [P3, P1];
    await insertLine(seed, lineId(k), k, first);
    await insertLine(seed, line2Id(k), k, second);
  }
  const readAt = await dbNow(seed);
  const snap = JSON.stringify(
    snapshot([
      [E1, CAT1, NIGHT, 100],
      [E1, CAT2, NIGHT, 100],
      [E2, CAT1, NIGHT, 100],
    ])
  );
  const clients = await Promise.all(Array.from({ length: PAIRS }, () => connect("service_role")));
  try {
    let ready = 0;
    let release;
    const go = new Promise((resolve) => (release = resolve));
    const results = await withTimeout(
      Promise.all(
        clients.map(async (client, i) => {
          if (++ready === PAIRS) release();
          await go;
          return run(client, holdSql, [orderId(i + 1), snap, readAt]);
        })
      ),
      label
    );
    const deadlocks = results.filter((r) => !r.ok && r.code === "40P01");
    const errors = results.filter((r) => !r.ok);
    const held = results.filter((r) => r.ok && r.r?.ok === true && r.r.held_lines === 2);
    console.log(`  ${label} : tenues ${held.length} / ${PAIRS}, interblocages ${deadlocks.length}, erreurs ${errors.length}`);
    for (const e of errors) console.error(`    erreur : ${e.code ?? ""} ${e.message}`);
    return errors.length === 0 && held.length === PAIRS;
  } finally {
    await Promise.all(clients.map((c) => c.end().catch(() => {})));
  }
}

/**
 * Garde d'isolation : la lecture « en vol » doit voir ce qui a commité pendant l'attente du verrou —
 * vrai en read committed seulement. Sous repeatable read (instantané figé au début de la
 * transaction), la fonction refuse au lieu de décider sur un état périmé.
 */
async function isolationGuard(seed) {
  await seedSingleUnit(seed, 1);
  const client = await connect("service_role");
  try {
    await client.query("begin transaction isolation level repeatable read");
    const res = await run(client, holdSql, [orderId(1), JSON.stringify(snapshot([[E1, CAT1, NIGHT, 1]])), await dbNow(seed)]);
    await client.query("rollback").catch(() => {});
    const clean = !res.ok && /read committed requise/.test(res.message);
    console.log(`  5  isolation repeatable read → ${res.ok ? "ACCEPTÉE (faute)" : `refusée : ${res.message}`}`);
    return clean;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const seed = await connect(null);
  let allClean = true;
  try {
    if (!(await isolationGuard(seed))) allClean = false;
    for (let runNumber = 1; runNumber <= RUNS && allClean; runNumber++) {
      console.log(`Run ${runNumber}`);
      const outcomes = [
        await lastUnits(seed, "1a dernière unité, coordonnée", { available: 1, coordinated: true }),
        await lastUnits(seed, "1b dernière unité, course libre (verrou à matérialiser)", { available: 1, coordinated: false }),
        await lastUnits(seed, "2  trois unités, course libre", { available: 3, coordinated: false }),
        await bookedBetweenReadAndLock(seed, "3a booking de A (tenue) entre la lecture et le verrou de B", { aHeld: true }),
        await bookedBetweenReadAndLock(seed, "3a' booking de A (jamais tenue) entre la lecture et le verrou de B", { aHeld: false }),
        await bookedLongBeforeRead(seed, "3b booking de A bien avant la lecture, dispo 0", { available: 0, expectHeld: false }),
        await bookedLongBeforeRead(seed, "3c booking de A bien avant la lecture, dispo 1", { available: 1, expectHeld: true }),
        await noDeadlock(seed, "4  deux catégories, ordres opposés"),
      ];
      if (outcomes.some((ok) => !ok)) {
        allClean = false;
        console.error(`ÉCHEC au run ${runNumber}. Zéro tolérance à un échec isolé.`);
        break;
      }
    }
  } finally {
    await purge(seed);
    await seed.end();
  }
  if (!allClean) process.exit(1);
  console.log(`${RUNS} runs consécutifs propres — jamais plus de tenues que d'unités lues, aucun interblocage.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
