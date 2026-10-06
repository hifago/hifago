// Feature 6 (Client : composer un panier à plusieurs lignes sur une même commande,
// multi-établissement) — test de concurrence réelle de create_order, qui remplace
// reserve_order_line (20260813243000_create_order_rpc.sql). Même squelette que
// reserve_order_line.concurrency.mjs / spike_camp_resource.concurrency.mjs : driver `pg` direct,
// barrière de synchronisation, jamais pgTAP ni Promise.all naïf, jamais de sleep pour synchroniser
// (cf. hifago/CLAUDE.md §6).
//
// Deux scénarios dans le même fichier :
//   1. Régression (reprend reserve_order_line) : panier à 1 ligne, N=20 commandes concurrentes sur
//      une ressource à capacité 1 — exactement 1 succès, 19 échecs propres ('full'), pas de
//      survente en base.
//   2. Anti-deadlock (spécifique feature 6) : dérisque le verrouillage multi-ressources en ordre
//      stable (product_id, date) posé en phase 2 de la RPC. Paires de commandes à 2 lignes visant
//      les deux mêmes ressources A/B en ordre inverse (panier [A,B] vs [B,A]), lancées en masse et
//      en concurrence — capacité large pour isoler la question du deadlock de celle du plafond.
//
// ⚠️ Réécrit le 2026-09-10 (spec 32, panier en base) : create_order ne reçoit plus les lignes en
// paramètre, il les lit dans cart_items pour SON PROPRE account_id. Le modèle « 20 connexions
// concurrentes sous le MÊME account_id, chacune avec son propre p_lines » ne représente plus rien
// de réel : les 20 écriraient/videraient la même ligne cart_items. Remplacé par N BUYERS DISTINCTS
// (un account_id par connexion), chacun avec son propre panier déjà posé en base avant l'appel —
// plus fidèle à la réalité (N vrais visiteurs distincts qui tentent tous la même ressource rare),
// et c'est justement ce que l'invariant anti-survente doit tenir face à N identités réelles, pas
// une seule qui répéterait l'appel.
//
// Contre la stack Supabase locale uniquement (127.0.0.1:54322) — jamais un projet cloud partagé.
// Environnement partagé avec d'autres agents : une erreur transitoire isolée (connexion, relation
// manquante) doit être re-testée après un `supabase db reset` frais avant de conclure à un bug.
import pg from "pg";

const { Client } = pg;

// Surchargeable par PGURL : ces tests ÉCRIVENT. Les pointer ailleurs que sur la stack locale
// partagée est le seul moyen de les vérifier sans écraser le travail d'une autre session
// (cf. AGENTS-PARALLELES.md §3). Défaut inchangé : la stack locale.
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5; // barre d'acceptation : ≥5 runs consécutifs propres, par scénario

// Préfixe UUID dédié à ce fichier (60000000-…) — ne collisionne ni avec seed.sql (a0000000-…/
// b0000000-…), ni avec les autres tests de concurrence (10000000-…/20000000-…/99990000-…).
const PARTNER_ID = "60000000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "60000000-0000-4000-8000-000000000002";
// Segment dédié aux comptes ACHETEURS (distinct du vendeur ci-dessus) : un par connexion
// concurrente, jamais partagé — cf. note de réécriture en tête de fichier.
const BUYER_ID_SEGMENT = "8100";
function buyerAccountId(i) {
  return `60000000-0000-4000-${BUYER_ID_SEGMENT}-${String(i).padStart(12, "0")}`;
}

