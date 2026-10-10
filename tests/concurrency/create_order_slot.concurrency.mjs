// Spec 18 Tranche 1 (docs/specs/18-creneaux-horaires-reservables.md) — anti-survente réelle de la
// 4e branche de create_order (créneau horaire, product_slot_availability). Même risque combiné que
// create_order_default_capacity.concurrency.mjs (matérialisation avant verrouillage, jamais seedée
// à l'avance — deux premières réservations simultanées d'un créneau JAMAIS configuré doivent quand
// même se sérialiser via ON CONFLICT DO NOTHING + unique(product_id, slot_date, slot_start_time))
// ET du scénario 1 de create_order.concurrency.mjs (plafond réel à capacité > 1, pas seulement la
// course de matérialisation) : capacité=5, N=20 tentatives concurrentes du MÊME créneau, exactement
// 5 succès attendus.
//
// Même squelette que les autres fichiers de ce dossier : driver `pg` direct, barrière de
// synchronisation, jamais pgTAP ni Promise.all naïf, jamais de sleep pour synchroniser (cf.
// hifago/CLAUDE.md §6). Contre la stack Supabase locale uniquement (127.0.0.1:54322) — jamais un
// projet cloud partagé.
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

// Préfixe UUID dédié à ce fichier (91000000-…) — ne collisionne avec aucun préfixe déjà utilisé par
// seed.sql (a0000000-…/b0000000-…) ni les autres tests de concurrence (00000000-…/20000000-…/
// 60000000-…/70000000-…/80000000-…/90000000-…/99990000-…).
const PARTNER_ID = "91000000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "91000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "91000000-0000-4000-8000-000000000010";
const DATE = "2029-05-01";
const SLOT_START_TIME = "09:00";
const CAPACITY = 5;
const N = 20; // tentatives concurrentes visant le même créneau jamais configuré
// Segment dédié aux comptes ACHETEURS (distinct du vendeur) : un par connexion concurrente,
// jamais partagé — cf. note de réécriture en tête de fichier.
const BUYER_ID_SEGMENT = "8100";
function buyerAccountId(i) {
  return `91000000-0000-4000-${BUYER_ID_SEGMENT}-${String(i).padStart(12, "0")}`;
}

// Connecte UN acheteur : identité propre (auth.users, donc partner_accounts via le trigger de
// provisioning), son panier déjà posé en base (cart_items — slot_start_time compris), puis le JWT
// qui le fait reconnaître comme lui-même par auth.uid().
async function connectBuyer(i, cartLines) {
  const accountId = buyerAccountId(i);
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    accountId,
    `concurrency-slot-buyer-${i}@hifago.test`,
  ]);
  for (const line of cartLines) {
    await client.query(
      "insert into cart_items (account_id, product_id, date, slot_start_time, qty) values ($1, $2, $3, $4, $5)",
      [accountId, line.product_id, line.date, line.slot_start_time ?? null, line.qty]
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
    `delete from orders where account_id::text like '91000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from cart_items where account_id::text like '91000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from carts where account_id::text like '91000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from partner_accounts where id::text like '91000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from auth.users where id::text like '91000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from product_slot_availability
      where product_id in (select id from products where establishment_id = $1)`,
    [ESTABLISHMENT_ID]
  );
  await seedClient.query(
    `delete from product_slot_rules
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
    "Create Order Slot Concurrency Partner",
  ]);
  await seedClient.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID,
    PARTNER_ID,
    JSON.stringify({ es: "Create Order Slot Concurrency Establishment" }),
  ]);
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values ($1, $2, $3, 'activity', jsonb_build_object('es', 'Slot concurrency activity'),
             50000, true, $4)`,
    [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID, "slot-concurrency-activity"]
  );
  // Règle couvrant tous les jours de la semaine — le jour réel de DATE n'a aucune importance ici,
  // seul compte le créneau 09:00-10:00/60min qu'elle génère (capacité CAPACITY).
  await seedClient.query(
    `insert into product_slot_rules (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity)
     values ($1, array[1,2,3,4,5,6,7]::smallint[], '09:00', '10:00', 60, $2)`,
    [PRODUCT_ID, CAPACITY]
  );
  // AUCUNE ligne product_slot_availability semée ici, volontairement — c'est exactement le scénario
  // ciblé : la toute première réservation d'un créneau jamais matérialisé, sous concurrence réelle.
}

async function runOnce(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetAndSeed(seedClient);

  const cart = [{ product_id: PRODUCT_ID, date: DATE, slot_start_time: SLOT_START_TIME, qty: 1 }];
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

  // Exactement UNE ligne product_slot_availability doit avoir été matérialisée pour
  // (PRODUCT_ID, DATE, SLOT_START_TIME) — deux INSERT concurrents en conflit sur la même clé
  // (product_id, slot_date, slot_start_time) prouveraient que la matérialisation elle-même a dérivé
  // (jamais censé arriver : ON CONFLICT DO NOTHING + unicité), et son booked doit refléter
  // exactement le nombre de succès (jamais plus que CAPACITY).
  const { rows: state } = await seedClient.query(
    `select capacity, booked from product_slot_availability
      where product_id = $1 and slot_date = $2 and slot_start_time = $3`,
    [PRODUCT_ID, DATE, SLOT_START_TIME]
  );
  const materializedOnce = state.length === 1;
  const bookedMatchesSuccesses =
    materializedOnce && state[0].capacity === CAPACITY && state[0].booked === successes.length;

  console.log(
    `  run ${run}: succès ${successes.length} / ${N} (doit être exactement ${CAPACITY}), ` +
      `échecs ${failures.length} (raison attendue: 'full'), rejets réseau/driver ${rejected.length}, ` +
      `lignes product_slot_availability matérialisées=${state.length} (doit être 1), ` +
      `booked=${state[0]?.booked} capacity=${state[0]?.capacity} (attendu ${CAPACITY})`
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
      `    matérialisation dérivée : ${state.length} ligne(s) product_slot_availability au lieu de 1`
    );
  }

  await endAll(clients);
  await seedClient.end();

  return (
    rejected.length === 0 &&
    successes.length === CAPACITY &&
    unexpectedFailureReasons.length === 0 &&
    bookedMatchesSuccesses
  );
}

async function runAll() {
  console.log(
    `\n=== create_order — créneau horaire sous concurrence (N=${N}, capacité=${CAPACITY}, ${RUNS} runs consécutifs requis) ===`
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
    `\n${RUNS} runs consécutifs propres — branche créneau horaire de create_order validée sous concurrence réelle (aucune survente, aucun conflit de matérialisation).`
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
