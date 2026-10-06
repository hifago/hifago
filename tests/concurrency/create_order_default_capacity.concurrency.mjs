// Gap découvert en session (produit jetski réel, migration 20260818090000_product_default_capacity)
// — products.default_capacity : create_order matérialise désormais une ligne product_availability
// (capacity=default_capacity, booked=0) AVANT son verrouillage FOR UPDATE habituel, quand aucune
// ligne n'existe encore pour la date demandée. Le risque de concurrence spécifique à CE mécanisme
// (absent du scénario 1 de create_order.concurrency.mjs, qui seed TOUJOURS product_availability à
// l'avance) : deux premières réservations simultanées d'un jour JAMAIS configuré doivent quand même
// se sérialiser correctement — l'unicité (product_id, date) + ON CONFLICT DO NOTHING doit fermer la
// fenêtre entre "aucune ligne n'existe" et "la ligne existe et est verrouillée", jamais laisser
// passer une survente parce que deux transactions ont chacune vu `not found` en même temps.
//
// Même squelette que create_order.concurrency.mjs (driver `pg` direct, barrière de synchronisation,
// jamais pgTAP ni Promise.all naïf, jamais de sleep — cf. hifago/CLAUDE.md §6). Contre la stack
// Supabase locale uniquement (127.0.0.1:54322) — jamais un projet cloud partagé.
//
// ⚠️ Réécrit le 2026-09-10 (spec 32, panier en base) : create_order ne reçoit plus les lignes en
// paramètre, il les lit dans cart_items pour SON PROPRE account_id — N connexions sous le même
// compte partagerait la même ligne. Remplacé par N BUYERS DISTINCTS, chacun avec son panier déjà
// posé en base (cf. create_order.concurrency.mjs, même correction).
import pg from "pg";

const { Client } = pg;

// Surchargeable par PGURL : ces tests ÉCRIVENT. Les pointer ailleurs que sur la stack locale
// partagée est le seul moyen de les vérifier sans écraser le travail d'une autre session
// (cf. AGENTS-PARALLELES.md §3). Défaut inchangé : la stack locale.
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5; // barre d'acceptation : ≥5 runs consécutifs propres

// Préfixe UUID dédié à ce fichier (90000000-…) — ne collisionne avec aucun préfixe déjà utilisé
// par seed.sql (a0000000-…/b0000000-…) ni les autres tests de concurrence (00000000-…/20000000-…/
// 60000000-…/70000000-…/80000000-…/99990000-…).
const PARTNER_ID = "90000000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "90000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "90000000-0000-4000-8000-000000000010";
const DATE = "2029-02-01";
const DEFAULT_CAPACITY = 1;
const N = 20; // tentatives concurrentes visant la même date jamais configurée
// Segment dédié aux comptes ACHETEURS (distinct du vendeur) : un par connexion concurrente,
// jamais partagé — cf. note de réécriture en tête de fichier.
const BUYER_ID_SEGMENT = "8100";
function buyerAccountId(i) {
  return `90000000-0000-4000-${BUYER_ID_SEGMENT}-${String(i).padStart(12, "0")}`;
}

// Connecte UN acheteur : identité propre (auth.users, donc partner_accounts via le trigger de
// provisioning), son panier déjà posé en base (cart_items), puis le JWT qui le fait reconnaître
// comme lui-même par auth.uid().
async function connectBuyer(i, cartLines) {
  const accountId = buyerAccountId(i);
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    accountId,
    `concurrency-default-capacity-buyer-${i}@hifago.test`,
  ]);
  for (const line of cartLines) {
    await client.query(
      "insert into cart_items (account_id, product_id, date, qty) values ($1, $2, $3, $4)",
      [accountId, line.product_id, line.date, line.qty]
    );
  }
  await client.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: accountId, role: "authenticated" }),
  ]);
  return client;
}

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

async function endAll(clients) {
  await Promise.all(clients.map((client) => client.end()));
}

// Purge des fixtures de ce fichier — avant chaque run (par le reset ci-dessous) ET une dernière fois
// en fin de fichier, quoi qu'il arrive (audit P12e, 2026-10-06). Sans la seconde, le dernier run
// laissait ses lignes en base : sur la pile locale partagée comme en CI, où le job `concurrence`
// compare désormais les comptes de lignes avant/après.
async function purgeFixtures(seedClient) {
  await seedClient.query(
    `delete from order_lines
      where product_id in (select id from products where establishment_id = $1)`,
    [ESTABLISHMENT_ID]
  );
  // Acheteurs : identifiés par le segment dédié (BUYER_ID_SEGMENT), jamais par une seule ID fixe
  // depuis que chaque connexion concurrente porte sa propre identité (cf. tête de fichier).
  await seedClient.query(
    `delete from orders where account_id::text like '90000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from cart_items where account_id::text like '90000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from carts where account_id::text like '90000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from partner_accounts where id::text like '90000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from auth.users where id::text like '90000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from product_availability
      where product_id in (select id from products where establishment_id = $1)`,
    [ESTABLISHMENT_ID]
  );
  await seedClient.query("delete from products where establishment_id = $1", [ESTABLISHMENT_ID]);
  await seedClient.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await seedClient.query("delete from partners where id = $1", [PARTNER_ID]);
}

