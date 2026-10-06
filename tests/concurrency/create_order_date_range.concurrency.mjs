// Spec 17 §0 Tranche 2 (docs/specs/17-calendrier-disponibilite-refonte.md) — test de concurrence
// réelle de create_order sur des plages de nuits (alojamiento : end_date, sans sélection de chambre),
// d'acceptation élevée par rapport au patron camp (cf. §0 Tranche 2 "Tests") : le camp traite le
// chevauchement comme un cas rare en plus des tests de régression, ici les plages qui se
// chevauchent partiellement sur le même hébergement sont le cas quotidien dominant.
//
// Ce fichier s'appelait create_order_room_range et exerçait la branche CHAMBRE D'HÔTEL, supprimée
// par T3 étape 2 (20260827220000). Il est porté et non supprimé : la branche alojamiento par plage
// partage exactement le même mécanisme de verrouillage nuit par nuit, et c'est le SEUL test de
// concurrence qui couvre les plages — les autres ne traitent que des dates uniques. Chaque chambre
// est devenue un produit `lodging` à part entière, ce qui est précisément le sens de T3.
// Même squelette que
// create_order_camp.concurrency.mjs : driver `pg` direct, barrière de synchronisation, jamais
// pgTAP ni Promise.all naïf, jamais de sleep pour synchroniser (cf. hifago/CLAUDE.md §6).
//
// 3 scénarios :
//   1. Régression — plages IDENTIQUES : N réservations de la même chambre/même plage à capacité 1
//      → exactement 1 succès.
//   2. Chevauchement partiel/imbriqué avec qty multiples — plusieurs plages différentes (certaines
//      imbriquées, certaines qty>1) contestant une fenêtre de nuits à capacité serrée → jamais
//      booked > capacity sur AUCUNE nuit, quel que soit le nombre de succès.
//   3. Plages ADJACENTES (aucune nuit commune) — preuve que le verrouillage par nuit ne crée aucune
//      contention artificielle entre deux plages qui ne se touchent pas : les deux groupes doivent
//      pouvoir remplir leur propre capacité en parallèle, sans se bloquer l'un l'autre.
//
// ⚠️ Réécrit le 2026-09-10 (spec 32, panier en base) : create_order ne reçoit plus les lignes en
// paramètre, il les lit dans cart_items pour SON PROPRE account_id — N connexions sous le même
// compte partagerait la même ligne. Remplacé par N BUYERS DISTINCTS, chacun avec son panier déjà
// posé en base (cf. create_order.concurrency.mjs, même correction).
//
// Contre la stack Supabase locale uniquement (127.0.0.1:54322) — jamais un projet cloud partagé.
import pg from "pg";

const { Client } = pg;

// Surchargeable par PGURL : ces tests ÉCRIVENT. Les pointer ailleurs que sur la stack locale
// partagée est le seul moyen de les vérifier sans écraser le travail d'une autre session
// (cf. AGENTS-PARALLELES.md §3). Défaut inchangé : la stack locale.
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5;

// Préfixe UUID dédié (80000000-…) — distinct des préfixes déjà utilisés par les autres fichiers de
// concurrence (00000000-/20000000-/60000000-/70000000-/99990000-) et de seed.sql (a0000000-/
// b0000000-).
const PARTNER_ID = "80000000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "80000000-0000-4000-8000-000000000002";
// Segment dédié aux comptes ACHETEURS (distinct du vendeur) : un par connexion concurrente,
// jamais partagé — cf. note de réécriture en tête de fichier.
const BUYER_ID_SEGMENT = "8100";
function buyerAccountId(i) {
  return `80000000-0000-4000-${BUYER_ID_SEGMENT}-${String(i).padStart(12, "0")}`;
}

