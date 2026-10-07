// create_manual_order_line (evento qui occupe la ressource, migration 20261006203542) contre
// create_order, sur la même ressource partagée de l'établissement, le même jour. Des walk-ins
// saisis par l'operator et des achats en ligne se disputent K places de provider_resource_calendar :
// exactement K succès au total, chacun avec son blocage d'agenda, tout refus en
// `resource_unavailable`, aucun interblocage.
//   1. contre des camps d'un jour (chaque RPC prend product_availability de SON produit, puis la
//      ressource) ;
//   2. contre des achats en ligne du MÊME evento : les deux RPC prennent la même ligne
//      product_availability puis la même ressource — un ordre de verrous différent interbloquerait.
//
// Même squelette que create_order_camp.concurrency.mjs : driver `pg` direct, barrière de
// synchronisation, jamais pgTAP ni Promise.all naïf, jamais de sleep pour synchroniser
// (hifago/CLAUDE.md §6). Contre la stack Supabase locale uniquement (127.0.0.1:54322).
import pg from "pg";

const { Client } = pg;

// Surchargeable par PGURL : ces tests ÉCRIVENT (AGENTS-PARALLELES.md §3).
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5; // barre d'acceptation : ≥5 runs consécutifs propres

// Préfixe UUID dédié à ce fichier (7b710000-…).
const P = "7b710000-0000-4000-8000-";
const OWNER_PARTNER_ID = `${P}000000000001`;
// L'operator appartient à un AUTRE partenaire, opérateur de l'établissement : le propriétaire des
// produits n'a aucun compte de connexion, aucun e-mail « blocage » n'est donc mis en file.
const OPERATOR_PARTNER_ID = `${P}000000000002`;
const ESTABLISHMENT_ID = `${P}000000000011`;
const OPERATOR_ID = `${P}000000000021`;
const CAMP_ID = `${P}000000000031`;
const EVENTO_ID = `${P}000000000032`;
const DATE = "2029-08-01";
const RESOURCE_CAPACITY = 5;
const N_WALK_IN = 10;
const N_CAMP = 10;
const WALK_IN_HOLDER = "Concurrency Evento Walk-in 7b71";
const BUYER_SEGMENT = "8100";
function buyerAccountId(i) {
  return `7b710000-0000-4000-${BUYER_SEGMENT}-${String(i).padStart(12, "0")}`;
}

// Chaque connexion est enregistrée dès son ouverture dans `open`, pour être fermée dans le
// `finally` de runOnce même si une étape suivante échoue.
async function connectOperator(open) {
  const client = new Client({ connectionString: CONNECTION_STRING });
  open.push(client);
  await client.connect();
  await client.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: OPERATOR_ID, role: "authenticated" }),
  ]);
  return client;
}

// Un acheteur par connexion : create_order lit le panier du compte appelant (cart_items).
async function connectBuyer(open, i, productId) {
  const accountId = buyerAccountId(i);
  const client = new Client({ connectionString: CONNECTION_STRING });
  open.push(client);
  await client.connect();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    accountId,
    `concurrency-evento-camp-buyer-${i}@hifago.test`,
  ]);
  await client.query(
    "insert into cart_items (account_id, product_id, date, qty) values ($1, $2, $3, 1)",
    [accountId, productId, DATE]
  );
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
  await Promise.allSettled(clients.map((client) => client.end()));
}

const buyerLike = `7b710000-0000-4000-${BUYER_SEGMENT}-%`;

async function purge(seedClient) {
  const myLines = `select id from order_lines where product_id in (select id from products where establishment_id = $1)`;
  await seedClient.query(
    `delete from notification_emails
      where (related_table = 'order_lines' and related_id in (${myLines}))
         or (related_table = 'orders' and related_id in (select order_id from order_lines where id in (${myLines})))`,
    [ESTABLISHMENT_ID]
  );
  await seedClient.query("delete from availability_blocks where establishment_id = $1", [
    ESTABLISHMENT_ID,
  ]);
  await seedClient.query(`delete from ledger_entries where order_line_id in (${myLines})`, [
    ESTABLISHMENT_ID,
  ]);
  await seedClient.query(
    `delete from order_lines where product_id in (select id from products where establishment_id = $1)`,
    [ESTABLISHMENT_ID]
  );
  await seedClient.query(
    `delete from orders where holder_email = 'reserva-manual@hifago.local' and holder_name = $1
        and id not in (select order_id from order_lines)`,
    [WALK_IN_HOLDER]
  );
  await seedClient.query(`delete from orders where account_id::text like '${buyerLike}'`);
  await seedClient.query(`delete from cart_items where account_id::text like '${buyerLike}'`);
  await seedClient.query(`delete from carts where account_id::text like '${buyerLike}'`);
  await seedClient.query(`delete from partner_accounts where id::text like '${buyerLike}'`);
  await seedClient.query(`delete from auth.users where id::text like '${buyerLike}'`);
  await seedClient.query(
    "delete from product_availability where product_id in (select id from products where establishment_id = $1)",
    [ESTABLISHMENT_ID]
  );
  await seedClient.query("delete from provider_resource_calendar where establishment_id = $1", [
    ESTABLISHMENT_ID,
  ]);
  await seedClient.query("delete from products where establishment_id = $1", [ESTABLISHMENT_ID]);
  await seedClient.query("delete from partner_capabilities where partner_id in ($1, $2)", [
    OWNER_PARTNER_ID,
    OPERATOR_PARTNER_ID,
  ]);
  await seedClient.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  // create_manual_order_line journalise (audit_log.actor_id → partner_accounts, sans cascade).
  await seedClient.query("delete from audit_log where actor_id = $1", [OPERATOR_ID]);
  await seedClient.query("delete from partner_accounts where id = $1", [OPERATOR_ID]);
  await seedClient.query("delete from auth.users where id = $1", [OPERATOR_ID]);
  await seedClient.query("delete from partners where id in ($1, $2)", [
    OWNER_PARTNER_ID,
    OPERATOR_PARTNER_ID,
  ]);
}

