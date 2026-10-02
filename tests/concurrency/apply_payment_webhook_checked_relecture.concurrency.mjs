// Montant vérifié en base (migration 20261002021045) — la relecture du statut SOUS le verrou.
//
// apply_payment_webhook_checked lit `payments` sans verrou, puis, s'il voit un écart (ou un montant
// absent) sur un `approved`, prend les verrous orders → payments et RELIT le statut. Si le paiement
// est devenu `approved` entre-temps (un autre paiement Mercado Pago vient d'être appliqué), il
// délègue (double_payment) : jamais un écart de montant sur une commande payée. Seule une vraie
// course peut le prouver — en séquence, la lecture sans verrou voit déjà `approved` (pgTAP K6/K7).
//
// DÉTERMINISTE, pas un pari sur l'ordonnanceur : pour chaque commande, un coordinateur applique
// mp-1 au bon montant dans une transaction OUVERTE (verrous tenus, `approved` non validé). Le
// webhook appelle alors checked(mp-2, montant null) : sa lecture sans verrou voit encore `pending`,
// il entre dans la branche d'écart et attend le verrou. On ne valide les coordinateurs qu'une fois
// TOUS les webhooks en attente de verrou (pg_stat_activity), puis on relit l'issue. Une version qui
// déciderait sur la lecture sans verrou classerait mp-2 en amount_mismatch, à chaque fois.
//
// ⚠️ Nettoyage AVANT et APRÈS. Préfixe d'identifiants dédié : 66000000-. Stack locale seulement.
import pg from "pg";

const { Client } = pg;
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5;
const ORDERS = 8;

const P = "66000000-0000-4000-8000-";
const PARTNER_ID = `${P}000000000001`;
const ESTABLISHMENT_ID = `${P}000000000002`;
const PRODUCT_ID = `${P}000000000003`;
const BUYER_ID = `${P}000000000004`;
const ADMIN_ID = `${P}000000000005`;
const DATE = "2028-12-20";
const orderId = (i) => `${P}${String(100 + i).padStart(12, "0")}`;
const lineId = (i) => `${P}${String(200 + i).padStart(12, "0")}`;
const paymentId = (i) => `${P}${String(300 + i).padStart(12, "0")}`;

async function purgeAll(seed) {
  await seed.query(`delete from payment_refunds where payment_id::text like '${P}%'`);
  await seed.query(`delete from notification_emails where related_id in
    (select id from payment_reconciliation_entries where payment_id::text like '${P}%')`);
  await seed.query(`delete from payment_reconciliation_entries where payment_id::text like '${P}%'`);
  await seed.query(`delete from notification_emails where related_id::text like '${P}%' or recipient_account_id in ($1, $2)`, [BUYER_ID, ADMIN_ID]);
  await seed.query(`delete from payments where order_id::text like '${P}%'`);
  await seed.query(`delete from ledger_entries where order_line_id in (select id from order_lines where order_id::text like '${P}%')`);
  await seed.query(`delete from order_lines where order_id::text like '${P}%'`);
  await seed.query(`delete from orders where id::text like '${P}%'`);
  await seed.query("delete from product_availability where product_id = $1", [PRODUCT_ID]);
  await seed.query("delete from products where id = $1", [PRODUCT_ID]);
  await seed.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await seed.query("delete from partner_capabilities where account_id = $1", [ADMIN_ID]);
  await seed.query("delete from partners where id = $1", [PARTNER_ID]);
  await seed.query("delete from partner_accounts where id in ($1, $2)", [BUYER_ID, ADMIN_ID]);
  await seed.query("delete from auth.users where id in ($1, $2)", [BUYER_ID, ADMIN_ID]);
}