// Connecte UN acheteur : identité propre (auth.users, donc partner_accounts via le trigger de
// provisioning), son panier déjà posé en base (cart_items — end_date compris), puis le JWT qui le
// fait reconnaître comme lui-même par auth.uid().
async function connectBuyer(i, cartLines) {
  const accountId = buyerAccountId(i);
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    accountId,
    `concurrency-date-range-buyer-${i}@hifago.test`,
  ]);
  for (const line of cartLines) {
    await client.query(
      "insert into cart_items (account_id, product_id, date, end_date, qty) values ($1, $2, $3, $4, $5)",
      [accountId, line.product_id, line.date, line.end_date ?? null, line.qty]
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
    `delete from orders where account_id::text like '80000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from cart_items where account_id::text like '80000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from carts where account_id::text like '80000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from partner_accounts where id::text like '80000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from auth.users where id::text like '80000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
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
    "Create Order Date Range Concurrency Partner",
  ]);
  await seedClient.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID,
    PARTNER_ID,
    JSON.stringify({ es: "Create Order Date Range Concurrency Establishment" }),
  ]);
}

// Chaque scénario crée son propre produit `lodging` — l'équivalent direct de la chambre d'avant.
// calendar_default_open vaut true par défaut, donc aucune ligne product_calendar n'est nécessaire :
// toutes les nuits sont ouvertes tant qu'on ne les ferme pas explicitement.
async function seedLodging(seedClient, id, label, slug, priceCop, maxQty) {
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                           min_qty, max_qty)
     values ($1, $2, $3, 'lodging', $4, $5, true, $6, 1, $7)`,
    [id, PARTNER_ID, ESTABLISHMENT_ID, JSON.stringify({ es: label }), priceCop, slug, maxQty]
  );
}

// --- Scénario 1 : régression — N réservations du MÊME hébergement/MÊME plage, capacité 1 --------
const SCENARIO_1_N = 20;
const LODGING_1_ID = "80000000-0000-4000-8000-000000000010";
const SCENARIO_1_START = "2029-03-01";
const SCENARIO_1_END = "2029-03-04"; // 3 nuits

async function seedScenario1(seedClient) {
  await seedLodging(
    seedClient, LODGING_1_ID, "Date Range Concurrency Regression",
    "date-range-concurrency-regression", 100000, 1
  );
  await seedClient.query(
    `insert into product_availability (product_id, date, capacity, booked)
     select $1, $2::date + n, 1, 0 from generate_series(0, 2) as n`,
    [LODGING_1_ID, SCENARIO_1_START]
  );
}

async function runScenario1Once(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetAll(seedClient);
  await seedScenario1(seedClient);

  const cart = [
    { product_id: LODGING_1_ID, date: SCENARIO_1_START, end_date: SCENARIO_1_END, qty: 1 },
  ];
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
        ["Concurrency Date Range Buyer", "concurrency-date-range-buyer@hifago.test", null, false]
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
    "select date, capacity, booked from product_availability where product_id = $1 order by date",
    [LODGING_1_ID]
  );
  const bookedMatchesCapacity = state.every((row) => row.booked === row.capacity);
  const noOversell = state.every((row) => row.booked <= row.capacity);

  console.log(
    `  [scénario 1] run ${run}: succès ${successes.length} / ${SCENARIO_1_N} (doit être exactement 1), ` +
      `échecs ${failures.length} (raison attendue: 'full'), rejets ${rejected.length}, ` +
      `booked/capacity par nuit=${state.map((r) => `${r.booked}/${r.capacity}`).join(",")}`
  );
  if (rejected.length > 0) {
    for (const r of rejected) console.error(`    rejet inattendu : ${r.reason?.message ?? r.reason}`);
  }
  if (unexpectedFailureReasons.length > 0) {
    console.error(`    échecs avec une raison inattendue : ${JSON.stringify(unexpectedFailureReasons)}`);
  }

  await endAll(clients);
  await seedClient.end();

  return (
    rejected.length === 0 &&
    successes.length === 1 &&
    unexpectedFailureReasons.length === 0 &&
    bookedMatchesCapacity &&
    noOversell
  );
}

