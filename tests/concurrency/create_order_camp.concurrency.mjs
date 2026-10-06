// Feature 20 (Admin : créer et réserver un camp multi-jours) — test de concurrence réelle de
// create_order sur des camps multi-jours. Remplace spike_camp_resource.concurrency.mjs (retiré :
// les tables spike_* sont supprimées par la migration de cette feature, jamais promues). Même
// squelette que create_order.concurrency.mjs : driver `pg` direct, barrière de synchronisation,
// jamais pgTAP ni Promise.all naïf, jamais de sleep pour synchroniser (cf. hifago/CLAUDE.md §6).
//
// SEULEMENT 2 des 3 scénarios du spike sont repris ici (audit adversarial fin de parcours, cf.
// plan) — le 3e (camp vs activité classique sur la même ressource) reste validé UNIQUEMENT au
// niveau du spike (feature 19, schéma jetable) : tant que le blocage croisé camp↔activité reste
// différé, aucune activité ordinaire ne verrouille jamais provider_resource_calendar en
// production — il n'existe donc aucun second appel create_order réel avec lequel un camp pourrait
// entrer en course sur cette table. Le simuler ici ferait comme si ce chemin de production existait
// déjà, ce qui n'est pas le cas :
//   1. Régression (scénario 1 du spike) : N réservations du MÊME camp sur une ressource partagée à
//      capacité 1, via create_order réel → exactement 1 succès.
//   2. Chevauchement partiel (scénario 3 du spike) : deux camps aux plages chevauchantes
//      partiellement, via create_order réel des deux côtés → exactement 1 succès si la capacité ne
//      suffit pas aux deux, aucun interblocage ni timeout.
//
// ⚠️ Réécrit le 2026-09-10 (spec 32, panier en base) : create_order ne reçoit plus les lignes en
// paramètre, il les lit dans cart_items pour SON PROPRE account_id — N connexions sous le même
// compte partagerait la même ligne. Remplacé par N BUYERS DISTINCTS, chacun avec son panier déjà
// posé en base (cf. create_order.concurrency.mjs, même correction).
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

// Préfixe UUID dédié à ce fichier (70000000-…) — ne collisionne avec aucun autre test de
// concurrence (00000000-…/20000000-…/60000000-…/99990000-…) ni avec seed.sql (a0000000-…/b0000000-…).
const PARTNER_ID = "70000000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "70000000-0000-4000-8000-000000000002";
// Segment dédié aux comptes ACHETEURS (distinct du vendeur) : un par connexion concurrente,
// jamais partagé — cf. note de réécriture en tête de fichier.
const BUYER_ID_SEGMENT = "8100";
function buyerAccountId(i) {
  return `70000000-0000-4000-${BUYER_ID_SEGMENT}-${String(i).padStart(12, "0")}`;
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
    `concurrency-camp-buyer-${i}@hifago.test`,
  ]);
  for (const line of cartLines) {
    // end_date optionnel (2026-09-15, camp_missing_lodging) : les lignes lodging des scénarios 1/2
    // en ont besoin, les lignes camp continuent de le laisser null comme avant.
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

// Barrière : chaque worker signale qu'il est prêt, puis attend un signal commun — maximise le
// chevauchement réel des requêtes FOR UPDATE dans la RPC.
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
  // Ordre imposé par les FK (enfants avant parents) — portée large (tout ESTABLISHMENT_ID) exprès,
  // même raisonnement que create_order.concurrency.mjs : un run de scénario 2 juste après le
  // scénario 1 laisserait sinon des lignes accrochées par FK au moment de recréer l'identité.
  await seedClient.query("delete from availability_blocks where establishment_id = $1", [
    ESTABLISHMENT_ID,
  ]);
  await seedClient.query(
    `delete from order_lines
      where product_id in (select id from products where establishment_id = $1)`,
    [ESTABLISHMENT_ID]
  );
  // Acheteurs : identifiés par le segment dédié (BUYER_ID_SEGMENT), jamais par une seule ID fixe
  // depuis que chaque connexion concurrente porte sa propre identité (cf. tête de fichier).
  await seedClient.query(
    `delete from orders where account_id::text like '70000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from cart_items where account_id::text like '70000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from carts where account_id::text like '70000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from partner_accounts where id::text like '70000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from auth.users where id::text like '70000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from product_availability
      where product_id in (select id from products where establishment_id = $1)`,
    [ESTABLISHMENT_ID]
  );
  await seedClient.query("delete from provider_resource_calendar where establishment_id = $1", [
    ESTABLISHMENT_ID,
  ]);
  await seedClient.query("delete from products where establishment_id = $1", [ESTABLISHMENT_ID]);
  await seedClient.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await seedClient.query("delete from partners where id = $1", [PARTNER_ID]);
}

