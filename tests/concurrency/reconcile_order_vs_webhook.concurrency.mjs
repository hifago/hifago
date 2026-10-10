// Spec 39 (Lot B, 20260921100000) — deux courses réelles autour de la réconciliation Mercado Pago.
//
//   1. LE MÊME PAIEMENT approuvé au même instant par le job (`reconcile_order` avec un `approved`
//      renvoyé par /v1/payments/search) et par le webhook (`apply_payment_webhook_checked`, comme
//      la route depuis 20261002021045) : exactement UNE
//      application (commande `paid`, UN e-mail de confirmation, zéro entrée refund_required), zéro
//      `40P01`. Les deux chemins convergent sur apply_payment_webhook, qui verrouille `orders` puis
//      `payments` — le second voit `approved` → `already_applied`.
//   2. `expire_payment_order` contre `modify_order_line` sur les MÊMES lignes : l'ancienne RPC PMS
//      (modèle de l'expiration) verrouillait les lignes au fil d'un curseur entrelacé d'UPDATE de
//      capacité, ce que modify_order_line (ligne puis product_availability) pouvait interbloquer.
//      Depuis le Lot B les verrous sont posés en bloc AVANT le premier UPDATE (orders → lignes →
//      product_availability → provider_resource_calendar → product_slot_availability). Preuve
//      attendue : zéro `40P01`, et booked = nombre de lignes `reserved` sur chaque date à la fin.
//
// Même squelette que create_order.concurrency.mjs : driver `pg`, barrière, jamais pgTAP ni sleep.
// Contre la stack locale uniquement.
import pg from "pg";

const { Client } = pg;
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5;
const ORDERS = 12;
const EXPIRERS = 4;

const P = "63000000-0000-4000-8000-";
const PARTNER_ID = `${P}000000000001`;
const ESTABLISHMENT_ID = `${P}000000000002`;
const PRODUCT_ID = `${P}000000000003`;
const BUYER_ID = `${P}000000000004`;
const ADMIN_ID = `${P}000000000005`;
const DATE_A = "2028-12-01";
const DATE_B = "2028-12-15";
const orderId = (i) => `${P}${String(100 + i).padStart(12, "0")}`;
const lineId = (i) => `${P}${String(200 + i).padStart(12, "0")}`;
const paymentId = (i) => `${P}${String(300 + i).padStart(12, "0")}`;

function makeBarrier(count) {
  let readyCount = 0;
  let resolveGo;
  const go = new Promise((resolve) => (resolveGo = resolve));
  return { go, markReady: () => { if (++readyCount === count) resolveGo(); } };
}

const withTimeout = (promise, label, ms = 20000) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} : timeout après ${ms}ms (interblocage suspecté)`)), ms)
    ),
  ]);

async function purgeAll(seed) {
  await seed.query(`delete from payment_refunds where payment_id::text like '${P}%'`);
  await seed.query(`delete from notification_emails where related_id in
    (select id from payment_reconciliation_entries where payment_id::text like '${P}%')`);
  await seed.query(`delete from payment_reconciliation_entries where payment_id::text like '${P}%'`);
  await seed.query(`delete from notification_emails where related_id::text like '${P}%' or recipient_account_id in ($1, $2)`, [BUYER_ID, ADMIN_ID]);
  await seed.query(`delete from payments where order_id::text like '${P}%'`);
  await seed.query(`delete from ledger_entries where order_line_id in (select id from order_lines where order_id::text like '${P}%')`);
  await seed.query(`delete from audit_log where actor_id = $1`, [ADMIN_ID]).catch(() => {});
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

// Purge PUIS fixtures. Un admin de fixture laissé en base recevrait les e-mails admin du dev et
// fausserait tout test qui compte les admins : la fin de chaque run purge SANS ré-ensemencer.
async function resetAll(seed, { age, paymentStatus }) {
  await purgeAll(seed);
  await seed.query("insert into partners (id, display_name) values ($1, 'Reconcile Concurrency Partner')", [PARTNER_ID]);
  await seed.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID, PARTNER_ID, JSON.stringify({ es: "Reconcile Concurrency Establishment" }),
  ]);
  await seed.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values ($1, $2, $3, 'activity', jsonb_build_object('es', 'Reconcile concurrency slot'), 100000, true, 'reconcile-concurrency')`,
    [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID]
  );
  await seed.query(
    `insert into product_availability (product_id, date, capacity, booked) values ($1, $2, 100, $3), ($1, $4, 100, 0)`,
    [PRODUCT_ID, DATE_A, ORDERS, DATE_B]
  );
  await seed.query("insert into auth.users (id, email) values ($1, $2), ($3, $4)", [
    BUYER_ID, "reconcile-concurrency-buyer@hifago.test", ADMIN_ID, "reconcile-concurrency-admin@hifago.test",
  ]);
  await seed.query(
    "insert into partner_capabilities (account_id, role, source, status) values ($1, 'admin', 'migration', 'active')",
    [ADMIN_ID]
  );
  for (let i = 0; i < ORDERS; i++) {
    await seed.query(
      `insert into orders (id, account_id, holder_name, holder_email, payment_status, created_at)
       values ($1, $2, $3, $4, $5, now() - $6::interval)`,
      [orderId(i), BUYER_ID, `Holder ${i}`, `holder-${i}@hifago.test`, paymentStatus, age]
    );
    await seed.query(
      `insert into order_lines (id, order_id, account_id, product_id, date, qty, status, holder_name,
         price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop)
       values ($1, $2, $3, $4, $5, 1, 'reserved', $6, 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000)`,
      [lineId(i), orderId(i), BUYER_ID, PRODUCT_ID, DATE_A, `Holder ${i}`]
    );
    await seed.query(
      "insert into payments (id, order_id, status, amount_cop, created_at) values ($1, $2, 'pending', 17000, now() - $3::interval)",
      [paymentId(i), orderId(i), age]
    );
  }
}

