// Lobby après l'acompte, « une issue inconnue n'est jamais retentée » (migration 20261023150000) —
// test de concurrence RÉELLE de mark_pms_booking_attempt, le marqueur durable posé AVANT chaque
// POST /bookings. LobbyPMS n'a ni clé d'idempotence ni recherche de booking : si deux appels
// obtenaient chacun le marqueur de la même nuit, deux POST partiraient — deux bookings payés chez le
// partenaire, que l'API ne sait pas annuler (RESTRICTED_RESERVATION).
//
// Pourquoi pas pgTAP : chaque fichier tourne dans UNE transaction annulée, incapable de faire se
// croiser deux verrous (hifago/CLAUDE.md §6.3). Squelette de docs/05-reference-technique.md §2
// (driver `pg`, connexions indépendantes, barrière) et coordinateur de
// claim_paid_order_for_pms_booking.concurrency.mjs.
//
// Scénarios, chacun sur ≥ 5 runs consécutifs, aucun échec toléré :
//   1. coordonné — un coordinateur tient la commande (`orders` for update) jusqu'à ce que les N appels
//      attendent dessus, puis la rend : EXACTEMENT 1 {ok:true}, N − 1 already_attempted ;
//   2. course libre — barrière seule, même attendu ;
//   3. N lignes d'une même commande, un appel par ligne, ensemble : N {ok:true} (aucun faux refus,
//      aucun interblocage — tous prennent `orders` d'abord).
// Mutation exécutée le 2026-10-23 : sans le `for update` sur `orders` ni sur la ligne, les scénarios 1
// et 2 rendent 12 ok sur 12 — douze POST /bookings pour une seule nuit. Rouge au premier run.
//
// ⚠️ Nettoyage AVANT et APRÈS (job CI `concurrence` : comptes de lignes avant/après). Préfixe dédié :
// 7e250000-. Stack locale uniquement (127.0.0.1:54322).
import pg from "pg";

const { Client } = pg;

const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5;
const N = 12; // appels concurrents

const P = "7e250000-0000-4000-8000-";
const id = (n) => `${P}${String(n).padStart(12, "0")}`;
const PARTNER_ID = id(1);
const ESTABLISHMENT_ID = id(11);
const BUYER_ID = id(21);
const PRODUCT_ID = id(31);
const ORDER_ID = id(100001);
const lineId = (k) => id(200000 + k);
// Le claim de la commande : une valeur fixe, celle que l'Edge Function tient de claim_paid.
const CLAIMED_AT = "2029-12-01T10:00:00.000Z";

async function connect(role) {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  if (role) await client.query(`set role ${role}`);
  return client;
}

async function purge(seed) {
  await seed.query(`delete from order_lines where order_id::text like '${P}%'`);
  await seed.query(`delete from orders where id::text like '${P}%'`);
  await seed.query("delete from products where id = $1", [PRODUCT_ID]);
  await seed.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await seed.query("delete from partners where id = $1", [PARTNER_ID]);
  await seed.query("delete from partner_accounts where id = $1", [BUYER_ID]);
  await seed.query("delete from auth.users where id = $1", [BUYER_ID]);
}