async function resetAll(seedClient) {
  await purgeFixtures(seedClient);

  await seedClient.query("insert into partners (id, display_name) values ($1, $2)", [
    PARTNER_ID,
    "Create Order Camp Concurrency Partner",
  ]);
  await seedClient.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID,
    PARTNER_ID,
    JSON.stringify({ es: "Create Order Camp Concurrency Establishment" }),
  ]);
}

// --- Scénario 1 : régression — N réservations du MÊME camp (5 jours) sur ressource capacité 1 ---
const SCENARIO_1_N = 20;
const SCENARIO_1_CAMP_ID = "70000000-0000-4000-8000-000000000010";
const SCENARIO_1_START = "2029-01-01";
const SCENARIO_1_DAYS = 5;
// 2026-09-15 (camp_missing_lodging) : produit et plage dédiés à la ligne lodging que CHAQUE
// acheteur doit désormais porter dans son propre panier pour que create_order dépasse la nouvelle
// validation — sans rapport avec le sujet du scénario (la course sur la ressource partagée),
// capacité volontairement large (100) sur chaque nuit requise pour ne jamais l'interférer.
const SCENARIO_1_LODGING_ID = "70000000-0000-4000-8000-000000000011";
const SCENARIO_1_LODGING_END = "2029-01-05"; // date_depart + duration_days - 1

async function seedScenario1(seedClient) {
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, duration_days)
     values ($1, $2, $3, 'camp', jsonb_build_object('es', 'Camp concurrency regression'), 500000, true, $4, $5)`,
    [SCENARIO_1_CAMP_ID, PARTNER_ID, ESTABLISHMENT_ID, "camp-concurrency-regression", SCENARIO_1_DAYS]
  );
  // Capacité PROPRE du camp volontairement large (100) : jamais la contrainte testée ici, seule la
  // ressource PARTAGÉE (capacité 1/jour) doit départager les N tentatives concurrentes.
  await seedClient.query(
    "insert into product_availability (product_id, date, capacity, booked) values ($1, $2, 100, 0)",
    [SCENARIO_1_CAMP_ID, SCENARIO_1_START]
  );
  await seedClient.query(
    `insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked)
     select $1, $2::date + n, 1, 0 from generate_series(0, $3 - 1) as n`,
    [ESTABLISHMENT_ID, SCENARIO_1_START, SCENARIO_1_DAYS]
  );
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values ($1, $2, $3, 'lodging', jsonb_build_object('es', 'Lodging concurrency regression'), 50000, true, $4)`,
    [SCENARIO_1_LODGING_ID, PARTNER_ID, ESTABLISHMENT_ID, "lodging-concurrency-regression"]
  );
  await seedClient.query(
    `insert into product_availability (product_id, date, capacity, booked)
     select $1, $2::date + n, 100, 0 from generate_series(0, $3 - 2) as n`,
    [SCENARIO_1_LODGING_ID, SCENARIO_1_START, SCENARIO_1_DAYS]
  );
}