// --- Scénario 2 : plages imbriquées/chevauchantes + qty multiples, fenêtre à capacité serrée ----
// Dortoir, capacité 4 lits/nuit sur une fenêtre de 5 nuits. 15 tentatives concurrentes, qty
// variable (1 à 3), plages qui se chevauchent partiellement et s'imbriquent (pas seulement des
// doublons identiques comme le scénario 1) — le cas quotidien dominant pour un hébergement.
const LODGING_2_ID = "80000000-0000-4000-8000-000000000020";
const SCENARIO_2_BASE = "2029-04-01"; // fenêtre 2029-04-01..06 (5 nuits)
const SCENARIO_2_CAPACITY = 4;

// Chaque tentative réserve une sous-plage de [01,06[ avec une qty donnée — construites pour que la
// somme totale demandée (bien au-delà de 4×5=20 lits-nuits) dépasse largement la capacité si tout
// était accepté naïvement, tout en variant démarrage/durée/qty pour produire un vrai mélange
// imbriqué/chevauchant plutôt que des doublons.
function scenario2Attempts() {
  const shapes = [
    { offset: 0, nights: 2, qty: 2 }, // 01-03
    { offset: 0, nights: 4, qty: 1 }, // 01-05 (imbrique la précédente)
    { offset: 1, nights: 2, qty: 3 }, // 02-04
    { offset: 2, nights: 3, qty: 2 }, // 03-06
    { offset: 3, nights: 2, qty: 2 }, // 04-06
  ];
  const attempts = [];
  for (let i = 0; i < 15; i++) attempts.push(shapes[i % shapes.length]);
  return attempts;
}

async function seedScenario2(seedClient) {
  await seedLodging(
    seedClient, LODGING_2_ID, "Date Range Concurrency Overlap",
    "date-range-concurrency-overlap", 20000, 4
  );
  await seedClient.query(
    `insert into product_availability (product_id, date, capacity, booked)
     select $1, $2::date + n, $3, 0 from generate_series(0, 4) as n`,
    [LODGING_2_ID, SCENARIO_2_BASE, SCENARIO_2_CAPACITY]
  );
}