async function seed(seedClient) {
  await seedClient.query("insert into partners (id, display_name) values ($1, $2), ($3, $4)", [
    OWNER_PARTNER_ID,
    "Evento vs Camp Concurrency Owner",
    OPERATOR_PARTNER_ID,
    "Evento vs Camp Concurrency Operator",
  ]);
  await seedClient.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID,
    OWNER_PARTNER_ID,
    JSON.stringify({ es: "Evento vs Camp Concurrency Establishment" }),
  ]);
  await seedClient.query("insert into auth.users (id, email) values ($1, $2)", [
    OPERATOR_ID,
    "evento-vs-camp-concurrency-operator@test.local",
  ]);
  // Le trigger de provisioning a créé partner_accounts(id) sans partenaire.
  await seedClient.query("update partner_accounts set partner_id = $1 where id = $2", [
    OPERATOR_PARTNER_ID,
    OPERATOR_ID,
  ]);
  // operator ⇒ referrer (trigger enforce_operator_implies_referrer).
  await seedClient.query(
    "insert into partner_capabilities (partner_id, role, source, status) values ($1, 'referrer', 'migration', 'active')",
    [OPERATOR_PARTNER_ID]
  );
  await seedClient.query(
    `insert into partner_capabilities (partner_id, role, establishment_id, source, status)
     values ($1, 'operator', $2, 'migration', 'active')`,
    [OPERATOR_PARTNER_ID, ESTABLISHMENT_ID]
  );
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, duration_days)
     values ($1, $2, $3, 'camp', jsonb_build_object('es', 'Camp evento vs camp'), 500000, true, $4, 1)`,
    [CAMP_ID, OWNER_PARTNER_ID, ESTABLISHMENT_ID, "evento-vs-camp-concurrency-camp"]
  );
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                           online_bookable, evento_capacity_mode, evento_payment_mode,
                           evento_occupies_resource, default_capacity, occurrence_type, occurrence_date)
     values ($1, $2, $3, 'evento', jsonb_build_object('es', 'Evento evento vs camp'), 30000, true, $4,
             true, 'metered', 'online', true, 100, 'once', $5)`,
    [EVENTO_ID, OWNER_PARTNER_ID, ESTABLISHMENT_ID, "evento-vs-camp-concurrency-evento", DATE]
  );
  // Capacités PROPRES larges (100) : seule la ressource partagée départage les tentatives. Celle
  // de l'evento n'est PAS semée : create_manual_order_line la matérialise (default_capacity).
  await seedClient.query(
    "insert into product_availability (product_id, date, capacity, booked) values ($1, $2, 100, 0)",
    [CAMP_ID, DATE]
  );
  await seedClient.query(
    "insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values ($1, $2, $3, 0)",
    [ESTABLISHMENT_ID, DATE, RESOURCE_CAPACITY]
  );
}

// Les fixtures sont purgées dans le `finally`, y compris sur plantage, interblocage ou mutation.
async function runOnce(run, scenario) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  const open = [];
  try {
    await purge(seedClient);
    await seed(seedClient);
    return await raceAndCheck(run, scenario, seedClient, open);
  } finally {
    await endAll(open);
    await purge(seedClient);
    await seedClient.end();
  }
}

