// Lobby après l'acompte (migration 20261023120000) — « passage immédiat contre le cron » : deux
// passages de pms-book-paid-orders (le trigger de pms_booking_requests après le webhook, le cron de
// chaque minute) ne doivent JAMAIS réserver la même commande ensemble — LobbyPMS n'a ni clé
// d'idempotence ni recherche de booking : deux POST /bookings feraient deux réservations chez le
// partenaire, pour une commande payée une fois.
//
// Deux barrières, prouvées sous concurrence réelle (≥ 5 runs consécutifs, aucun échec toléré) :
//   1. claim_pms_booking_requests — P passages simultanés sur M demandes dues : chaque demande est
//      réclamée par UN passage exactement (`for update skip locked`), mise sous bail, tentative + 1 ;
//      un passage suivant ne la reprend pas ;
//   2. claim_paid_order_for_pms_booking — N appels simultanés sur LA MÊME commande payée : un seul
//      obtient le bail (claimed_at non nul), les autres claim_in_progress. Phase coordonnée : un
//      coordinateur tient la commande jusqu'à ce que tous attendent dessus (sans le `for update`, les
//      N claims passeraient, de façon déterministe).
//
// ⚠️ Nettoyage AVANT et APRÈS. Préfixe dédié : 7e230000-. Stack locale uniquement.
import pg from "pg";

const { Client } = pg;

const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5;
const REQUESTS = 12; // demandes dues
const PASSES = 6; // passages concurrents de la file
const LIMIT = 3; // le lot de l'Edge Function
const N = 12; // claims concurrents de la même commande

const P = "7e230000-0000-4000-8000-";
const id = (n) => `${P}${String(n).padStart(12, "0")}`;
const PARTNER_ID = id(1);
const ESTABLISHMENT_ID = id(11);
const BUYER_ID = id(21);
const PRODUCT_ID = id(31);
const orderId = (k) => id(100000 + k);
const lineId = (k) => id(200000 + k);
const requestId = (k) => id(300000 + k);

async function connect(role) {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  if (role) await client.query(`set role ${role}`);
  return client;
}

async function purge(seed) {
  await seed.query(`delete from pms_booking_requests where order_id::text like '${P}%'`);
  await seed.query(`delete from order_lines where order_id::text like '${P}%'`);
  await seed.query(`delete from orders where id::text like '${P}%'`);
  await seed.query("delete from products where id = $1", [PRODUCT_ID]);
  await seed.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await seed.query("delete from partners where id = $1", [PARTNER_ID]);
  await seed.query("delete from partner_accounts where id = $1", [BUYER_ID]);
  await seed.query("delete from auth.users where id = $1", [BUYER_ID]);
}

async function seedRun(seed) {
  await purge(seed);
  await seed.query("insert into partners (id, display_name) values ($1, 'Claim Paid Concurrency')", [PARTNER_ID]);
  await seed.query(
    `insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token)
     values ($1, $2, jsonb_build_object('es', 'Claim Paid Conc'), true, 'tok-claimpaid-conc')`,
    [ESTABLISHMENT_ID, PARTNER_ID]
  );
  await seed.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id)
     values ($1, $2, $3, 'lodging', jsonb_build_object('es', 'Claim Paid Noche'), 100000, true, 'claimpaid-conc-noche', 7701)`,
    [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID]
  );
  await seed.query("insert into auth.users (id, email) values ($1, 'claimpaid-conc@test.local')", [BUYER_ID]);
  for (let k = 1; k <= REQUESTS; k++) {
    await seed.query(
      `insert into orders (id, account_id, holder_name, holder_email, payment_status) values ($1, $2, 'Claim Paid', 'claimpaid-conc@test.local', 'paid')`,
      [orderId(k), BUYER_ID]
    );
    await seed.query(
      `insert into order_lines (
         id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
         price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
         acompte_cop, referrer_commission_cop, app_commission_cop, pms_held_at
       ) values ($1, $2, $3, $4, '2030-05-01', '2030-05-02', 1, 'reserved', 'Claim Paid',
                 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000, now())`,
      [lineId(k), orderId(k), BUYER_ID, PRODUCT_ID]
    );
    // Dues il y a 30 ans (et dans cet ordre) : les plus anciennes de toute base, prises en premier.
    await seed.query(
      `insert into pms_booking_requests (id, order_id, next_attempt_at) values ($1, $2, now() - interval '30 years' + $3 * interval '1 second')`,
      [requestId(k), orderId(k), k]
    );
  }
}

const run = (client, sql, params) =>
  client.query(sql, params).then(
    (res) => ({ ok: true, rows: res.rows }),
    (error) => ({ ok: false, code: error.code, message: error.message })
  );

function withTimeout(promise, label, ms = 20000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} : délai dépassé (${ms} ms) — interblocage ?`)), ms)),
  ]);
}

async function waitForLockWait(seed, fragment, count) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await seed.query(
      "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like $1",
      [`%${fragment}%`]
    );
    if (rows[0].n >= count) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