async function runScenario2Once(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetAll(seedClient);
  await seedScenario2(seedClient);

  const attempts = scenario2Attempts();
  const carts = attempts.map(({ offset, nights, qty }) => [
    {
      product_id: LODGING_2_ID,
      date: `2029-04-${String(1 + offset).padStart(2, "0")}`,
      end_date: `2029-04-${String(1 + offset + nights).padStart(2, "0")}`,
      qty,
    },
  ]);
  const clients = await Promise.all(carts.map((cart, i) => connectBuyer(i, cart)));
  const { go, markReady } = makeBarrier(attempts.length);

  const timeoutMs = 15000;
  const withTimeout = (promise, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} : timeout après ${timeoutMs}ms (interblocage suspecté)`)), timeoutMs)
      ),
    ]);

  const settled = await withTimeout(
    Promise.allSettled(
      clients.map(async (client, i) => {
        markReady();
        await go;
        const res = await client.query(
          "select create_order($1, $2, $3, $4) as result",
          [`Concurrency Overlap Buyer ${i}`, `concurrency-overlap-${i}@hifago.test`, null, false]
        );
        return res.rows[0].result;
      })
    ),
    `scénario 2 run ${run}`
  );

  const rejected = settled.filter((s) => s.status === "rejected");
  const results = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  const successes = results.filter((r) => r.ok === true);
  const failures = results.filter((r) => r.ok === false);
  const unexpectedFailureReasons = failures.filter((r) => r.reason !== "full");

  const { rows: state } = await seedClient.query(
    "select date, capacity, booked from product_availability where product_id = $1 order by date",
    [LODGING_2_ID]
  );
  const noOversell = state.every((row) => row.booked <= row.capacity);

  // Recompte indépendant : la somme des qty des lignes RÉELLEMENT écrites en base, par nuit,
  // doit correspondre exactement à `booked` — preuve que le compteur n'a pas dérivé du contenu
  // réel des lignes acceptées (pas seulement une confiance dans le nombre de `ok:true` rapportés).
  const { rows: reconciled } = await seedClient.query(
    `select gs::date as night, coalesce(sum(ol.qty), 0)::int as sum_qty
       from generate_series($1::date, $1::date + 4, interval '1 day') as gs
       left join order_lines ol
         on ol.product_id = $2 and gs::date >= ol.date and gs::date < ol.end_date
      group by gs order by gs`,
    [SCENARIO_2_BASE, LODGING_2_ID]
  );
  const reconciliationMatches = state.every((row) => {
    const match = reconciled.find((r) => r.night.toISOString().slice(0, 10) === row.date.toISOString().slice(0, 10));
    return match && match.sum_qty === row.booked;
  });

  console.log(
    `  [scénario 2] run ${run}: succès ${successes.length} / ${attempts.length}, échecs ${failures.length} ` +
      `(raison attendue: 'full'), rejets ${rejected.length}, ` +
      `booked/capacity par nuit=${state.map((r) => `${r.booked}/${r.capacity}`).join(",")}` +
      (noOversell ? "" : " — SURVENTE DÉTECTÉE") +
      (reconciliationMatches ? "" : " — RÉCONCILIATION INCOHÉRENTE")
  );
  if (rejected.length > 0) {
    for (const r of rejected) console.error(`    rejet inattendu : ${r.reason?.message ?? r.reason}`);
  }
  if (unexpectedFailureReasons.length > 0) {
    console.error(`    échecs avec une raison inattendue : ${JSON.stringify(unexpectedFailureReasons)}`);
  }

  await endAll(clients);
  await seedClient.end();

  return (
    rejected.length === 0 &&
    unexpectedFailureReasons.length === 0 &&
    noOversell &&
    reconciliationMatches &&
    successes.length > 0 // la fenêtre a assez de capacité pour qu'au moins une tentative réussisse
  );
}

// --- Scénario 3 : plages ADJACENTES (aucune nuit commune) — pas de contention artificielle ------
// Deux groupes de tentatives concurrentes sur le MÊME hébergement mais des plages totalement
// disjointes (A = nuits 1-2, B = nuits 3-4) : verrouillées séparément (clés (product_id, date)
// distinctes),
// donc les deux groupes doivent pouvoir consommer leur propre capacité (2 chacun) en parallèle,
// sans qu'aucun succès de A ne bloque ou fasse échouer un succès de B à tort.
const LODGING_3_ID = "80000000-0000-4000-8000-000000000030";
const SCENARIO_3_GROUP_N = 8;
const SCENARIO_3_CAPACITY = 2;
const SCENARIO_3_A_START = "2029-05-01"; // nuits 1-2 (01,02)
const SCENARIO_3_A_END = "2029-05-03";
const SCENARIO_3_B_START = "2029-05-03"; // nuits 3-4 (03,04) — adjacente à A, jamais la même nuit
const SCENARIO_3_B_END = "2029-05-05";

async function seedScenario3(seedClient) {
  await seedLodging(
    seedClient, LODGING_3_ID, "Date Range Concurrency Adjacent",
    "date-range-concurrency-adjacent", 100000, 1
  );
  await seedClient.query(
    `insert into product_availability (product_id, date, capacity, booked)
     select $1, $2::date + n, $3, 0 from generate_series(0, 3) as n`,
    [LODGING_3_ID, SCENARIO_3_A_START, SCENARIO_3_CAPACITY]
  );
}

async function runScenario3Once(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetAll(seedClient);
  await seedScenario3(seedClient);

  const cartA = [
    { product_id: LODGING_3_ID, date: SCENARIO_3_A_START, end_date: SCENARIO_3_A_END, qty: 1 },
  ];
  const cartB = [
    { product_id: LODGING_3_ID, date: SCENARIO_3_B_START, end_date: SCENARIO_3_B_END, qty: 1 },
  ];
  // Indices 0..N-1 = groupe A, N..2N-1 = groupe B — deux plages d'indices disjointes du même
  // segment BUYER_ID_SEGMENT, aucun conflit d'identité entre les deux groupes.
  const groupAClients = await Promise.all(
    Array.from({ length: SCENARIO_3_GROUP_N }, (_, i) => connectBuyer(i, cartA))
  );
  const groupBClients = await Promise.all(
    Array.from({ length: SCENARIO_3_GROUP_N }, (_, i) => connectBuyer(SCENARIO_3_GROUP_N + i, cartB))
  );
  const { go, markReady } = makeBarrier(SCENARIO_3_GROUP_N * 2);

  const timeoutMs = 15000;
  const withTimeout = (promise, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} : timeout après ${timeoutMs}ms (interblocage suspecté)`)), timeoutMs)
      ),
    ]);

  const [resultsA, resultsB] = await withTimeout(
    Promise.all([
      Promise.allSettled(
        groupAClients.map(async (client) => {
          markReady();
          await go;
          const res = await client.query(
            "select create_order($1, $2, $3, $4) as result",
            ["Concurrency Adjacent A", "concurrency-adjacent-a@hifago.test", null, false]
          );
          return res.rows[0].result;
        })
      ),
      Promise.allSettled(
        groupBClients.map(async (client) => {
          markReady();
          await go;
          const res = await client.query(
            "select create_order($1, $2, $3, $4) as result",
            ["Concurrency Adjacent B", "concurrency-adjacent-b@hifago.test", null, false]
          );
          return res.rows[0].result;
        })
      ),
    ]),
    `scénario 3 run ${run}`
  );

  const allSettled = [...resultsA, ...resultsB];
  const rejected = allSettled.filter((s) => s.status === "rejected");
  const successesA = resultsA.filter((s) => s.status === "fulfilled" && s.value.ok).length;
  const successesB = resultsB.filter((s) => s.status === "fulfilled" && s.value.ok).length;
  const results = allSettled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  const failures = results.filter((r) => r.ok === false);
  const unexpectedFailureReasons = failures.filter((r) => r.reason !== "full");

  const { rows: state } = await seedClient.query(
    "select date, capacity, booked from product_availability where product_id = $1 order by date",
    [LODGING_3_ID]
  );
  const noOversell = state.every((row) => row.booked <= row.capacity);

  console.log(
    `  [scénario 3] run ${run}: succès A=${successesA}/${SCENARIO_3_GROUP_N} (capacité ${SCENARIO_3_CAPACITY}), ` +
      `succès B=${successesB}/${SCENARIO_3_GROUP_N} (capacité ${SCENARIO_3_CAPACITY}) — les deux DOIVENT atteindre leur capacité, ` +
      `rejets ${rejected.length}` + (noOversell ? "" : " — SURVENTE DÉTECTÉE")
  );
  if (rejected.length > 0) {
    for (const r of rejected) console.error(`    rejet inattendu : ${r.reason?.message ?? r.reason}`);
  }
  if (unexpectedFailureReasons.length > 0) {
    console.error(`    échecs avec une raison inattendue : ${JSON.stringify(unexpectedFailureReasons)}`);
  }

  await endAll(groupAClients);
  await endAll(groupBClients);
  await seedClient.end();

  return (
    rejected.length === 0 &&
    unexpectedFailureReasons.length === 0 &&
    noOversell &&
    successesA === SCENARIO_3_CAPACITY &&
    successesB === SCENARIO_3_CAPACITY
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
  const s1 = await runScenario(
    "Scénario 1 — régression (N réservations de la même plage/hébergement, capacité 1)",
    runScenario1Once
  );
  if (!s1) return 1;

  const s2 = await runScenario(
    "Scénario 2 — plages imbriquées/chevauchantes + qty multiples, fenêtre à capacité serrée",
    runScenario2Once
  );
  if (!s2) return 1;

  const s3 = await runScenario(
    "Scénario 3 — plages adjacentes (aucune nuit commune, pas de contention artificielle)",
    runScenario3Once
  );
  if (!s3) return 1;

  console.log(
    "\nTous les scénarios ont tenu leurs 5 runs consécutifs propres — create_order (alojamiento par plage) validé sous concurrence réelle."
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