async function connect(role, claims) {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  if (role) await client.query(`set role ${role}`);
  if (claims) await client.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
  return client;
}

const isDeadlock = (r) => String(r.reason?.code) === "40P01" || /deadlock|interblocage|timeout/i.test(String(r.reason?.message));

// --- Scénario 1 : même paiement, job + webhook -----------------------------------------------
async function runScenario1(run) {
  const seed = await connect();
  await resetAll(seed, { age: "5 minutes", paymentStatus: "pending" });
  const webhooks = await Promise.all(Array.from({ length: ORDERS }, () => connect("service_role")));
  const jobs = await Promise.all(Array.from({ length: ORDERS }, () => connect("service_role")));
  const { go, markReady } = makeBarrier(ORDERS * 2);

  const settled = await withTimeout(
    Promise.allSettled([
      ...webhooks.map(async (c, i) => {
        markReady(); await go;
        // Comme la route depuis 20261002021045 : montant normalisé, événement aplati.
        const res = await c.query("select apply_payment_webhook_checked($1, $2::uuid, 'approved', 17000, $3::jsonb) as r", [
          `mp-rc-${run}-${i}`, paymentId(i),
          JSON.stringify({ source: "webhook", mp_payment_id: `mp-rc-${run}-${i}`, status: "approved", transaction_amount: 17000, currency_id: "COP" }),
        ]);
        return { kind: "webhook", i, r: res.rows[0].r };
      }),
      ...jobs.map(async (c, i) => {
        markReady(); await go;
        const item = {
          payment_id: paymentId(i), mp_payment_id: `mp-rc-${run}-${i}`, status: "approved", status_detail: "accredited",
          transaction_amount: 17000, date_created: "2026-09-21T10:00:00Z", date_approved: "2026-09-21T10:00:05Z", collector_id: "coll-1",
        };
        const res = await c.query("select reconcile_order($1::uuid, $2::jsonb, now(), 'coll-1') as r", [
          orderId(i), JSON.stringify([item]),
        ]);
        return { kind: "job", i, r: res.rows[0].r };
      }),
    ]),
    `scénario 1 run ${run}`
  );
  const rejected = settled.filter((s) => s.status === "rejected");
  const { rows: state } = await seed.query(
    `select o.id, o.payment_status, p.status as pay_status, p.mp_payment_id,
            (select count(*)::int from notification_emails ne where ne.event_type = 'client_order_confirmed' and ne.related_id = o.id) as emails,
            (select count(*)::int from payment_reconciliation_entries e where e.payment_id = p.id) as entries
       from orders o join payments p on p.order_id = o.id where o.id::text like '${P}%' order by o.id`
  );
  const bad = state.filter((r) => r.payment_status !== "paid" || r.pay_status !== "approved" || r.emails !== 1 || r.entries !== 0);
  console.log(`  [scénario 1] run ${run}: paid ${state.filter((r) => r.payment_status === "paid").length}/${ORDERS}, e-mails ${state.reduce((a, r) => a + r.emails, 0)} (attendu ${ORDERS}), entrées ${state.reduce((a, r) => a + r.entries, 0)} (attendu 0), rejets ${rejected.length} (deadlock ${rejected.filter(isDeadlock).length})`);
  for (const r of rejected) console.error(`    rejet : ${r.reason?.code ?? ""} ${r.reason?.message ?? r.reason}`);
  for (const r of bad) console.error(`    INCOHÉRENCE : ${JSON.stringify(r)}`);
  await Promise.all([...webhooks, ...jobs].map((c) => c.end()));
  await purgeAll(seed);
  await seed.end();
  return rejected.length === 0 && bad.length === 0;
}