async function queuePasses(seed, runNumber) {
  await seedRun(seed);
  const clients = await Promise.all(Array.from({ length: PASSES }, () => connect("service_role")));
  try {
    let ready = 0;
    let release;
    const go = new Promise((resolve) => (release = resolve));
    // Chaque passage boucle comme l'Edge Function le ferait sur plusieurs ticks, jusqu'à ne plus rien
    // obtenir : la file doit se vider sans qu'aucune demande ne soit servie deux fois.
    const results = await withTimeout(
      Promise.all(
        clients.map(async (client) => {
          if (++ready === PASSES) release();
          await go;
          const mine = [];
          for (let tick = 0; tick < REQUESTS; tick++) {
            const res = await run(client, `select request_id, attempts from public.claim_pms_booking_requests(${LIMIT})`, []);
            if (!res.ok) return { ok: false, error: res };
            const ours = res.rows.filter((r) => r.request_id.startsWith(P));
            if (ours.length === 0) break;
            mine.push(...ours);
          }
          return { ok: true, mine };
        })
      ),
      `run ${runNumber} file`
    );
    const errors = results.filter((r) => !r.ok);
    const claimed = results.filter((r) => r.ok).flatMap((r) => r.mine);
    const distinct = new Set(claimed.map((r) => r.request_id));
    const attemptsOk = claimed.every((r) => r.attempts === 1);
    const { rows } = await seed.query(
      `select count(*)::int as n,
              count(*) filter (where attempts = 1 and next_attempt_at > now() + interval '4 minutes')::int as sous_bail
         from pms_booking_requests where order_id::text like '${P}%'`
    );
    const clean = errors.length === 0 && claimed.length === REQUESTS && distinct.size === REQUESTS && attemptsOk && rows[0].sous_bail === REQUESTS;
    console.log(
      `  run ${runNumber} file : ${PASSES} passages, ${claimed.length} réclamations pour ${REQUESTS} demandes (distinctes ${distinct.size}), sous bail ${rows[0].sous_bail}, erreurs ${errors.length}`
    );
    for (const e of errors) console.error(`    erreur : ${JSON.stringify(e.error)}`);
    return clean;
  } finally {
    await Promise.all(clients.map((c) => c.end().catch(() => {})));
  }
}

async function sameOrderClaims(seed, runNumber) {
  await seedRun(seed);
  const target = orderId(1);
  const clients = await Promise.all(Array.from({ length: N }, () => connect("service_role")));
  const coordinator = await connect(null);
  try {
    await coordinator.query("begin");
    await coordinator.query("select 1 from orders where id = $1 for update", [target]);
    let ready = 0;
    let release;
    const go = new Promise((resolve) => (release = resolve));
    const pending = Promise.all(
      clients.map(async (client) => {
        if (++ready === N) release();
        await go;
        const res = await run(client, "select public.claim_paid_order_for_pms_booking($1) as r", [target]);
        return res.ok ? res.rows[0].r : { ok: false, reason: `erreur ${res.code} ${res.message}` };
      })
    );
    await go;
    const waited = await waitForLockWait(seed, "claim_paid_order_for_pms_booking", N);
    await coordinator.query("commit");
    const results = await withTimeout(pending, `run ${runNumber} claim`);
    const winners = results.filter((r) => r.ok === true && r.claimed_at !== null);
    const busy = results.filter((r) => r.ok === false && r.reason === "claim_in_progress");
    const { rows } = await seed.query("select pms_reserve_claimed_at is not null as pose from orders where id = $1", [target]);
    const clean = waited && winners.length === 1 && busy.length === N - 1 && rows[0].pose;
    console.log(
      `  run ${runNumber} claim : bail obtenu ${winners.length} / ${N} (doit être 1), claim_in_progress ${busy.length}, bail posé ${rows[0].pose}${waited ? "" : " (attente du verrou non constatée)"}`
    );
    if (!clean) for (const r of results) console.error(`    ${JSON.stringify(r).slice(0, 200)}`);
    return clean;
  } finally {
    await coordinator.query("rollback").catch(() => {});
    await Promise.all([...clients, coordinator].map((c) => c.end().catch(() => {})));
  }
}

async function main() {
  const seed = await connect(null);
  // claim_pms_booking_requests prend un lot GLOBAL : sur une base qui porte d'autres demandes dues,
  // ce test les réclamerait réellement (tentative + 1, bail). Il s'arrête plutôt (code 2).
  const { rows: foreign } = await seed.query(
    `select count(*)::int as n from pms_booking_requests where status = 'pending' and order_id::text not like '${P}%'`
  );
  if (foreign[0].n > 0) {
    console.error(`ARRÊT : ${foreign[0].n} demande(s) pending hors des fixtures de ce test — base à nettoyer avant de le lancer.`);
    await seed.end();
    process.exit(2);
  }
  let allClean = true;
  try {
    for (let runNumber = 1; runNumber <= RUNS && allClean; runNumber++) {
      if (!(await queuePasses(seed, runNumber))) allClean = false;
      if (!(await sameOrderClaims(seed, runNumber))) allClean = false;
    }
  } finally {
    await purge(seed);
    await seed.end();
  }
  if (!allClean) {
    console.error("ÉCHEC : une demande servie deux fois, ou deux bails sur la même commande.");
    process.exit(1);
  }
  console.log(`${RUNS} runs consécutifs propres — chaque demande réclamée une fois, un seul bail par commande.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