async function resetAll(seed) {
  await purgeAll(seed);
  await seed.query("insert into partners (id, display_name) values ($1, 'Relecture Concurrency Partner')", [PARTNER_ID]);
  await seed.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID, PARTNER_ID, JSON.stringify({ es: "Relecture Concurrency Establishment" }),
  ]);
  await seed.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values ($1, $2, $3, 'activity', jsonb_build_object('es', 'Relecture concurrency'), 100000, true, 'relecture-concurrency')`,
    [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID]
  );
  await seed.query(
    "insert into product_availability (product_id, date, capacity, booked) values ($1, $2, 100, $3)",
    [PRODUCT_ID, DATE, ORDERS]
  );
  await seed.query("insert into auth.users (id, email) values ($1, $2), ($3, $4)", [
    BUYER_ID, "relecture-concurrency-buyer@hifago.test", ADMIN_ID, "relecture-concurrency-admin@hifago.test",
  ]);
  await seed.query(
    "insert into partner_capabilities (account_id, role, source, status) values ($1, 'admin', 'migration', 'active')",
    [ADMIN_ID]
  );
  for (let i = 0; i < ORDERS; i++) {
    await seed.query(
      `insert into orders (id, account_id, holder_name, holder_email, payment_status, created_at)
       values ($1, $2, $3, $4, 'pending', now() - interval '5 minutes')`,
      [orderId(i), BUYER_ID, `Holder ${i}`, `holder-${i}@hifago.test`]
    );
    await seed.query(
      `insert into order_lines (id, order_id, account_id, product_id, date, qty, status, holder_name,
         price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop)
       values ($1, $2, $3, $4, $5, 1, 'reserved', $6, 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000)`,
      [lineId(i), orderId(i), BUYER_ID, PRODUCT_ID, DATE, `Holder ${i}`]
    );
    await seed.query(
      "insert into payments (id, order_id, status, amount_cop, created_at) values ($1, $2, 'pending', 17000, now() - interval '5 minutes')",
      [paymentId(i), orderId(i)]
    );
  }
}

async function connect() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  return client;
}

const evenement = (mpId, montant) =>
  JSON.stringify({ mp_payment_id: mpId, status: "approved", transaction_amount: montant, currency_id: "COP" });

/**
 * Attend que `n` appels du webhook à checked soient bloqués sur un verrou — jamais un sleep au
 * hasard. Reconnus à leur texte (`'approved', null`) : les paramètres, eux, n'apparaissent pas
 * dans pg_stat_activity.
 */
async function attendreEnAttente(seed, n) {
  for (let essai = 0; essai < 200; essai++) {
    const { rows } = await seed.query(
      `select count(*)::int as n from pg_stat_activity
        where wait_event_type = 'Lock'
          and query like '%apply_payment_webhook_checked(%''approved'', null,%'`
    );
    if (rows[0].n >= n) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function runOnce(run, seed) {
  await resetAll(seed);
  const coordinateurs = await Promise.all(Array.from({ length: ORDERS }, connect));
  const webhooks = await Promise.all(Array.from({ length: ORDERS }, connect));
  try {
    // 1. Chaque coordinateur applique mp-1 au bon montant, SANS valider : verrous tenus.
    for (let i = 0; i < ORDERS; i++) {
      await coordinateurs[i].query("begin");
      const res = await coordinateurs[i].query(
        "select apply_payment_webhook_checked($1, $2::uuid, 'approved', 17000, $3::jsonb) as r",
        [`mp-1-${run}-${i}`, paymentId(i), evenement(`mp-1-${run}-${i}`, 17000)]
      );
      if (res.rows[0].r?.ok !== true) throw new Error(`coordinateur ${i} : ${JSON.stringify(res.rows[0].r)}`);
    }
    // 2. Les webhooks (montant null) partent : lecture sans verrou = `pending`, puis attente du verrou.
    const issues = webhooks.map((c, i) =>
      c.query("select apply_payment_webhook_checked($1, $2::uuid, 'approved', null, $3::jsonb) as r", [
        `mp-2-${run}-${i}`, paymentId(i), evenement(`mp-2-${run}-${i}`, null),
      ])
    );
    const tousEnAttente = await attendreEnAttente(seed, ORDERS);
    // 3. On valide : chaque webhook obtient le verrou et doit relire `approved`.
    for (const c of coordinateurs) await c.query("commit");
    const resultats = (await Promise.all(issues)).map((r) => r.rows[0].r);

    const { rows } = await seed.query(
      `select reason_code, count(*)::int as n from payment_reconciliation_entries
        where payment_id::text like '${P}%' and mp_payment_id like 'mp-2-${run}-%' group by reason_code`
    );
    const parCode = Object.fromEntries(rows.map((r) => [r.reason_code, r.n]));
    const { rows: payees } = await seed.query(
      `select count(*)::int as n from orders where id::text like '${P}%' and payment_status = 'paid'`
    );
    const doubles = resultats.filter((r) => r?.reason === "double_payment").length;
    const ecarts = resultats.filter((r) => r?.reason === "amount_mismatch").length;
    console.log(
      `  run ${run}: webhooks en attente avant validation ${tousEnAttente ? "oui" : "NON"}, double_payment ${doubles}/${ORDERS}, amount_mismatch ${ecarts} (attendu 0), entrées ${JSON.stringify(parCode)}, commandes payées ${payees[0].n}/${ORDERS}`
    );
    return tousEnAttente && doubles === ORDERS && ecarts === 0 && !parCode.amount_mismatch &&
      parCode.double_payment === ORDERS && payees[0].n === ORDERS;
  } finally {
    await Promise.all([...coordinateurs, ...webhooks].map((c) => c.end().catch(() => {})));
  }
}

async function main() {
  const seed = await connect();
  let toutPropre = true;
  try {
    for (let run = 1; run <= RUNS; run++) {
      if (!(await runOnce(run, seed))) toutPropre = false;
    }
  } finally {
    await purgeAll(seed);
    await seed.end();
  }
  if (!toutPropre) {
    console.error("ÉCHEC : un second paiement sans montant, arrivé pendant l'application du premier, n'a pas été classé double_payment.");
    process.exit(1);
  }
  console.log(`${RUNS} runs consécutifs propres — la décision se prend sur le statut relu SOUS le verrou.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