// --- Scénario 2 : expiration contre modification ------------------------------------------------
async function runScenario2(run) {
  const seed = await connect();
  await resetAll(seed, { age: "40 minutes", paymentStatus: "unpaid" });
  // Les lignes n'ont pas de paiement pending pour ce scénario (une commande impayée sans intent,
  // comme Order G) : on retire les payments pour rester sur le chemin « rien à demander à MP ».
  await seed.query(`delete from payments where order_id::text like '${P}%'`);
  const expirers = await Promise.all(Array.from({ length: EXPIRERS }, () => connect("service_role")));
  const modifiers = await Promise.all(
    Array.from({ length: ORDERS }, () => connect(null, { sub: ADMIN_ID, role: "authenticated" }))
  );
  const { go, markReady } = makeBarrier(EXPIRERS + ORDERS);

  const settled = await withTimeout(
    Promise.allSettled([
      ...expirers.map(async (c, j) => {
        markReady(); await go;
        const order = Array.from({ length: ORDERS }, (_, i) => (i + j * 3) % ORDERS);
        const results = [];
        for (const i of order) {
          const res = await c.query("select expire_payment_order($1::uuid, now()) as r", [orderId(i)]);
          results.push(res.rows[0].r);
        }
        return { kind: "expire", j, results };
      }),
      ...modifiers.map(async (c, i) => {
        markReady(); await go;
        try {
          await c.query("select modify_order_line($1::uuid, $2::date, 1, 'concurrence expiration')", [lineId(i), DATE_B]);
          return { kind: "modify", i, ok: true };
        } catch (err) {
          // Perdre la course est légitime (ligne déjà expirée) ; un interblocage ne l'est pas.
          if (isDeadlock({ reason: err })) throw err;
          return { kind: "modify", i, ok: false, message: err.message };
        }
      }),
    ]),
    `scénario 2 run ${run}`
  );
  const rejected = settled.filter((s) => s.status === "rejected");
  const modifies = settled.filter((s) => s.status === "fulfilled" && s.value.kind === "modify").map((s) => s.value);
  const { rows: pa } = await seed.query(
    `select pa.date::text as date, pa.booked,
            (select count(*)::int from order_lines ol where ol.product_id = pa.product_id and ol.date = pa.date and ol.status = 'reserved' and ol.order_id::text like '${P}%') as reserved
       from product_availability pa where pa.product_id = $1 order by pa.date`,
    [PRODUCT_ID]
  );
  const { rows: [{ ghosts }] } = await seed.query(
    `select count(*)::int as ghosts from orders o where o.id::text like '${P}%' and o.payment_status = 'paid'`
  );
  const inconsistent = pa.filter((r) => r.booked !== r.reserved);
  console.log(`  [scénario 2] run ${run}: modifications réussies ${modifies.filter((m) => m.ok).length}/${ORDERS}, booked/reserved ${pa.map((r) => `${r.date.slice(5)}=${r.booked}/${r.reserved}`).join(" ")}, rejets ${rejected.length} (deadlock ${rejected.filter(isDeadlock).length}), fantômes ${ghosts}`);
  for (const r of rejected) console.error(`    rejet : ${r.reason?.code ?? ""} ${r.reason?.message ?? r.reason}`);
  for (const r of inconsistent) console.error(`    INCOHÉRENCE booked ≠ reserved : ${JSON.stringify(r)}`);
  await Promise.all([...expirers, ...modifiers].map((c) => c.end()));
  await purgeAll(seed);
  await seed.end();
  return rejected.length === 0 && inconsistent.length === 0 && ghosts === 0;
}

async function runScenario(name, fn) {
  console.log(`\n=== ${name} — ${RUNS} runs consécutifs requis ===`);
  for (let run = 1; run <= RUNS; run++) {
    let clean;
    try { clean = await fn(run); } catch (err) { console.error(`  run ${run} a levé : ${err.message}`); clean = false; }
    if (!clean) { console.error(`\nÉCHEC — ${name}, run ${run}/${RUNS}.`); return false; }
  }
  console.log(`  ${RUNS} runs consécutifs propres pour "${name}".`);
  return true;
}

async function runAll() {
  if (!(await runScenario("Scénario 1 — même paiement approuvé par le job ET le webhook", runScenario1))) return 1;
  if (!(await runScenario("Scénario 2 — expire_payment_order contre modify_order_line", runScenario2))) return 1;
  console.log("\nLes deux scénarios ont tenu leurs 5 runs — réconciliation validée sous concurrence réelle.");
  return 0;
}

async function purgeAtEnd() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  try {
    await purgeAll(client);
  } finally {
    await client.end();
  }
}

// Les codes de sortie sont RENDUS par runAll, jamais `process.exit` en cours de route : un exit
// dans la boucle sauterait le `finally`, donc la purge finale.
async function main() {
  let code = 1;
  try {
    code = await runAll();
  } finally {
    await purgeAtEnd();
  }
  process.exit(code);
}

main().catch((err) => { console.error(err); process.exit(1); });
