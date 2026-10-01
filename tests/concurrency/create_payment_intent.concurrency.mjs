// Lobby avant paiement (migration 20260930221837) — calibrage de concurrence de
// create_payment_intent : N clics « payer » simultanés sur LA MÊME commande ne créent qu'UN seul
// paiement `pending`, et tous les appels reçoivent le même payment_id (`reused` pour les autres).
//
// Ce n'est pas une RPC critique au sens de CLAUDE.md §4.1 (aucune capacité décrémentée) : l'unicité
// tenait déjà au `for update` sur orders, et l'index unique partiel
// payments_one_pending_per_order la rend structurelle. D'où UN run de calibrage, pas la barre des
// 5 runs — ce fichier vérifie surtout que la réutilisation ne dégénère pas sous concurrence (aucun
// 23505 remonté au client, aucun second pending).
//
// ⚠️ Nettoyage AVANT et APRÈS (leçon du 2026-09-29). Préfixe d'identifiants dédié : 65000000-.
// Contre la stack Supabase locale uniquement (127.0.0.1:54322).
import pg from "pg";

const { Client } = pg;

const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const N = 20;

const PARTNER_ID = "65000000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "65000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "65000000-0000-4000-8000-000000000010";
const BUYER_ID = "65000000-0000-4000-8000-000000000020";
const ORDER_ID = "65000000-0000-4000-8000-000000000030";
const LINE_ID = "65000000-0000-4000-8000-000000000040";

async function cleanup(client) {
  await client.query("delete from payments where order_id = $1", [ORDER_ID]);
  await client.query("delete from order_lines where order_id = $1", [ORDER_ID]);
  await client.query("delete from orders where id = $1", [ORDER_ID]);
  await client.query("delete from products where id = $1", [PRODUCT_ID]);
  await client.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await client.query("delete from partners where id = $1", [PARTNER_ID]);
  await client.query("delete from partner_accounts where id = $1", [BUYER_ID]);
  await client.query("delete from auth.users where id = $1", [BUYER_ID]);
}

async function seed(client) {
  await cleanup(client);
  await client.query("insert into partners (id, display_name) values ($1, 'Intent Concurrency Partner')", [PARTNER_ID]);
  await client.query(
    "insert into establishments (id, partner_id, name) values ($1, $2, jsonb_build_object('es', 'Intent Concurrency'))",
    [ESTABLISHMENT_ID, PARTNER_ID]
  );
  await client.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values ($1, $2, $3, 'activity', jsonb_build_object('es', 'Intent Concurrency'), 100000, true, 'intent-concurrency')`,
    [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID]
  );
  await client.query("insert into auth.users (id, email) values ($1, 'intent-concurrency@test.local')", [BUYER_ID]);
  await client.query(
    "insert into orders (id, account_id, holder_name, holder_email) values ($1, $2, 'Intent Concurrency', 'intent-concurrency@test.local')",
    [ORDER_ID, BUYER_ID]
  );
  await client.query(
    `insert into order_lines (
       id, order_id, account_id, product_id, date, qty, status, holder_name,
       price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
       acompte_cop, referrer_commission_cop, app_commission_cop
     ) values ($1, $2, $3, $4, '2029-04-01', 1, 'reserved', 'Intent Concurrency',
               100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000)`,
    [LINE_ID, ORDER_ID, BUYER_ID, PRODUCT_ID]
  );
}

async function main() {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  let clean = false;
  try {
    await seed(seedClient);

    const clients = await Promise.all(
      Array.from({ length: N }, async () => {
        const client = new Client({ connectionString: CONNECTION_STRING });
        await client.connect();
        // Le vrai appelant : le titulaire, sous le rôle authenticated (OrderResult appelle la RPC
        // depuis le navigateur).
        await client.query("set role authenticated");
        await client.query("select set_config('request.jwt.claims', $1, false)", [
          JSON.stringify({ sub: BUYER_ID, role: "authenticated" }),
        ]);
        return client;
      })
    );

    let readyCount = 0;
    let resolveGo;
    const go = new Promise((resolve) => {
      resolveGo = resolve;
    });
    const markReady = () => {
      if (++readyCount === N) resolveGo();
    };

    const results = await Promise.all(
      clients.map(async (client) => {
        markReady();
        await go;
        try {
          const res = await client.query("select public.create_payment_intent($1) as result", [ORDER_ID]);
          return res.rows[0].result;
        } catch (error) {
          return { ok: false, reason: `erreur ${error.code ?? error.message}` };
        }
      })
    );
    await Promise.all(clients.map((client) => client.end()));

    const oks = results.filter((r) => r.ok === true);
    const reused = oks.filter((r) => r.reused === true);
    const paymentIds = new Set(oks.map((r) => r.payment_id));
    const { rows } = await seedClient.query(
      "select count(*)::int as n from payments where order_id = $1 and status = 'pending'",
      [ORDER_ID]
    );
    console.log(
      `Calibrage : ${oks.length} / ${N} ok (dont ${reused.length} reused), payment_id distincts ${paymentIds.size}, pending en base ${rows[0].n}`
    );
    clean = oks.length === N && reused.length === N - 1 && paymentIds.size === 1 && rows[0].n === 1;
  } finally {
    await cleanup(seedClient);
    await seedClient.end();
  }

  if (!clean) {
    console.error("ÉCHEC : la réutilisation du paiement pending ne tient pas sous concurrence.");
    process.exit(1);
  }
  console.log("create_payment_intent : un seul pending, un seul payment_id, sous concurrence réelle.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