// Connecte UN acheteur : identité propre (auth.users, donc partner_accounts via le trigger de
// provisioning), son panier déjà posé en base (cart_items — create_order ne reçoit plus les
// lignes en paramètre), puis le JWT qui le fait reconnaître comme lui-même par auth.uid().
async function connectBuyer(i, cartLines) {
  const accountId = buyerAccountId(i);
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    accountId,
    `concurrency-buyer-${i}@hifago.test`,
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

// Barrière : chaque worker signale qu'il est prêt, puis attend un signal commun. Le signal ne se
// déclenche que lorsque TOUS les workers sont prêts, pour maximiser le chevauchement réel des
// requêtes FOR UPDATE dans la RPC.
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
  // Nettoyage complet, dans l'ordre imposé par les FK (enfants avant parents). Portée large
  // (tous les produits de ESTABLISHMENT_ID, pas seulement ceux du scénario en cours) exprès : sans
  // ça, un run de scénario 2 juste après scénario 1 laisserait les produits du scénario 1 accrochés
  // à establishments/products par FK au moment de recréer l'identité, et réciproquement — un
  // filtrage par scénario avait initialement provoqué exactement cette violation de contrainte.
  await seedClient.query(
    `delete from order_lines
      where product_id in (select id from products where establishment_id = $1)`,
    [ESTABLISHMENT_ID]
  );
  // Acheteurs : identifiés par le segment dédié (BUYER_ID_SEGMENT), jamais par une seule ID fixe
  // depuis que chaque connexion concurrente porte sa propre identité (cf. tête de fichier).
  await seedClient.query(
    `delete from orders where account_id::text like '60000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from cart_items where account_id::text like '60000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from carts where account_id::text like '60000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from partner_accounts where id::text like '60000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from auth.users where id::text like '60000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
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

async function resetAll(seedClient) {
  await purgeFixtures(seedClient);

  await seedClient.query("insert into partners (id, display_name) values ($1, $2)", [
    PARTNER_ID,
    "Create Order Concurrency Partner",
  ]);
  await seedClient.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID,
    PARTNER_ID,
    JSON.stringify({ es: "Create Order Concurrency Establishment" }),
  ]);
}

// --- Scénario 1 : régression — N paniers à 1 ligne sur une ressource à capacité 1 --------------
const SCENARIO_1_N = 20; // tentatives concurrentes visant la même ressource à capacité 1
const SCENARIO_1_PRODUCT_ID = "60000000-0000-4000-8000-000000000010";
const SCENARIO_1_DATE = "2028-06-01";

async function seedScenario1(seedClient) {
  // Suppression déjà faite par resetAll (portée large sur ESTABLISHMENT_ID) — cette fonction ne
  // fait que semer les données propres au scénario 1.
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values ($1, $2, $3, 'activity', jsonb_build_object('es', 'Create order concurrency slot'), 50000, true, $4)`,
    [SCENARIO_1_PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID, "create-order-concurrency-slot"]
  );
  await seedClient.query(
    "insert into product_availability (product_id, date, capacity, booked) values ($1, $2, 1, 0)",
    [SCENARIO_1_PRODUCT_ID, SCENARIO_1_DATE]
  );
}