async function runScenario1Once(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetAll(seedClient);
  await seedScenario1(seedClient);

  const cart = [
    { product_id: SCENARIO_1_CAMP_ID, date: SCENARIO_1_START, qty: 1 },
    {
      product_id: SCENARIO_1_LODGING_ID,
      date: SCENARIO_1_START,
      end_date: SCENARIO_1_LODGING_END,
      qty: 1,
    },
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
        ["Concurrency Camp Buyer", "concurrency-camp-buyer@hifago.test", null, false]
      );
      return res.rows[0].result;
    })
  );

  const rejected = settled.filter((s) => s.status === "rejected");
  const results = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  const successes = results.filter((r) => r.ok === true);
  const failures = results.filter((r) => r.ok === false);
  const unexpectedFailureReasons = failures.filter((r) => r.reason !== "resource_unavailable");

  const { rows: state } = await seedClient.query(
    `select slot_date, capacity, booked from provider_resource_calendar
      where establishment_id = $1 order by slot_date`,
    [ESTABLISHMENT_ID]
  );
  const bookedMatchesCapacity = state.every((row) => row.booked === row.capacity);

  const { rows: blocks } = await seedClient.query(
    "select count(*)::int as count from availability_blocks where establishment_id = $1",
    [ESTABLISHMENT_ID]
  );
  const blockCountMatches = blocks[0].count === successes.length;

  console.log(
    `  [scénario 1] run ${run}: succès ${successes.length} / ${SCENARIO_1_N} (doit être exactement 1), ` +
      `échecs ${failures.length} (raison attendue: 'resource_unavailable'), rejets réseau/driver ${rejected.length}, ` +
      `booked/capacity par jour=${state.map((r) => `${r.booked}/${r.capacity}`).join(",")}, blocks=${blocks[0].count}`
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
    bookedMatchesCapacity &&
    blockCountMatches
  );
}

// --- Scénario 2 : deux camps aux plages chevauchantes partiellement ----------------------------
// Camp A : jours 1-5. Camp B : jours 3-7 (chevauche A sur les jours 3,4,5). 7 jours au total,
// capacité 1 chacun sur la ressource partagée — le chevauchement est la ressource disputée. Même
// scénario que le spike (feature 19), désormais via create_order réel des deux côtés.
const SCENARIO_2_PAIRS = 10; // 10+10 = 20 tentatives concurrentes, comme le scénario 1
const SCENARIO_2_CAMP_A_ID = "70000000-0000-4000-8000-000000000020";
const SCENARIO_2_CAMP_B_ID = "70000000-0000-4000-8000-000000000021";
const SCENARIO_2_TOTAL_DAYS = 7;
const SCENARIO_2_DAY_1 = "2029-02-01";
const SCENARIO_2_CAMP_A_START = "2029-02-01"; // jours 1-5
const SCENARIO_2_CAMP_B_START = "2029-02-03"; // jours 3-7
const SCENARIO_2_CAMP_DAYS = 5;
// 2026-09-15 (camp_missing_lodging) : UN lodging partagé par les deux groupes, capacité large sur
// l'union des nuits requises (02-01..02-06) — sans rapport avec le sujet du scénario (le
// chevauchement disputé porte sur provider_resource_calendar, jamais sur ce produit).
const SCENARIO_2_LODGING_ID = "70000000-0000-4000-8000-000000000022";
const SCENARIO_2_CAMP_A_END = "2029-02-05"; // date_depart + duration_days - 1
const SCENARIO_2_CAMP_B_END = "2029-02-07";

async function seedScenario2(seedClient) {
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, duration_days)
     values
       ($1, $3, $4, 'camp', jsonb_build_object('es', 'Camp concurrency overlap A'), 500000, true, $5, $7),
       ($2, $3, $4, 'camp', jsonb_build_object('es', 'Camp concurrency overlap B'), 500000, true, $6, $7)`,
    [
      SCENARIO_2_CAMP_A_ID,
      SCENARIO_2_CAMP_B_ID,
      PARTNER_ID,
      ESTABLISHMENT_ID,
      "camp-concurrency-overlap-a",
      "camp-concurrency-overlap-b",
      SCENARIO_2_CAMP_DAYS,
    ]
  );
  await seedClient.query(
    `insert into product_availability (product_id, date, capacity, booked) values
       ($1, $2, 100, 0),
       ($3, $4, 100, 0)`,
    [SCENARIO_2_CAMP_A_ID, SCENARIO_2_CAMP_A_START, SCENARIO_2_CAMP_B_ID, SCENARIO_2_CAMP_B_START]
  );
  await seedClient.query(
    `insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked)
     select $1, $2::date + n, 1, 0 from generate_series(0, $3 - 1) as n`,
    [ESTABLISHMENT_ID, SCENARIO_2_DAY_1, SCENARIO_2_TOTAL_DAYS]
  );
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values ($1, $2, $3, 'lodging', jsonb_build_object('es', 'Lodging concurrency overlap'), 50000, true, $4)`,
    [SCENARIO_2_LODGING_ID, PARTNER_ID, ESTABLISHMENT_ID, "lodging-concurrency-overlap"]
  );
  // Union des nuits requises par A (02-01..02-04) et B (02-03..02-06) : 02-01..02-06, 6 jours.
  await seedClient.query(
    `insert into product_availability (product_id, date, capacity, booked)
     select $1, $2::date + n, 100, 0 from generate_series(0, 5) as n`,
    [SCENARIO_2_LODGING_ID, SCENARIO_2_CAMP_A_START]
  );
}

