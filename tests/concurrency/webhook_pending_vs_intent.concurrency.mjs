// Webhook `pending` contre nouvel intent (migration 20261002185102) — un seul `pending` par
// commande tient SOUS CONCURRENCE, sans 23505 ni interblocage.
//
// Le chemin : l'ancien intent P1 est `rejected` ; le client relance dans l'ancienne session Checkout
// Pro (Mercado Pago notifie `pending` sur P1) pendant qu'il demande un nouvel intent
// (create_payment_intent). Les deux verrouillent `orders` d'abord : ils sont sérialisés. Si
// l'intent passe le premier, il crée P2 `pending` ; le webhook doit alors répondre
// `other_intent_pending` sans rétrograder P1 — sans cette garde, l'index unique
// payments_one_pending_per_order lève 23505 (webhook en échec, retenté sans fin). Si le webhook passe
// le premier, P1 redevient `pending` et l'intent le réutilise.
//
// Par run : (1) une barrière libère d'un coup un webhook et un intent sur ORDERS commandes ;
// (2) un scénario DÉTERMINISTE force l'ordre dangereux : un coordinateur tient la ligne de la
// commande, l'intent part (attente constatée), puis le webhook (attente constatée), puis le
// coordinateur valide — l'intent est servi le premier, le webhook DOIT répondre
// other_intent_pending. Attendu à chaque run : 0 × 23505, 0 × 40P01, exactement 1 pending par
// commande.
//
// ⚠️ Nettoyage AVANT et APRÈS chaque run. Préfixe d'identifiants dédié : 68000000-. Stack locale.
import pg from "pg";

const { Client } = pg;
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5;
const ORDERS = 8;
const P = "68000000-0000-4000-8000-";
const id = (n) => `${P}${String(n).padStart(12, "0")}`;
const PARTNER_ID = id(1);
const ESTABLISHMENT_ID = id(2);
const PRODUCT_ID = id(3);
const BUYER_ID = id(4);
// Commande i : order 1000+i, ligne 2000+i, P1 3000+i. La commande déterministe : i = ORDERS.
const orderId = (i) => id(1000 + i);
const lineId = (i) => id(2000 + i);
const p1Id = (i) => id(3000 + i);

async function connect() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  return client;
}

