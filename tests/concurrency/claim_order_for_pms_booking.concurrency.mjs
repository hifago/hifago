// Lobby avant paiement (migration 20260930221837) — test de concurrence RÉELLE de
// claim_order_for_pms_booking : N appels simultanés sur LA MÊME commande, un seul doit obtenir le
// claim. C'est la seule barrière entre deux POST /api/pms/reserve-nights simultanés (deux onglets,
// un rejeu) et deux bookings chez un vrai partenaire — LobbyPMS n'a ni clé d'idempotence ni
// recherche de booking, donc un doublon n'y est jamais détectable après coup.
//
// Pourquoi pas pgTAP : chaque fichier pgTAP tourne dans UNE transaction annulée — structurellement
// incapable de faire se croiser deux verrous `for update` (hifago/CLAUDE.md §6.3). Squelette repris
// de consume_partner_invitation.concurrency.mjs (barrière de synchronisation, connexions
// indépendantes, ≥ 5 runs).
//
// ⚠️ NETTOYAGE AVANT ET APRÈS (leçon du 2026-09-29) : un fichier de concurrence qui ne nettoie
// qu'avant ses runs laisse ses fixtures sur la base partagée, où elles faussent les tests pgTAP qui
// comptent en absolu. Préfixe d'identifiants dédié : 64000000-.
//
// Contre la stack Supabase locale uniquement (127.0.0.1:54322) — jamais un projet cloud partagé.
import pg from "pg";

const { Client } = pg;

// Surchargeable par PGURL : ce test ÉCRIT. Le pointer ailleurs que sur la stack locale serait une
// faute (hifago/CLAUDE.md §6.4).
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const N = 20; // appels concurrents visant la même commande
const RUNS = 5; // barre d'acceptation : ≥5 runs consécutifs propres

const PARTNER_ID = "64000000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "64000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "64000000-0000-4000-8000-000000000010";
const BUYER_ID = "64000000-0000-4000-8000-000000000020";
const ORDER_ID = "64000000-0000-4000-8000-000000000030";
const LINE_ID = "64000000-0000-4000-8000-000000000040";

async function cleanup(client) {
  // Ordre imposé par les FK : lignes → commande → produit → établissement → partenaire → compte.
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
  await client.query("insert into partners (id, display_name) values ($1, 'Claim Concurrency Partner')", [PARTNER_ID]);
  await client.query(
    `insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token)
     values ($1, $2, jsonb_build_object('es', 'Claim Concurrency'), true, 'claim-concurrency-token')`,
    [ESTABLISHMENT_ID, PARTNER_ID]
  );
  await client.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id)
     values ($1, $2, $3, 'lodging', jsonb_build_object('es', 'Claim Concurrency PMS'), 100000, true,
             'claim-concurrency-pms', 64001)`,
    [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID]
  );
  await client.query("insert into auth.users (id, email) values ($1, 'claim-concurrency@test.local')", [BUYER_ID]);
  await client.query(
    "insert into orders (id, account_id, holder_name, holder_email) values ($1, $2, 'Claim Concurrency', 'claim-concurrency@test.local')",
    [ORDER_ID, BUYER_ID]
  );
  await client.query(
    `insert into order_lines (
       id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
       price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
       acompte_cop, referrer_commission_cop, app_commission_cop
     ) values ($1, $2, $3, $4, '2029-04-01', '2029-04-03', 1, 'reserved', 'Claim Concurrency',
               100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000)`,
    [LINE_ID, ORDER_ID, BUYER_ID, PRODUCT_ID]
  );
}

async function runOnce(run, seedClient) {
  await seed(seedClient);

  const clients = await Promise.all(
    Array.from({ length: N }, async () => {
      const client = new Client({ connectionString: CONNECTION_STRING });
      await client.connect();
      // Le vrai rôle de l'appelant (la route tourne en service_role) : la RPC n'est exécutable par
      // personne d'autre (service_role_only_functions.test.sql).
      await client.query("set role service_role");
      return client;
    })
  );

  // Barrière : chaque worker signale qu'il est prêt, puis attend un signal commun qui ne part que
  // lorsque TOUS sont prêts — chevauchement réel des `for update` sur la commande.
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
      const res = await client.query("select public.claim_order_for_pms_booking($1) as result", [ORDER_ID]);
      return res.rows[0].result;
    })
  );
  await Promise.all(clients.map((client) => client.end()));

  const successes = results.filter((r) => r.ok === true && r.claimed_at !== null);
  const inProgress = results.filter((r) => r.ok === false && r.reason === "claim_in_progress");
  const others = results.length - successes.length - inProgress.length;
  const { rows } = await seedClient.query("select pms_reserve_claimed_at from orders where id = $1", [ORDER_ID]);
  const claimSet = rows[0]?.pms_reserve_claimed_at !== null;

  console.log(
    `Run ${run}: claims obtenus ${successes.length} / ${N} (doit être exactement 1), claim_in_progress ${inProgress.length}, autres ${others}, claim posé en base ${claimSet}`
  );
  return successes.length === 1 && inProgress.length === N - 1 && others === 0 && claimSet;
}

async function main() {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  let allClean = true;
  try {
    for (let run = 1; run <= RUNS; run++) {
      if (!(await runOnce(run, seedClient))) allClean = false;
    }
  } finally {
    await cleanup(seedClient);
    await seedClient.end();
  }

  if (!allClean) {
    console.error("ÉCHEC : au moins un run a laissé passer plus d'un claim (ou aucun).");
    process.exit(1);
  }
  console.log(`${RUNS} runs consécutifs propres — exactement 1 claim par commande à chaque fois.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