/** Une commande payée sous le claim CLAIMED_AT, `lines` nuits PMS réservées sans booking ni marqueur. */
async function seedRun(seed, lines) {
  await purge(seed);
  await seed.query("insert into partners (id, display_name) values ($1, 'Mark Attempt Concurrency')", [PARTNER_ID]);
  await seed.query(
    `insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token)
     values ($1, $2, jsonb_build_object('es', 'Mark Attempt Conc'), true, 'tok-mark-conc')`,
    [ESTABLISHMENT_ID, PARTNER_ID]
  );
  await seed.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id)
     values ($1, $2, $3, 'lodging', jsonb_build_object('es', 'Mark Attempt Noche'), 100000, true, 'mark-conc-noche', 7801)`,
    [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID]
  );
  await seed.query("insert into auth.users (id, email) values ($1, 'mark-conc@test.local')", [BUYER_ID]);
  await seed.query(
    `insert into orders (id, account_id, holder_name, holder_email, payment_status, pms_reserve_claimed_at)
     values ($1, $2, 'Mark Attempt', 'mark-conc@test.local', 'paid', $3)`,
    [ORDER_ID, BUYER_ID, CLAIMED_AT]
  );
  for (let k = 1; k <= lines; k++) {
    await seed.query(
      `insert into order_lines (
         id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
         price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
         acompte_cop, referrer_commission_cop, app_commission_cop, pms_held_at
       ) values ($1, $2, $3, $4, '2030-06-01'::date + $5::int, '2030-06-02'::date + $5::int, 1, 'reserved', 'Mark Attempt',
                 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000, now())`,
      [lineId(k), ORDER_ID, BUYER_ID, PRODUCT_ID, k]
    );
  }
}

const markSql = "select public.mark_pms_booking_attempt($1, $2::timestamptz, $3) as r";

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

/** Attend que `count` sessions soient bloquées sur un verrou en exécutant mark_pms_booking_attempt. */
async function waitForLockWait(seed, count) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await seed.query(
      "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like '%mark_pms_booking_attempt%'"
    );
    if (rows[0].n >= count) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  console.error(`    ⚠️ moins de ${count} appel(s) constaté(s) en attente du verrou de la commande`);
  return false;
}

async function markers(seed) {
  const { rows } = await seed.query(
    `select count(*) filter (where pms_attempt_started_at is not null)::int as n from order_lines where order_id = $1`,
    [ORDER_ID]
  );
  return rows[0].n;
}

// ── Scénarios 1 et 2 : la même ligne ────────────────────────────────────────────────────────
async function sameLine(seed, label, { coordinated }) {
  await seedRun(seed, 1);
  const clients = await Promise.all(Array.from({ length: N }, () => connect("service_role")));
  const coordinator = await connect(null);
  try {
    if (coordinated) {
      await coordinator.query("begin");
      await coordinator.query("select 1 from orders where id = $1 for update", [ORDER_ID]);
    }
    let ready = 0;
    let release;
    const go = new Promise((resolve) => (release = resolve));
    const pending = Promise.all(
      clients.map(async (client) => {
        if (++ready === N) release();
        await go;
        return run(client, markSql, [ORDER_ID, CLAIMED_AT, lineId(1)]);
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
    const winners = results.filter((r) => r.ok && r.r?.ok === true);
    const refused = results.filter((r) => r.ok && r.r?.ok === false && r.r?.reason === "already_attempted");
    const inBase = await markers(seed);
    const clean = waited && errors.length === 0 && winners.length === 1 && refused.length === N - 1 && inBase === 1;
    console.log(
      `  ${label} : marqueur obtenu ${winners.length} / ${N} (doit être 1), already_attempted ${refused.length}, erreurs ${errors.length}, marqueurs en base ${inBase}`
    );
    for (const e of errors) console.error(`    erreur : ${e.code ?? ""} ${e.message}`);
    if (!clean) for (const r of results) console.error(`    ${JSON.stringify(r)}`);
    return clean;
  } finally {
    await coordinator.query("rollback").catch(() => {});
    await Promise.all([...clients, coordinator].map((c) => c.end().catch(() => {})));
  }
}

// ── Scénario 3 : N lignes, un appel chacune ─────────────────────────────────────────────────
async function distinctLines(seed, label) {
  await seedRun(seed, N);
  const clients = await Promise.all(Array.from({ length: N }, () => connect("service_role")));
  try {
    let ready = 0;
    let release;
    const go = new Promise((resolve) => (release = resolve));
    const results = await withTimeout(
      Promise.all(
        clients.map(async (client, i) => {
          if (++ready === N) release();
          await go;
          return run(client, markSql, [ORDER_ID, CLAIMED_AT, lineId(i + 1)]);
        })
      ),
      label
    );
    const errors = results.filter((r) => !r.ok);
    const winners = results.filter((r) => r.ok && r.r?.ok === true);
    const inBase = await markers(seed);
    const clean = errors.length === 0 && winners.length === N && inBase === N;
    console.log(`  ${label} : marqueurs obtenus ${winners.length} / ${N} (doit être ${N}), erreurs ${errors.length}, en base ${inBase}`);
    for (const e of errors) console.error(`    erreur : ${e.code ?? ""} ${e.message}`);
    return clean;
  } finally {
    await Promise.all(clients.map((c) => c.end().catch(() => {})));
  }
}

async function main() {
  const seed = await connect(null);
  let allClean = true;
  try {
    for (let runNumber = 1; runNumber <= RUNS && allClean; runNumber++) {
      console.log(`Run ${runNumber}`);
      const outcomes = [
        await sameLine(seed, "1 même ligne, coordonné", { coordinated: true }),
        await sameLine(seed, "2 même ligne, course libre", { coordinated: false }),
        await distinctLines(seed, "3 lignes distinctes, course libre"),
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
  if (!allClean) {
    console.error("ÉCHEC : deux marqueurs sur la même nuit (deux POST /bookings possibles), ou un faux refus.");
    process.exit(1);
  }
  console.log(`${RUNS} runs consécutifs propres — un seul marqueur par nuit, jamais deux POST /bookings.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