async function purge(seed) {
  await seed.query(`delete from payments where order_id::text like '${P}%'`);
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
  await seed.query("insert into partners (id, display_name) values ($1, 'Webhook vs Intent')", [PARTNER_ID]);
  await seed.query(
    "insert into establishments (id, partner_id, name) values ($1, $2, jsonb_build_object('es', 'Webhook vs Intent'))",
    [ESTABLISHMENT_ID, PARTNER_ID]
  );
  await seed.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values ($1, $2, $3, 'activity', jsonb_build_object('es', 'Webhook vs Intent'), 100000, true, 'webhook-vs-intent')`,
    [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID]
  );
  await seed.query("insert into auth.users (id, email) values ($1, 'webhook-vs-intent@test.local')", [BUYER_ID]);
  for (let i = 1; i <= ORDERS; i++) {
    await seed.query(
      "insert into orders (id, account_id, holder_name, holder_email, payment_status) values ($1, $2, 'WvI', 'webhook-vs-intent@test.local', 'unpaid')",
      [orderId(i), BUYER_ID]
    );
    await seed.query(
      `insert into order_lines (
         id, order_id, account_id, product_id, date, qty, status, holder_name,
         price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
         acompte_cop, referrer_commission_cop, app_commission_cop
       ) values ($1, $2, $3, $4, '2029-06-01', 1, 'reserved', 'WvI',
                 100000, 100000, 'direct', 0.1, 0, 0.1, 10000, 0, 10000)`,
      [lineId(i), orderId(i), BUYER_ID, PRODUCT_ID]
    );
    await seed.query(
      "insert into payments (id, order_id, status, amount_cop, created_at) values ($1, $2, 'rejected', 10000, now() - interval '5 minutes')",
      [p1Id(i), orderId(i)]
    );
  }
}

async function intentClient() {
  const client = await connect();
  await client.query("set role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: BUYER_ID, role: "authenticated" }),
  ]);
  return client;
}

async function webhookClient() {
  const client = await connect();
  await client.query("set role service_role");
  return client;
}

const callIntent = (client, i) =>
  client
    .query("select public.create_payment_intent($1) as r", [orderId(i)])
    .then((res) => ({ ok: true, r: res.rows[0].r }), (error) => ({ ok: false, code: error.code, message: error.message }));

const callWebhook = (client, i, run) =>
  client
    .query("select public.apply_payment_webhook_checked($1, $2, 'pending', null, '{}'::jsonb) as r", [
      `wvi-${run}-${i}`,
      p1Id(i),
    ])
    .then((res) => ({ ok: true, r: res.rows[0].r }), (error) => ({ ok: false, code: error.code, message: error.message }));

/** Attend qu'une session soit bloquée sur un verrou en exécutant `fragment` (paramètres invisibles). */
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

async function runOnce(run, seed) {
  await seedRun(seed);
  const errors = [];
  const track = (result) => {
    if (!result.ok) errors.push(result.code ?? result.message);
    return result;
  };

  // (1) Barrière : un webhook et un intent par commande, libérés ensemble.
  const free = ORDERS - 1;
  const intents = await Promise.all(Array.from({ length: free }, intentClient));
  const webhooks = await Promise.all(Array.from({ length: free }, webhookClient));
  let ready = 0;
  let release;
  const go = new Promise((resolve) => (release = resolve));
  const arm = () => {
    if (++ready === free * 2) release();
  };
  await Promise.all(
    Array.from({ length: free }, (_, k) => k + 1).flatMap((i) => [
      (async () => {
        arm();
        await go;
        track(await callIntent(intents[i - 1], i));
      })(),
      (async () => {
        arm();
        await go;
        track(await callWebhook(webhooks[i - 1], i, run));
      })(),
    ])
  );

  // (2) Déterministe : l'intent est servi AVANT le webhook.
  const d = ORDERS;
  const coordinator = await connect();
  const intentD = await intentClient();
  const webhookD = await webhookClient();
  let deterministic;
  try {
    await coordinator.query("begin");
    await coordinator.query("select 1 from orders where id = $1 for update", [orderId(d)]);
    const intentPromise = callIntent(intentD, d);
    await waitForLockWait(seed, "create_payment_intent");
    const webhookPromise = callWebhook(webhookD, d, run);
    await waitForLockWait(seed, "apply_payment_webhook_checked");
    await coordinator.query("commit");
    const [intentResult, webhookResult] = await Promise.all([intentPromise, webhookPromise]);
    track(intentResult);
    track(webhookResult);
    deterministic = { intent: intentResult, webhook: webhookResult };
  } finally {
    await Promise.all([coordinator, intentD, webhookD, ...intents, ...webhooks].map((c) => c.end().catch(() => {})));
  }

  const { rows } = await seed.query(
    `select o.id, (select count(*)::int from payments p where p.order_id = o.id and p.status = 'pending') as pendings
       from orders o where o.id::text like '${P}%' order by o.id`
  );
  const badPendings = rows.filter((row) => row.pendings !== 1);
  const n23505 = errors.filter((code) => code === "23505").length;
  const n40P01 = errors.filter((code) => code === "40P01").length;
  const deterministicOk =
    deterministic.intent.ok &&
    deterministic.intent.r?.ok === true &&
    deterministic.webhook.ok &&
    deterministic.webhook.r?.reason === "other_intent_pending";
  console.log(
    `  run ${run}: erreurs ${errors.length} (23505 : ${n23505}, 40P01 : ${n40P01}), commandes sans exactement 1 pending : ${badPendings.length}/${rows.length}, ` +
      `déterministe : webhook ${deterministic.webhook.ok ? JSON.stringify(deterministic.webhook.r) : "ERREUR " + deterministic.webhook.code}`
  );
  await purge(seed);
  return errors.length === 0 && badPendings.length === 0 && rows.length === ORDERS && deterministicOk;
}

async function main() {
  const seed = await connect();
  let clean = true;
  try {
    for (let run = 1; run <= RUNS; run++) {
      if (!(await runOnce(run, seed))) clean = false;
    }
  } finally {
    await purge(seed);
    await seed.end();
  }
  if (!clean) {
    console.error("ÉCHEC : webhook pending contre nouvel intent ne tient pas sous concurrence.");
    process.exit(1);
  }
  console.log(`${RUNS} runs consécutifs propres — un seul pending par commande, ni 23505 ni interblocage.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
