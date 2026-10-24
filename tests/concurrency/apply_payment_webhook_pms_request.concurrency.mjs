// Lobby après l'acompte (migration 20261023120000) — webhooks `approved` EN DOUBLE, simultanés, sur la
// même commande : une seule demande de booking, un seul jeu d'e-mails.
//
// Mercado Pago livre le même événement plusieurs fois (retentatives, plusieurs notifications) et le job
// de réconciliation le rejoue : apply_payment_webhook doit appliquer le paiement UNE fois. Depuis cette
// migration, l'application pose une demande pms_booking_requests (commande avec une nuit PMS sans
// booking) ou envoie les e-mails 5/6/7/8 (commande sans nuit à réserver) — deux effets qu'un doublon ne
// doit jamais répéter. Le verrou `orders` (pris en premier, règle 8) sérialise les livraisons ; la
// contrainte d'unicité de la demande (order_id) en est le filet.
//
// Par run, deux familles de commandes, chacune visée par DUP livraisons identiques :
//   - PMS : une nuit PMS tenue sans booking → exactement 1 `{ok:true}` et DUP−1 already_applied,
//     exactement 1 demande (pending, 0 tentative), AUCUN e-mail de confirmation (différés) ;
//   - SANS PMS : une activité → exactement 1 application, AUCUNE demande, exactement 1 e-mail 6
//     (partenaire) et 1 e-mail 7 (client) par commande.
// Deux phases : (1) coordonnée — un coordinateur tient chaque commande pendant que ses DUP livraisons
// s'y accumulent, puis la rend ; (2) course libre — toutes les livraisons libérées par une barrière.
// Aucun 40P01, aucune erreur, ≥ 5 runs consécutifs.
//
// ⚠️ Nettoyage AVANT et APRÈS. Préfixe dédié : 7e220000-. Stack locale uniquement.
import pg from "pg";

const { Client } = pg;

const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5;
const ORDERS = 5; // par famille (PMS, sans PMS)
const DUP = 4; // livraisons identiques par commande (40 connexions en tout)

const P = "7e220000-0000-4000-8000-";
const id = (n) => `${P}${String(n).padStart(12, "0")}`;
const PARTNER_ID = id(1);
const ESTABLISHMENT_ID = id(11);
const OWNER_ID = id(21);
const BUYER_ID = id(22);
const PMS_PRODUCT = id(31);
const ACTIVITY_PRODUCT = id(32);
// k = 1..ORDERS : PMS ; k = ORDERS+1..2·ORDERS : sans PMS.
const orderId = (k) => id(100000 + k);
const lineId = (k) => id(200000 + k);
const paymentId = (k) => id(300000 + k);
const isPms = (k) => k <= ORDERS;
const mpId = (run, phase, k) => `MP-CONC-PMSREQ-${run}-${phase}-${k}`;

async function connect(role) {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  if (role) await client.query(`set role ${role}`);
  return client;
}

async function purge(seed) {
  await seed.query(`delete from notification_emails where related_id::text like '${P}%'`);
  await seed.query(`delete from payment_reconciliation_entries where payment_id::text like '${P}%'`);
  await seed.query(`delete from pms_booking_requests where order_id::text like '${P}%'`);
  await seed.query(`delete from payments where order_id::text like '${P}%'`);
  await seed.query(`delete from order_lines where order_id::text like '${P}%'`);
  await seed.query(`delete from orders where id::text like '${P}%'`);
  await seed.query("delete from products where id in ($1, $2)", [PMS_PRODUCT, ACTIVITY_PRODUCT]);
  await seed.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  // Le compte du propriétaire référence le partenaire : les comptes d'abord.
  await seed.query("delete from partner_accounts where id in ($1, $2)", [OWNER_ID, BUYER_ID]);
  await seed.query("delete from partners where id = $1", [PARTNER_ID]);
  await seed.query("delete from auth.users where id in ($1, $2)", [OWNER_ID, BUYER_ID]);
}

async function seedRun(seed) {
  await purge(seed);
  await seed.query("insert into partners (id, display_name) values ($1, 'PMS Request Concurrency')", [PARTNER_ID]);
  await seed.query(
    `insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token)
     values ($1, $2, jsonb_build_object('es', 'PMS Request Conc'), true, 'tok-pmsreq-conc')`,
    [ESTABLISHMENT_ID, PARTNER_ID]
  );
  await seed.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id) values
       ($1, $3, $4, 'lodging', jsonb_build_object('es', 'PMS Request Noche'), 100000, true, 'pmsreq-conc-noche', 7601),
       ($2, $3, $4, 'activity', jsonb_build_object('es', 'PMS Request Act'), 100000, true, 'pmsreq-conc-act', null)`,
    [PMS_PRODUCT, ACTIVITY_PRODUCT, PARTNER_ID, ESTABLISHMENT_ID]
  );
  await seed.query("insert into auth.users (id, email) values ($1, 'pmsreq-owner@test.local'), ($2, 'pmsreq-buyer@test.local')", [
    OWNER_ID,
    BUYER_ID,
  ]);
  await seed.query("update partner_accounts set partner_id = $1 where id = $2", [PARTNER_ID, OWNER_ID]);
  for (let k = 1; k <= 2 * ORDERS; k++) {
    await seed.query(
      `insert into orders (id, account_id, holder_name, holder_email, payment_status)
       values ($1, $2, 'PMS Req', $3, 'pending')`,
      [orderId(k), BUYER_ID, `pmsreq-client-${k}@test.local`]
    );
    await seed.query(
      `insert into order_lines (
         id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
         price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
         acompte_cop, referrer_commission_cop, app_commission_cop, pms_held_at
       ) values ($1, $2, $3, $4, '2030-04-01', $5, 1, 'reserved', 'PMS Req',
                 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000, $6)`,
      [
        lineId(k),
        orderId(k),
        BUYER_ID,
        isPms(k) ? PMS_PRODUCT : ACTIVITY_PRODUCT,
        isPms(k) ? "2030-04-02" : null,
        isPms(k) ? new Date() : null,
      ]
    );
    await seed.query("insert into payments (id, order_id, status, amount_cop) values ($1, $2, 'pending', 17000)", [
      paymentId(k),
      orderId(k),
    ]);
  }
}

const run = (client, sql, params) =>
  client.query(sql, params).then(
    (res) => ({ ok: true, r: res.rows[0]?.r }),
    (error) => ({ ok: false, code: error.code, message: error.message })
  );

const webhook = (client, run_, phase, k) =>
  run(
    client,
    "select public.apply_payment_webhook_checked($1, $2::uuid, 'approved', 17000, jsonb_build_object('transaction_amount', 17000)) as r",
    [mpId(run_, phase, k), paymentId(k)]
  );

function withTimeout(promise, label, ms = 20000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} : délai dépassé (${ms} ms) — interblocage ?`)), ms)),
  ]);
}