async function runScenario1Once(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetAll(seedClient);
  await seedScenario1(seedClient);

  const cart = [{ product_id: SCENARIO_1_PRODUCT_ID, date: SCENARIO_1_DATE, qty: 1 }];
  const clients = await Promise.all(
    Array.from({ length: SCENARIO_1_N }, (_, i) => connectBuyer(i, cart))
  );
  const { go, markReady } = makeBarrier(SCENARIO_1_N);

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

  const { rows: state } = await seedClient.query(
    "select capacity, booked from product_availability where product_id = $1 and date = $2",
    [SCENARIO_1_PRODUCT_ID, SCENARIO_1_DATE]
  );
  const bookedMatchesCapacity = state.length === 1 && state[0].booked === state[0].capacity;

  console.log(
    `  [scénario 1] run ${run}: succès ${successes.length} / ${SCENARIO_1_N} (doit être exactement 1), ` +
      `échecs ${failures.length} (raison attendue: 'full'), rejets réseau/driver ${rejected.length}, ` +
      `booked=${state[0]?.booked} capacity=${state[0]?.capacity}`
  );
  if (rejected.length > 0) {
    for (const r of rejected) {
      console.error(`    rejet inattendu (connexion/deadlock ?) : ${r.reason?.message ?? r.reason}`);
    }
  }
  if (unexpectedFailureReasons.length > 0) {
    console.error(
      `    échecs avec une raison inattendue : ${JSON.stringify(unexpectedFailureReasons)}`
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

// --- Scénario 2 : anti-deadlock — paires de paniers à 2 lignes visant A/B en ordre inverse -----
// A et B : deux (product_id, date) distincts, capacité large (aucune commande ne doit échouer pour
// une raison de capacité — le but est de prouver l'ABSENCE de deadlock, pas de tester les
// plafonds). Chaque paire lance simultanément une commande X = panier [A, B] et une commande
// Y = panier [B, A] ; plusieurs paires concurrentes ciblent les 2 MÊMES ressources A/B pour
// maximiser la contention réelle sur le verrouillage. L'ordre [A,B] vs [B,A] est désormais celui
// de l'INSERTION dans cart_items (create_order trie ses lignes par created_at) — X insère A puis
// B, Y insère B puis A, chaque insertion étant son propre aller-retour réseau donc son propre
// timestamp, dans l'ordre voulu.
const SCENARIO_2_PAIRS = 10; // 10 paires => 20 commandes concurrentes, comme le scénario 1
const SCENARIO_2_PRODUCT_A_ID = "60000000-0000-4000-8000-000000000020";
const SCENARIO_2_PRODUCT_B_ID = "60000000-0000-4000-8000-000000000021";
const SCENARIO_2_DATE_A = "2028-07-01";
const SCENARIO_2_DATE_B = "2028-07-15";
const SCENARIO_2_CAPACITY = 10000; // large : isole le deadlock du plafond

async function seedScenario2(seedClient) {
  // Suppression déjà faite par resetAll (portée large sur ESTABLISHMENT_ID) — cette fonction ne
  // fait que semer les données propres au scénario 2.
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values
       ($1, $3, $4, 'activity', jsonb_build_object('es', 'Anti-deadlock resource A'), 50000, true, $5),
       ($2, $3, $4, 'activity', jsonb_build_object('es', 'Anti-deadlock resource B'), 50000, true, $6)`,
    [
      SCENARIO_2_PRODUCT_A_ID,
      SCENARIO_2_PRODUCT_B_ID,
      PARTNER_ID,
      ESTABLISHMENT_ID,
      "anti-deadlock-resource-a",
      "anti-deadlock-resource-b",
    ]
  );
  await seedClient.query(
    `insert into product_availability (product_id, date, capacity, booked) values
       ($1, $2, $5, 0),
       ($3, $4, $5, 0)`,
    [
      SCENARIO_2_PRODUCT_A_ID,
      SCENARIO_2_DATE_A,
      SCENARIO_2_PRODUCT_B_ID,
      SCENARIO_2_DATE_B,
      SCENARIO_2_CAPACITY,
    ]
  );
}

async function runScenario2Once(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetAll(seedClient);
  await seedScenario2(seedClient);

  const totalOrders = SCENARIO_2_PAIRS * 2;
  const cartXAB = [
    { product_id: SCENARIO_2_PRODUCT_A_ID, date: SCENARIO_2_DATE_A, qty: 1 },
    { product_id: SCENARIO_2_PRODUCT_B_ID, date: SCENARIO_2_DATE_B, qty: 1 },
  ];
  const cartYBA = [
    { product_id: SCENARIO_2_PRODUCT_B_ID, date: SCENARIO_2_DATE_B, qty: 1 },
    { product_id: SCENARIO_2_PRODUCT_A_ID, date: SCENARIO_2_DATE_A, qty: 1 },
  ];

  // Alterne strictement X/Y : la moitié des acheteurs verrouille dans l'ordre soumis [A, B],
  // l'autre dans l'ordre inverse [B, A] — c'est le tri stable (product_id, date) interne à la RPC
  // qui doit ramener les deux à un seul ordre réel de verrouillage.
  const clients = await Promise.all(
    Array.from({ length: totalOrders }, (_, i) => connectBuyer(i, i % 2 === 0 ? cartXAB : cartYBA))
  );
  const labels = Array.from({ length: totalOrders }, (_, i) => (i % 2 === 0 ? "X[A,B]" : "Y[B,A]"));
  const { go, markReady } = makeBarrier(totalOrders);

  // Timeout de garde : un vrai interblocage non résolu par le tri stable ferait pendre les
  // requêtes bien au-delà du deadlock_timeout de Postgres (1s par défaut, qui lève normalement une
  // erreur "deadlock detected" côté driver) — même filet que spike_camp_resource scénario 3.
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
    Promise.allSettled(
      clients.map(async (client) => {
        markReady();
        await go;
        const res = await client.query(
          "select create_order($1, $2, $3, $4) as result",
          ["Concurrency Buyer", "concurrency-buyer@hifago.test", null, false]
        );
        return res.rows[0].result;
      })
    ),
    `scénario 2 run ${run}`
  );

  const rejected = settled
    .map((s, i) => ({ ...s, label: labels[i] }))
    .filter((s) => s.status === "rejected");
  const results = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  const successes = results.filter((r) => r.ok === true);
  const failures = results.filter((r) => r.ok === false);

  const deadlockOrTimeoutRejections = rejected.filter((r) => {
    const msg = (r.reason?.message ?? String(r.reason)).toLowerCase();
    return msg.includes("deadlock") || msg.includes("timeout") || msg.includes("interblocage");
  });

  const { rows: state } = await seedClient.query(
    `select product_id, date, capacity, booked from product_availability
      where product_id in ($1, $2) order by product_id, date`,
    [SCENARIO_2_PRODUCT_A_ID, SCENARIO_2_PRODUCT_B_ID]
  );
  // Chaque ressource reçoit exactement 1 unité par commande réussie (toutes les commandes
  // touchent A ET B) — la capacité étant large, tout succès doit se refléter fidèlement en base.
  const expectedBooked = successes.length;
  const bookedConsistent = state.every((row) => row.booked === expectedBooked);

  console.log(
    `  [scénario 2] run ${run}: succès ${successes.length} / ${totalOrders} (doit être ${totalOrders}, capacité large), ` +
      `échecs ${failures.length}, rejets ${rejected.length} (dont deadlock/timeout: ${deadlockOrTimeoutRejections.length}), ` +
      `booked A=${state[0]?.booked}/${state[0]?.capacity} B=${state[1]?.booked}/${state[1]?.capacity}`
  );
  if (rejected.length > 0) {
    for (const r of rejected) {
      console.error(`    rejet [${r.label}] : ${r.reason?.message ?? r.reason}`);
    }
  }
  if (failures.length > 0) {
    console.error(`    échecs applicatifs inattendus : ${JSON.stringify(failures)}`);
  }

  await endAll(clients);
  await seedClient.end();

  return (
    deadlockOrTimeoutRejections.length === 0 &&
    rejected.length === 0 &&
    failures.length === 0 &&
    successes.length === totalOrders &&
    bookedConsistent
  );
}

async function runScenario(name, runOnce) {
  console.log(`\n=== ${name} — ${RUNS} runs consécutifs requis ===`);
  for (let run = 1; run <= RUNS; run++) {
    let clean;
    try {
      clean = await runOnce(run);
    } catch (err) {
      console.error(`  [${name}] run ${run} a levé une erreur : ${err.message}`);
      clean = false;
    }
    if (!clean) {
      console.error(`\nÉCHEC — ${name}, run ${run}/${RUNS}. Zéro tolérance à un échec isolé.`);
      return false;
    }
  }
  console.log(`  ${RUNS} runs consécutifs propres pour "${name}".`);
  return true;
}

async function runAll() {
  const scenario1Ok = await runScenario(
    "Scénario 1 — régression (panier à 1 ligne, N=20 sur une ressource à capacité 1)",
    runScenario1Once
  );
  if (!scenario1Ok) return 1;

  const scenario2Ok = await runScenario(
    "Scénario 2 — anti-deadlock (paires de paniers [A,B] vs [B,A], verrouillage en ordre stable)",
    runScenario2Once
  );
  if (!scenario2Ok) return 1;

  console.log(
    "\nTous les scénarios ont tenu leurs 5 runs consécutifs propres — create_order (panier multi-lignes) validé sous concurrence réelle."
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