async function resetAndSeed(seedClient) {
  await purgeFixtures(seedClient);

  await seedClient.query("insert into partners (id, display_name) values ($1, $2)", [
    PARTNER_ID,
    "Create Order Default Capacity Concurrency Partner",
  ]);
  await seedClient.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID,
    PARTNER_ID,
    JSON.stringify({ es: "Create Order Default Capacity Concurrency Establishment" }),
  ]);
  // AUCUNE ligne product_availability semée ici, volontairement — c'est exactement le scénario
  // ciblé : la toute première réservation d'un jour jamais configuré, sous concurrence réelle.
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                           default_capacity)
     values ($1, $2, $3, 'activity', jsonb_build_object('es', 'Default capacity concurrency slot'),
             50000, true, $4, $5)`,
    [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID, "default-capacity-concurrency-slot", DEFAULT_CAPACITY]
  );
}

async function runOnce(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetAndSeed(seedClient);

  const cart = [{ product_id: PRODUCT_ID, date: DATE, qty: 1 }];
  const clients = await Promise.all(Array.from({ length: N }, (_, i) => connectBuyer(i, cart)));
  const { go, markReady } = makeBarrier(N);

  const settled = await Promise.allSettled(
    clients.map(async (client) => {
      markReady();
      await go;
      const res = await client.query(
        "select create_order($1, $2, $3, $4) as result",
        ["Concurrency Buyer", "concurrency-buyer@hifago.test", null, false]
      );
      return res.rows[0].result;
    })
  );

  const rejected = settled.filter((s) => s.status === "rejected");
  const results = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  const successes = results.filter((r) => r.ok === true);
  const failures = results.filter((r) => r.ok === false);
  const unexpectedFailureReasons = failures.filter((r) => r.reason !== "full");

  // Exactement UNE ligne product_availability doit avoir été matérialisée pour (PRODUCT_ID, DATE)
  // — deux INSERT concurrents en conflit sur la même clé (product_id, date) prouveraient que la
  // matérialisation elle-même a dérivé (jamais censé arriver : ON CONFLICT DO NOTHING + unicité).
  const { rows: state } = await seedClient.query(
    "select capacity, booked from product_availability where product_id = $1 and date = $2",
    [PRODUCT_ID, DATE]
  );
  const materializedOnce = state.length === 1;
  const bookedMatchesCapacity =
    materializedOnce && state[0].capacity === DEFAULT_CAPACITY && state[0].booked === DEFAULT_CAPACITY;

  console.log(
    `  run ${run}: succès ${successes.length} / ${N} (doit être exactement 1), ` +
      `échecs ${failures.length} (raison attendue: 'full'), rejets réseau/driver ${rejected.length}, ` +
      `lignes product_availability matérialisées=${state.length} (doit être 1), ` +
      `booked=${state[0]?.booked} capacity=${state[0]?.capacity} (default_capacity=${DEFAULT_CAPACITY})`
  );
  if (rejected.length > 0) {
    for (const r of rejected) {
      console.error(`    rejet inattendu (connexion/deadlock ?) : ${r.reason?.message ?? r.reason}`);
    }
  }
  if (unexpectedFailureReasons.length > 0) {
    console.error(`    échecs avec une raison inattendue : ${JSON.stringify(unexpectedFailureReasons)}`);
  }
  if (!materializedOnce) {
    console.error(
      `    matérialisation dérivée : ${state.length} ligne(s) product_availability au lieu de 1`
    );
  }

  await endAll(clients);
  await seedClient.end();

  return (
    rejected.length === 0 &&
    successes.length === 1 &&
    unexpectedFailureReasons.length === 0 &&
    bookedMatchesCapacity
  );
}

async function runAll() {
  console.log(
    `\n=== create_order — matérialisation default_capacity sous concurrence (N=${N}, ${RUNS} runs consécutifs requis) ===`
  );
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
      return 1;
    }
  }
  console.log(
    `\n${RUNS} runs consécutifs propres — matérialisation par défaut de create_order validée sous concurrence réelle (aucune survente, aucun conflit de matérialisation).`
  );
  return 0;
}

async function purgeAtEnd() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  try {
    await purgeFixtures(client);
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