async function waitForLockWait(seed, count) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await seed.query(
      "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like '%apply_payment_webhook_checked%'"
    );
    if (rows[0].n >= count) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

async function check(seed, results) {
  const problems = [];
  for (let k = 1; k <= 2 * ORDERS; k++) {
    const mine = results.filter((r) => r.k === k);
    const errors = mine.filter((r) => !r.ok);
    const applied = mine.filter((r) => r.ok && r.r?.ok === true && r.r?.reason === undefined);
    const replays = mine.filter((r) => r.ok && r.r?.reason === "already_applied");
    const { rows } = await seed.query(
      `select o.payment_status,
              (select count(*)::int from pms_booking_requests q where q.order_id = o.id) as demandes,
              (select string_agg(q.status || '/' || q.attempts, ',') from pms_booking_requests q where q.order_id = o.id) as demande,
              (select count(*)::int from notification_emails n where n.related_id = o.id and n.event_type = 'partner_payment_confirmed') as e6,
              (select count(*)::int from notification_emails n where n.related_id = o.id and n.event_type = 'client_order_confirmed') as e7
         from orders o where o.id = $1`,
      [orderId(k)]
    );
    const s = rows[0];
    const expected = isPms(k)
      ? s.demandes === 1 && s.demande === "pending/0" && s.e6 === 0 && s.e7 === 0
      : s.demandes === 0 && s.e6 === 1 && s.e7 === 1;
    if (errors.length || applied.length !== 1 || replays.length !== DUP - 1 || s.payment_status !== "paid" || !expected) {
      problems.push(`commande ${k} (${isPms(k) ? "PMS" : "sans PMS"}) : appliqués ${applied.length}, rejoués ${replays.length}, erreurs ${errors.map((e) => e.code).join("|")}, état ${JSON.stringify(s)}`);
    }
  }
  return problems;
}

async function runPhase(seed, runNumber, phase) {
  await seedRun(seed);
  const total = 2 * ORDERS * DUP;
  const clients = await Promise.all(Array.from({ length: total }, () => connect("service_role")));
  const coordinator = await connect(null);
  try {
    if (phase === "coordonnee") {
      await coordinator.query("begin");
      await coordinator.query(`select 1 from orders where id::text like '${P}%' order by id for update`);
    }
    let ready = 0;
    let release;
    const go = new Promise((resolve) => (release = resolve));
    const pending = Promise.all(
      clients.map(async (client, i) => {
        const k = Math.floor(i / DUP) + 1;
        if (++ready === total) release();
        await go;
        return { k, ...(await webhook(client, runNumber, phase, k)) };
      })
    );
    let waited = true;
    if (phase === "coordonnee") {
      await go;
      waited = await waitForLockWait(seed, total);
      await coordinator.query("commit");
    }
    const results = await withTimeout(pending, `run ${runNumber} ${phase}`);
    const problems = await check(seed, results);
    const deadlocks = results.filter((r) => !r.ok && r.code === "40P01").length;
    console.log(
      `  run ${runNumber} ${phase} : ${total} livraisons, commandes en défaut ${problems.length}/${2 * ORDERS}, interblocages ${deadlocks}${waited ? "" : " (attente du verrou non constatée)"}`
    );
    for (const p of problems) console.error(`    ${p}`);
    return waited && problems.length === 0;
  } finally {
    await coordinator.query("rollback").catch(() => {});
    await Promise.all([...clients, coordinator].map((c) => c.end().catch(() => {})));
  }
}

async function main() {
  const seed = await connect(null);
  let allClean = true;
  try {
    for (let runNumber = 1; runNumber <= RUNS && allClean; runNumber++) {
      if (!(await runPhase(seed, runNumber, "coordonnee"))) allClean = false;
      if (!(await runPhase(seed, runNumber, "libre"))) allClean = false;
    }
  } finally {
    await purge(seed);
    await seed.end();
  }
  if (!allClean) {
    console.error("ÉCHEC : un webhook en double a posé deux demandes, envoyé deux jeux d'e-mails, ou échoué.");
    process.exit(1);
  }
  console.log(`${RUNS} runs consécutifs propres — un paiement, une demande, un seul jeu d'e-mails par commande.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
