// Durcissement 20260920120000 puis Lot B 20260921100000 — apply_payment_webhook contre l'expiration
// (expire_payment_order, appelée par le job de réconciliation ; l'ancien cron expire_stale_payment_
// orders a été supprimé le 2026-09-21) sous concurrence RÉELLE (incident HFG-000013).
//
// Ce que ce test prouve, et que pgTAP ne peut structurellement pas prouver (CLAUDE.md §6.3) :
//   1. ORDRE DES VERROUS — la RPC verrouille désormais `orders` PUIS `payments`, comme
//      l'expiration (`orders` d'abord, toujours — règle 8 de .claude/rules/supabase.md). Avant, elle
//      verrouillait `payments` puis écrivait `orders` : deux ordres inverses, interblocage possible
//      (4 `40P01` sur 12 reproduits par mutation le 2026-09-20). Ici : N webhooks `approved` et M
//      « expireurs » (chacun tente expire_payment_order sur TOUTES les commandes périmées) relâchés
//      par barrière — aucun `40P01` toléré, aucune requête pendue.
//   2. COHÉRENCE FINALE — quel que soit le gagnant de chaque course, jamais une commande `paid`
//      avec des lignes `expired` (la commande fantôme), jamais un paiement `approved` sur des lignes
//      `expired`. Si l'expiration gagne, le webhook doit répondre `paid_after_expiry` et laisser une
//      entrée `refund_required` ; si le webhook gagne, expire_payment_order doit refuser
//      (`not_candidate` : elle relit la commande après le verrou et la voit `paid`).
//
// Même squelette que create_order.concurrency.mjs : driver `pg` direct, barrière de
// synchronisation, jamais pgTAP ni Promise.all naïf, jamais de sleep pour synchroniser.
// Contre la stack Supabase locale uniquement (127.0.0.1:54322) — jamais un projet cloud partagé.
import pg from "pg";

const { Client } = pg;

const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5; // barre d'acceptation : ≥5 runs consécutifs propres
const ORDERS = 12; // commandes périmées, une par webhook concurrent
const EXPIRERS = 4; // « expireurs » concurrents (chacun parcourt toutes les commandes périmées)

// Préfixe UUID dédié à ce fichier (62000000-…) — ne collisionne ni avec seed.sql (a0000000-…/
// b0000000-…), ni avec les autres tests de concurrence (10000000-…/20000000-…/60000000-…/99990000-…).
const P = "62000000-0000-4000-8000-";
const PARTNER_ID = `${P}000000000001`;
const ESTABLISHMENT_ID = `${P}000000000002`;
const PRODUCT_ID = `${P}000000000003`;
const BUYER_ID = `${P}000000000004`;
const orderId = (i) => `${P}${String(100 + i).padStart(12, "0")}`;
const lineId = (i) => `${P}${String(200 + i).padStart(12, "0")}`;
const paymentId = (i) => `${P}${String(300 + i).padStart(12, "0")}`;

function makeBarrier(count) {
  let readyCount = 0;
  let resolveGo;
  const go = new Promise((resolve) => {
    resolveGo = resolve;
  });
  function markReady() {
    if (++readyCount === count) resolveGo();
  }
  return { go, markReady };
}