async function raceAndCheck(run, scenario, seedClient, open) {
  const walkInClients = await Promise.all(
    Array.from({ length: N_WALK_IN }, () => connectOperator(open))
  );
  const buyerClients = await Promise.all(
    Array.from({ length: N_CAMP }, (_, i) => connectBuyer(open, i, scenario.buyerProductId))
  );
  const { go, markReady } = makeBarrier(N_WALK_IN + N_CAMP);

  // Un interblocage non résolu dépasserait de loin le deadlock_timeout (1 s).
  const timeoutMs = 15000;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timeout après ${timeoutMs}ms (interblocage suspecté)`)),
      timeoutMs
    );
  });

  let walkInSettled, campSettled;
  try {
    [walkInSettled, campSettled] = await Promise.race([
      Promise.all([
        Promise.allSettled(
          walkInClients.map(async (client) => {
            markReady();
            await go;
            const res = await client.query(
              "select create_manual_order_line($1, $2, $3, $4) as result",
              [EVENTO_ID, DATE, 1, WALK_IN_HOLDER]
            );
            return res.rows[0].result;
          })
        ),
        Promise.allSettled(
          buyerClients.map(async (client) => {
            markReady();
            await go;
            const res = await client.query("select create_order($1, $2, $3, $4) as result", [
              "Concurrency Evento Camp Buyer",
              "concurrency-evento-camp-buyer@hifago.test",
              null,
              false,
            ]);
            return res.rows[0].result;
          })
        ),
      ]),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }

  const settled = [...walkInSettled, ...campSettled];
  const rejected = settled.filter((s) => s.status === "rejected");
  const results = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  const walkInOk = walkInSettled.filter(
    (s) => s.status === "fulfilled" && s.value.ok === true
  ).length;
  const buyerOk = campSettled.filter((s) => s.status === "fulfilled" && s.value.ok === true).length;
  // Scénario 2 : les deux côtés réservent l'evento — un seul compteur produit pour tous.
  const campOk = scenario.buyerProductId === CAMP_ID ? buyerOk : 0;
  const eventoOk = scenario.buyerProductId === CAMP_ID ? walkInOk : walkInOk + buyerOk;
  const unexpected = results.filter((r) => r.ok !== true && r.reason !== "resource_unavailable");

  const { rows: resource } = await seedClient.query(
    "select capacity, booked from provider_resource_calendar where establishment_id = $1 and slot_date = $2",
    [ESTABLISHMENT_ID, DATE]
  );
  const { rows: counters } = await seedClient.query(
    "select product_id, booked from product_availability where product_id in ($1, $2)",
    [CAMP_ID, EVENTO_ID]
  );
  const bookedOf = (id) => counters.find((c) => c.product_id === id)?.booked ?? null;
  // Chaque ligne vivante qui occupe la ressource porte exactement un blocage d'un jour.
  const { rows: lines } = await seedClient.query(
    `select ol.product_id, ol.qty,
            (select count(*)::int from availability_blocks ab
              where ab.source_order_line_id = ol.id and ab.start_date = ol.date and ab.end_date = ol.date) as blocks
       from order_lines ol
      where ol.status = 'reserved' and ol.product_id in ($1, $2)`,
    [CAMP_ID, EVENTO_ID]
  );
  const { rows: allBlocks } = await seedClient.query(
    "select count(*)::int as n from availability_blocks where establishment_id = $1",
    [ESTABLISHMENT_ID]
  );
  const reservedQty = lines.reduce((sum, l) => sum + l.qty, 0);

  console.log(
    `  [${scenario.label}] run ${run}: walk-ins ${walkInOk}/${N_WALK_IN}, en ligne ${buyerOk}/${N_CAMP} ` +
      `(total ${walkInOk + buyerOk}, doit être ${RESOURCE_CAPACITY}), rejets ${rejected.length}, ` +
      `ressource ${resource[0]?.booked}/${resource[0]?.capacity}, qty réservée ${reservedQty}, ` +
      `blocages ${allBlocks[0].n}, compteur evento ${bookedOf(EVENTO_ID)}, compteur camp ${bookedOf(CAMP_ID)}`
  );
  for (const r of rejected) {
    console.error(`    rejet inattendu (interblocage, 23514 ?) : ${r.reason?.message ?? r.reason}`);
  }
  if (unexpected.length > 0) {
    console.error(`    raisons inattendues : ${JSON.stringify(unexpected)}`);
  }

  return (
    rejected.length === 0 &&
    unexpected.length === 0 &&
    walkInOk + buyerOk === RESOURCE_CAPACITY &&
    resource[0]?.booked === RESOURCE_CAPACITY &&
    reservedQty === RESOURCE_CAPACITY &&
    lines.length === walkInOk + buyerOk &&
    lines.every((l) => l.blocks === 1) &&
    allBlocks[0].n === lines.length &&
    bookedOf(EVENTO_ID) === eventoOk &&
    bookedOf(CAMP_ID) === campOk
  );
}

const SCENARIOS = [
  { label: "scénario 1 : camp", buyerProductId: CAMP_ID },
  { label: "scénario 2 : même evento en ligne", buyerProductId: EVENTO_ID },
];

async function main() {
  console.log(
    `\n=== create_manual_order_line (evento occupant) contre create_order — ressource ${RESOURCE_CAPACITY}, ` +
      `${N_WALK_IN}+${N_CAMP} tentatives, ${RUNS} runs consécutifs requis par scénario ===`
  );
  for (const scenario of SCENARIOS) {
    for (let run = 1; run <= RUNS; run++) {
      let clean;
      try {
        clean = await runOnce(run, scenario);
      } catch (err) {
        console.error(`  [${scenario.label}] run ${run} a levé une erreur : ${err.message}`);
        clean = false;
      }
      if (!clean) {
        console.error(
          `\nÉCHEC — ${scenario.label}, run ${run}/${RUNS}. Zéro tolérance à un échec isolé.`
        );
        process.exit(1);
      }
    }
  }
  console.log(
    `\n${RUNS} runs consécutifs propres par scénario — walk-ins et achats en ligne se partagent la ressource sans survente ni interblocage.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