async function runScenario2Once(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetAll(seedClient);
  await seedScenario2(seedClient);

  const cartA = [
    { product_id: SCENARIO_2_CAMP_A_ID, date: SCENARIO_2_CAMP_A_START, qty: 1 },
    {
      product_id: SCENARIO_2_LODGING_ID,
      date: SCENARIO_2_CAMP_A_START,
      end_date: SCENARIO_2_CAMP_A_END,
      qty: 1,
    },
  ];
  const cartB = [
    { product_id: SCENARIO_2_CAMP_B_ID, date: SCENARIO_2_CAMP_B_START, qty: 1 },
    {
      product_id: SCENARIO_2_LODGING_ID,
      date: SCENARIO_2_CAMP_B_START,
      end_date: SCENARIO_2_CAMP_B_END,
      qty: 1,
    },
  ];
  // Indices 0..PAIRS-1 = groupe camp A, PAIRS..2*PAIRS-1 = groupe camp B — deux plages d'indices
  // disjointes du même segment BUYER_ID_SEGMENT, aucun conflit d'identité entre les deux groupes.
  const campAClients = await Promise.all(
    Array.from({ length: SCENARIO_2_PAIRS }, (_, i) => connectBuyer(i, cartA))
  );
  const campBClients = await Promise.all(
    Array.from({ length: SCENARIO_2_PAIRS }, (_, i) => connectBuyer(SCENARIO_2_PAIRS + i, cartB))
  );
  const totalOrders = SCENARIO_2_PAIRS * 2;
  const { go, markReady } = makeBarrier(totalOrders);

  // Timeout de garde : un vrai interblocage non résolu par le tri stable (establishment_id,
  // slot_date) ferait pendre les requêtes bien au-delà du deadlock_timeout de Postgres (1s par
  // défaut) — même filet que le scénario 2 de create_order.concurrency.mjs / scénario 3 du spike.
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

  const [campAResults, campBResults] = await withTimeout(
    Promise.all([
      Promise.allSettled(
        campAClients.map(async (client) => {
          markReady();
          await go;
          const res = await client.query(
            "select create_order($1, $2, $3, $4) as result",
            ["Concurrency Camp A Buyer", "concurrency-camp-a-buyer@hifago.test", null, false]
          );
          return res.rows[0].result;
        })
      ),
      Promise.allSettled(
        campBClients.map(async (client) => {
          markReady();
          await go;
          const res = await client.query(
            "select create_order($1, $2, $3, $4) as result",
            ["Concurrency Camp B Buyer", "concurrency-camp-b-buyer@hifago.test", null, false]
          );
          return res.rows[0].result;
        })
      ),
    ]),
    `scénario 2 run ${run}`
  );

  const allSettled = [...campAResults, ...campBResults];
  const rejected = allSettled.filter((s) => s.status === "rejected");
  const results = allSettled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  const successes = results.filter((r) => r.ok === true);
  const failures = results.filter((r) => r.ok === false);
  const unexpectedFailureReasons = failures.filter((r) => r.reason !== "resource_unavailable");
  const campASuccesses = campAResults.filter((s) => s.status === "fulfilled" && s.value.ok).length;
  const campBSuccesses = campBResults.filter((s) => s.status === "fulfilled" && s.value.ok).length;

  // État incohérent = booked > capacity sur n'importe quel jour, vérifié directement en base (pas
  // seulement déduit du nombre de succès rapportés par la RPC).
  const { rows: state } = await seedClient.query(
    `select slot_date, capacity, booked from provider_resource_calendar
      where establishment_id = $1 order by slot_date`,
    [ESTABLISHMENT_ID]
  );
  const inconsistent = state.some((row) => row.booked > row.capacity);

  console.log(
    `  [scénario 2] run ${run}: succès ${successes.length} / ${totalOrders} ` +
      `(camp A: ${campASuccesses}, camp B: ${campBSuccesses}, doit être exactement 1 au total), ` +
      `rejets ${rejected.length}` +
      (inconsistent ? " — ÉTAT INCOHÉRENT (booked > capacity) !" : "")
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

  await endAll(campAClients);
  await endAll(campBClients);
  await seedClient.end();

  return (
    rejected.length === 0 &&
    successes.length === 1 &&
    unexpectedFailureReasons.length === 0 &&
    !inconsistent
  );
}

// --- Scénario 3 : remise par seuil de remplissage cumulé sous concurrence réelle -----------------
// Migration 20260914130000 (demande Jérôme du 2026-09-14) — camp capacity=20 EXACTEMENT égale au
// nombre de tentatives (N=20, qty=1 chacune) : aucune survente à prouver ici (déjà couvert par les
// scénarios 1/2, capacité volontairement large sur product_availability pour eux), le seul sujet
// est la justesse du PRIX sous course réelle. threshold=16 → quel que soit l'ordre réel
// d'entrelacement (imprévisible sous concurrence), la trajectoire de remplissage va forcément de
// 0 à 20 sans trou (20 succès, qty=1 chacun) : exactement les 5 lignes dont le remplissage AVANT
// elles est déjà ≥15 (donc après ≥16) sont remisées — peu importe QUELLE identité obtient quelle
// position, ce compte (15 plein tarif / 5 remisées) est invariant. Une seule ligne mal calculée
// sous une vraie interférence (lecture d'un remplissage périmé, remise appliquée deux fois, etc.)
// ferait dévier ce compte — preuve plus forte qu'un test séquentiel (cas 22 pgTAP) qui ne peut pas
// exercer de vraie course sur v_camp_fill_before_qty.
const SCENARIO_3_N = 20;
const SCENARIO_3_CAMP_ID = "70000000-0000-4000-8000-000000000030";
const SCENARIO_3_DATE = "2029-03-01";
const SCENARIO_3_PRICE_COP = 100000;
const SCENARIO_3_THRESHOLD_QTY = 16;
const SCENARIO_3_PCT = 0.2;
const SCENARIO_3_DISCOUNTED_COP = Math.round(SCENARIO_3_PRICE_COP * (1 - SCENARIO_3_PCT)); // 80000
const SCENARIO_3_EXPECTED_DISCOUNTED_LINES = SCENARIO_3_N - SCENARIO_3_THRESHOLD_QTY + 1; // 5
const SCENARIO_3_EXPECTED_FULL_PRICE_LINES = SCENARIO_3_N - SCENARIO_3_EXPECTED_DISCOUNTED_LINES; // 15

async function seedScenario3(seedClient) {
  await seedClient.query(
    `insert into products (
       id, partner_id, establishment_id, type, name, price_cop, sellable, slug, duration_days,
       group_discount_threshold_qty, group_discount_pct
     ) values ($1, $2, $3, 'camp', jsonb_build_object('es', 'Camp concurrency group discount'),
       $4, true, $5, 1, $6, $7)`,
    [
      SCENARIO_3_CAMP_ID,
      PARTNER_ID,
      ESTABLISHMENT_ID,
      SCENARIO_3_PRICE_COP,
      "camp-concurrency-group-discount",
      SCENARIO_3_THRESHOLD_QTY,
      SCENARIO_3_PCT,
    ]
  );
  // Capacité PROPRE du camp EXACTEMENT égale à N — c'est elle qui gouverne group_discount_threshold_qty
  // (product_availability.booked, pas provider_resource_calendar). Ressource partagée volontairement
  // large (100) : jamais la contrainte testée ici, seul le remplissage propre du camp doit compter.
  await seedClient.query(
    "insert into product_availability (product_id, date, capacity, booked) values ($1, $2, $3, 0)",
    [SCENARIO_3_CAMP_ID, SCENARIO_3_DATE, SCENARIO_3_N]
  );
  await seedClient.query(
    "insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values ($1, $2, 100, 0)",
    [ESTABLISHMENT_ID, SCENARIO_3_DATE]
  );
}

async function runScenario3Once(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetAll(seedClient);
  await seedScenario3(seedClient);

  const cart = [{ product_id: SCENARIO_3_CAMP_ID, date: SCENARIO_3_DATE, qty: 1 }];
  const clients = await Promise.all(
    Array.from({ length: SCENARIO_3_N }, (_, i) => connectBuyer(i, cart))
  );
  const { go, markReady } = makeBarrier(SCENARIO_3_N);

  const settled = await Promise.allSettled(
    clients.map(async (client) => {
      markReady();
      await go;
      const res = await client.query(
        "select create_order($1, $2, $3, $4) as result",
        ["Concurrency Camp Discount Buyer", "concurrency-camp-discount-buyer@hifago.test", null, false]
      );
      return res.rows[0].result;
    })
  );

  const rejected = settled.filter((s) => s.status === "rejected");
  const results = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  const successes = results.filter((r) => r.ok === true);
  const failures = results.filter((r) => r.ok === false);

  const { rows: lines } = await seedClient.query(
    "select total_cop::int as total_cop from order_lines where product_id = $1",
    [SCENARIO_3_CAMP_ID]
  );
  const fullPriceCount = lines.filter((l) => l.total_cop === SCENARIO_3_PRICE_COP).length;
  const discountedCount = lines.filter((l) => l.total_cop === SCENARIO_3_DISCOUNTED_COP).length;
  const unexpectedTotals = lines.filter(
    (l) => l.total_cop !== SCENARIO_3_PRICE_COP && l.total_cop !== SCENARIO_3_DISCOUNTED_COP
  );

  const { rows: avail } = await seedClient.query(
    "select capacity, booked from product_availability where product_id = $1 and date = $2",
    [SCENARIO_3_CAMP_ID, SCENARIO_3_DATE]
  );
  const bookedMatchesCapacity = avail[0]?.booked === avail[0]?.capacity;

  console.log(
    `  [scénario 3] run ${run}: succès ${successes.length} / ${SCENARIO_3_N} (doit être exactement ${SCENARIO_3_N}), ` +
      `plein tarif ${fullPriceCount} (attendu ${SCENARIO_3_EXPECTED_FULL_PRICE_LINES}), ` +
      `remisées ${discountedCount} (attendu ${SCENARIO_3_EXPECTED_DISCOUNTED_LINES}), ` +
      `total_cop inattendus ${unexpectedTotals.length}, rejets ${rejected.length}`
  );
  if (rejected.length > 0) {
    for (const r of rejected) {
      console.error(`    rejet inattendu (connexion/deadlock ?) : ${r.reason?.message ?? r.reason}`);
    }
  }
  if (failures.length > 0) {
    console.error(`    échecs inattendus (capacité=N, tous devraient réussir) : ${JSON.stringify(failures)}`);
  }
  if (unexpectedTotals.length > 0) {
    console.error(`    total_cop hors des deux valeurs attendues : ${JSON.stringify(unexpectedTotals)}`);
  }

  await endAll(clients);
  await seedClient.end();

  return (
    rejected.length === 0 &&
    successes.length === SCENARIO_3_N &&
    failures.length === 0 &&
    fullPriceCount === SCENARIO_3_EXPECTED_FULL_PRICE_LINES &&
    discountedCount === SCENARIO_3_EXPECTED_DISCOUNTED_LINES &&
    unexpectedTotals.length === 0 &&
    bookedMatchesCapacity
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
    "Scénario 1 — régression (N réservations du même camp, ressource partagée capacité 1)",
    runScenario1Once
  );
  if (!scenario1Ok) return 1;

  const scenario2Ok = await runScenario(
    "Scénario 2 — chevauchement partiel (deux camps aux plages chevauchantes)",
    runScenario2Once
  );
  if (!scenario2Ok) return 1;

  const scenario3Ok = await runScenario(
    "Scénario 3 — remise par seuil de remplissage cumulé sous concurrence réelle",
    runScenario3Once
  );
  if (!scenario3Ok) return 1;

  console.log(
    "\nTous les scénarios ont tenu leurs 5 runs consécutifs propres — create_order (camp multi-jours) validé sous concurrence réelle."
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