async function resetAll(seed) {
  // Enfants avant parents (FK). Les entrées de réconciliation et e-mails portent une FK/related_id
  // vers les paiements/commandes de ce fichier.
  // Les e-mails du trigger d'entrée (client « pago recibido », admin) portent related_id = id de
  // l'ENTRÉE, pas une commande de ce fichier : à purger AVANT les entrées, sinon ils restent
  // `pending` et faussent claim_notification_email_batch.concurrency.mjs (rouge en CI le 2026-09-22).
  await seed.query(`delete from notification_emails where related_id in
    (select id from payment_reconciliation_entries where payment_id::text like '${P}%')`);
  await seed.query(`delete from payment_reconciliation_entries where payment_id::text like '${P}%'`);
  await seed.query(`delete from notification_emails where related_id::text like '${P}%'`);
  await seed.query(`delete from payments where order_id::text like '${P}%'`);
  await seed.query(`delete from order_lines where order_id::text like '${P}%'`);
  await seed.query(`delete from orders where id::text like '${P}%'`);
  await seed.query("delete from products where id = $1", [PRODUCT_ID]);
  await seed.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await seed.query("delete from partners where id = $1", [PARTNER_ID]);
  await seed.query("delete from partner_accounts where id = $1", [BUYER_ID]);
  await seed.query("delete from auth.users where id = $1", [BUYER_ID]);

  await seed.query("insert into partners (id, display_name) values ($1, $2)", [
    PARTNER_ID,
    "Webhook vs Expiry Concurrency Partner",
  ]);
  await seed.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID,
    PARTNER_ID,
    JSON.stringify({ es: "Webhook vs Expiry Establishment" }),
  ]);
  await seed.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values ($1, $2, $3, 'activity', jsonb_build_object('es', 'Webhook vs expiry slot'), 100000, true, $4)`,
    [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID, "webhook-vs-expiry-slot"]
  );
  await seed.query("insert into auth.users (id, email) values ($1, $2)", [
    BUYER_ID,
    "webhook-vs-expiry@hifago.test",
  ]);

  // ORDERS commandes périmées (31 min), chacune avec une ligne `reserved` à acompte dû et un
  // paiement `pending` — exactement l'état d'une commande que le cron va détruire au prochain tick
  // et dont Mercado Pago vient d'approuver le paiement.
  for (let i = 0; i < ORDERS; i++) {
    await seed.query(
      `insert into orders (id, account_id, holder_name, holder_email, payment_status, created_at)
       values ($1, $2, $3, $4, 'pending', now() - interval '31 minutes')`,
      [orderId(i), BUYER_ID, `Holder ${i}`, `holder-${i}@hifago.test`]
    );
    await seed.query(
      `insert into order_lines (
         id, order_id, account_id, product_id, date, qty, status, holder_name,
         price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
         acompte_cop, referrer_commission_cop, app_commission_cop
       ) values ($1, $2, $3, $4, '2028-11-01', 1, 'reserved', $5,
                 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000)`,
      [lineId(i), orderId(i), BUYER_ID, PRODUCT_ID, `Holder ${i}`]
    );
    await seed.query(
      "insert into payments (id, order_id, status, amount_cop) values ($1, $2, 'pending', 17000)",
      [paymentId(i), orderId(i)]
    );
  }
}

async function connectWorker(role) {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  // Le webhook est granté à service_role seulement : le VRAI rôle Postgres, pas un claim JWT.
  if (role) await client.query(`set role ${role}`);
  return client;
}

async function runOnce(run) {
  const seed = new Client({ connectionString: CONNECTION_STRING });
  await seed.connect();
  await resetAll(seed);

  const webhooks = await Promise.all(Array.from({ length: ORDERS }, () => connectWorker("service_role")));
  const expirers = await Promise.all(Array.from({ length: EXPIRERS }, () => connectWorker(null)));
  const total = ORDERS + EXPIRERS;
  const { go, markReady } = makeBarrier(total);

  const timeoutMs = 15000;
  const withTimeout = (promise, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`${label} : timeout après ${timeoutMs}ms (interblocage suspecté)`)),
          timeoutMs
        )
      ),
    ]);

  const settled = await withTimeout(
    Promise.allSettled([
      ...webhooks.map(async (client, i) => {
        markReady();
        await go;
        // Comme la route depuis 20261002021045 : apply_payment_webhook_checked, montant normalisé.
        const res = await client.query(
          "select apply_payment_webhook_checked($1, $2::uuid, 'approved', 17000, $3::jsonb) as result",
          [`mp-conc-${run}-${i}`, paymentId(i), JSON.stringify({ mp_payment_id: `mp-conc-${run}-${i}`, transaction_amount: 17000, currency_id: "COP" })]
        );
        return { kind: "webhook", i, result: res.rows[0].result };
      }),
      ...expirers.map(async (client, j) => {
        markReady();
        await go;
        // Chaque expireur passe sur toutes les commandes, dans un ordre différent selon j : c'est
        // ce que feraient deux runs du job qui se chevauchent (pg_net n'interrompt pas l'Edge Function).
        const order = Array.from({ length: ORDERS }, (_, i) => (i + j * 3) % ORDERS);
        const results = [];
        for (const i of order) {
          const res = await client.query("select expire_payment_order($1::uuid, now()) as result", [orderId(i)]);
          results.push(res.rows[0].result);
        }
        return { kind: "expire", j, results };
      }),
    ]),
    `run ${run}`
  );

  const rejected = settled.filter((s) => s.status === "rejected");
  const deadlocks = rejected.filter((r) => String(r.reason?.code) === "40P01" || /deadlock/i.test(String(r.reason?.message)));
  const webhookResults = settled
    .filter((s) => s.status === "fulfilled" && s.value.kind === "webhook")
    .map((s) => s.value);

  // État final, commande par commande.
  const { rows: state } = await seed.query(
    `select o.id as order_id, o.payment_status, ol.status as line_status, p.status as payment_status_p,
            (select count(*)::int from payment_reconciliation_entries e
              where e.payment_id = p.id and e.kind = 'refund_required') as refund_entries
       from orders o
       join order_lines ol on ol.order_id = o.id
       join payments p on p.order_id = o.id
      where o.id::text like '${P}%'
      order by o.id`
  );

  let webhookWon = 0;
  let expiryWon = 0;
  const inconsistencies = [];
  for (const row of state) {
    const paidAndReserved =
      row.payment_status === "paid" && row.line_status === "reserved" && row.payment_status_p === "approved" && row.refund_entries === 0;
    const expiredAndFlagged =
      row.payment_status === "unpaid" && row.line_status === "expired" && row.payment_status_p === "cancelled" && row.refund_entries === 1;
    if (paidAndReserved) webhookWon++;
    else if (expiredAndFlagged) expiryWon++;
    else inconsistencies.push(row);
  }
  // Le résultat renvoyé au webhook doit correspondre à l'état : `paid_after_expiry` ssi le cron a
  // gagné cette commande.
  const resultMismatches = webhookResults.filter((w) => {
    const row = state.find((r) => r.order_id === orderId(w.i));
    const lost = row?.line_status === "expired";
    return lost ? w.result?.reason !== "paid_after_expiry" : w.result?.reason !== undefined;
  });

  console.log(
    `  run ${run}: webhook gagne ${webhookWon}, expiration gagne ${expiryWon}, incohérences ${inconsistencies.length}, ` +
      `résultats discordants ${resultMismatches.length}, rejets ${rejected.length} (deadlock ${deadlocks.length})`
  );
  for (const r of rejected) console.error(`    rejet : ${r.reason?.code ?? ""} ${r.reason?.message ?? r.reason}`);
  for (const row of inconsistencies) console.error(`    INCOHÉRENCE : ${JSON.stringify(row)}`);
  for (const w of resultMismatches) console.error(`    résultat discordant : ${JSON.stringify(w)}`);

  await Promise.all([...webhooks, ...expirers].map((c) => c.end()));
  await resetAll(seed);
  await seed.end();

  return rejected.length === 0 && inconsistencies.length === 0 && resultMismatches.length === 0 && webhookWon + expiryWon === ORDERS;
}

async function main() {
  console.log(`\n=== apply_payment_webhook_checked vs expire_payment_order — ${RUNS} runs consécutifs requis ===`);
  for (let run = 1; run <= RUNS; run++) {
    let clean;
    try {
      clean = await runOnce(run);
    } catch (err) {
      console.error(`  run ${run} a levé une erreur : ${err.message}`);
      clean = false;
    }
    if (!clean) {
      console.error(`\nÉCHEC — run ${run}/${RUNS}. Zéro tolérance à un échec isolé.`);
      process.exit(1);
    }
  }
  console.log(`\n${RUNS} runs consécutifs propres — aucun interblocage, aucune commande fantôme (expire_payment_order).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
