// Test de concurrence réelle du déclencheur products_realign_lodging_nights (20261024150000) : un
// admin baisse le « Cupo diario por defecto » d'un logement PENDANT que N clients réservent la même
// plage de nuits. Même squelette que set_product_availability.concurrency.mjs (driver `pg` direct,
// barrière de synchronisation, ordre de reprise mélangé — jamais pgTAP ni sleep, CLAUDE.md §6).
//
// Ce qui est vérifié à chaque run, quelle que soit l'interposition réelle :
//   - booked <= capacity sur chaque nuit (aucune survente) ;
//   - capacity = max(nouveau cupo, booked) sur chaque nuit : le réalignement a bien eu lieu, et
//     n'est jamais descendu sous ce qui était déjà vendu ;
//   - booked = nombre de réservations acceptées (le compteur n'a pas dérivé) ;
//   - l'UPDATE de l'admin réussit toujours (aucun interblocage avec create_order) et les refus des
//     acheteurs sont tous 'full'.
//
// L'admin écrit sous le rôle `authenticated`, comme l'écran d'édition (`products.update` sous RLS) :
// c'est aussi la preuve que le déclencheur écrit product_availability (RPC-only) par ses propres
// droits, et non par ceux de l'appelant.
//
// Contre la stack Supabase locale uniquement (127.0.0.1:54322) — jamais un projet cloud partagé.
import pg from "pg";

const { Client } = pg;

// Surchargeable par PGURL : ces tests ÉCRIVENT (cf. AGENTS-PARALLELES.md §3).
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const N = 10; // acheteurs concurrents
const RUNS = 5;

// Préfixe UUID dédié (7a120000-…), distinct des autres fichiers de ce dossier.
const PARTNER_ID = "7a120000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "7a120000-0000-4000-8000-000000000002";
const ADMIN_ID = "7a120000-0000-4000-8000-000000000003";
const PRODUCT_ID = "7a120000-0000-4000-8000-000000000004";
const INITIAL_DEFAULT = 5; // 5 chambres privées, cupo par défaut 5
const NEW_DEFAULT = 2; // l'admin le ramène à 2 pendant les réservations
const NIGHTS = 2;

function buyerAccountId(i) {
  return `7a120000-0000-4000-8000-0000000001${i.toString(16).padStart(2, "0")}`;
}
const BUYER_IDS = Array.from({ length: N }, (_, i) => buyerAccountId(i));

async function purgeFixtures(seedClient) {
  await seedClient.query("delete from order_lines where product_id = $1", [PRODUCT_ID]);
  await seedClient.query(
    `delete from orders where account_id = any($1::uuid[])
       and id not in (select order_id from order_lines)`,
    [BUYER_IDS]
  );
  await seedClient.query("delete from cart_items where account_id = any($1::uuid[])", [BUYER_IDS]);
  await seedClient.query("delete from carts where account_id = any($1::uuid[])", [BUYER_IDS]);
  await seedClient.query("delete from product_availability where product_id = $1", [PRODUCT_ID]);
  await seedClient.query("delete from product_calendar where product_id = $1", [PRODUCT_ID]);
  await seedClient.query("delete from products where id = $1", [PRODUCT_ID]);
  await seedClient.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await seedClient.query("delete from audit_log where actor_id = $1", [ADMIN_ID]);
  await seedClient.query("delete from partner_capabilities where account_id = $1", [ADMIN_ID]);
  await seedClient.query("delete from partner_accounts where id = any($1::uuid[])", [
    [...BUYER_IDS, ADMIN_ID],
  ]);
  await seedClient.query("delete from partners where id = $1", [PARTNER_ID]);
  await seedClient.query("delete from auth.users where id = any($1::uuid[])", [
    [...BUYER_IDS, ADMIN_ID],
  ]);
}

// Les nuits sont posées à J+20 à Guatapé : dans l'horizon, jamais dans le passé, et dans la
// fenêtre que le déclencheur réaligne (date >= today_in_bogota()).
async function resetFixtures(seedClient) {
  await purgeFixtures(seedClient);

  await seedClient.query("insert into auth.users (id, email) values ($1, $2)", [
    ADMIN_ID,
    "realign-nights-admin@test.local",
  ]);
  for (const [i, buyerId] of BUYER_IDS.entries()) {
    await seedClient.query("insert into auth.users (id, email) values ($1, $2)", [
      buyerId,
      `realign-nights-buyer-${i}@test.local`,
    ]);
  }
  await seedClient.query("insert into partners (id, display_name) values ($1, $2)", [
    PARTNER_ID,
    "Realign Lodging Nights Concurrency Partner",
  ]);
  await seedClient.query(
    "insert into partner_capabilities (account_id, role, source, status) values ($1, 'admin', 'migration', 'active')",
    [ADMIN_ID]
  );
  await seedClient.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID,
    PARTNER_ID,
    JSON.stringify({ es: "Realign Lodging Nights Concurrency Establishment" }),
  ]);
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                           lodging_kind, unit_count, capacity, default_capacity, min_qty, max_qty)
     values ($1, $2, $3, 'lodging', jsonb_build_object('es', 'Realign nights'), 100000, true, $4,
             'private', $5, 2, $5, 1, 1)`,
    [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID, "realign-nights-concurrency", INITIAL_DEFAULT]
  );
  const { rows } = await seedClient.query(
    `insert into product_availability (product_id, date, capacity, booked)
     select $1, public.today_in_bogota() + 20 + n, $2, 0 from generate_series(0, $3 - 1) as n
     returning to_char(date, 'YYYY-MM-DD') as date`,
    [PRODUCT_ID, INITIAL_DEFAULT, NIGHTS]
  );
  const dates = rows.map((row) => row.date).sort();
  const { rows: fin } = await seedClient.query(
    "select to_char($1::date + $2::int, 'YYYY-MM-DD') as end_date",
    [dates[0], NIGHTS]
  );
  return { startDate: dates[0], endDate: fin[0].end_date };
}

function shuffle(array) {
  // Sans mélange, l'admin (inscrit en dernier) perdrait toujours la course : pas une vraie
  // concurrence entre les deux types d'opération.
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function buyerClient(accountId) {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  await client.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: accountId, role: "authenticated" }),
  ]);
  return client;
}

// L'admin passe par le rôle `authenticated` et la RLS de `products`, comme l'écran d'édition.
async function adminClient() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  await client.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: ADMIN_ID, role: "authenticated" }),
  ]);
  await client.query("set role authenticated");
  return client;
}

const TIMEOUT_MS = 15000;
function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} : timeout après ${TIMEOUT_MS}ms (interblocage suspecté)`)), TIMEOUT_MS)
    ),
  ]);
}

async function runOnce(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  const { startDate, endDate } = await resetFixtures(seedClient);

  for (const buyerId of BUYER_IDS) {
    await seedClient.query(
      "insert into cart_items (account_id, product_id, date, end_date, qty) values ($1, $2, $3, $4, 1)",
      [buyerId, PRODUCT_ID, startDate, endDate]
    );
  }

  const buyers = await Promise.all(BUYER_IDS.map((id) => buyerClient(id)));
  const admin = await adminClient();
  const workers = shuffle([
    ...buyers.map((client) => ({ type: "buyer", client })),
    { type: "admin", client: admin },
  ]);

  let readyCount = 0;
  let resolveGo;
  const go = new Promise((resolve) => {
    resolveGo = resolve;
  });
  function markReady() {
    if (++readyCount === workers.length) resolveGo();
  }

  const settled = await withTimeout(
    Promise.allSettled(
      workers.map(async (worker) => {
        markReady();
        await go;
        if (worker.type === "buyer") {
          const res = await worker.client.query("select create_order($1, $2, $3, $4) as result", [
            "Realign Buyer",
            "realign-buyer@hifago.test",
            null,
            false,
          ]);
          return { type: "buyer", result: res.rows[0].result };
        }
        const res = await worker.client.query(
          "update products set default_capacity = $1 where id = $2",
          [NEW_DEFAULT, PRODUCT_ID]
        );
        return { type: "admin", updated: res.rowCount };
      })
    ),
    `run ${run}`
  );

  const rejected = settled.filter((s) => s.status === "rejected");
  const outcomes = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  const buyerResults = outcomes.filter((o) => o.type === "buyer").map((o) => o.result);
  const successes = buyerResults.filter((r) => r.ok === true).length;
  const unexpected = buyerResults.filter((r) => r.ok === false && r.reason !== "full");
  const adminOutcome = outcomes.find((o) => o.type === "admin");

  const { rows: state } = await seedClient.query(
    `select to_char(date, 'YYYY-MM-DD') as date, capacity, booked
       from product_availability where product_id = $1 order by date`,
    [PRODUCT_ID]
  );
  const noOversell = state.every((row) => row.booked <= row.capacity);
  const realigned = state.every((row) => row.capacity === Math.max(NEW_DEFAULT, row.booked));
  const counterMatches = state.every((row) => row.booked === successes);

  console.log(
    `  run ${run}: ${successes}/${N} réservations acceptées, admin=${adminOutcome?.updated === 1 ? "appliqué" : "ÉCHEC"}, ` +
      `nuits ${state.map((r) => `${r.date} ${r.booked}/${r.capacity}`).join(", ")}` +
      (noOversell ? "" : " — SURVENTE DÉTECTÉE") +
      (realigned ? "" : " — RÉALIGNEMENT INCORRECT") +
      (counterMatches ? "" : " — COMPTEUR INCOHÉRENT")
  );
  for (const r of rejected) console.error(`    rejet inattendu : ${r.reason?.message ?? r.reason}`);
  if (unexpected.length > 0) console.error(`    refus inattendus : ${JSON.stringify(unexpected)}`);

  await Promise.all([...buyers, admin].map((client) => client.end()));
  await seedClient.end();

  return (
    rejected.length === 0 &&
    unexpected.length === 0 &&
    adminOutcome?.updated === 1 &&
    noOversell &&
    realigned &&
    counterMatches &&
    successes >= NEW_DEFAULT
  );
}

// --- Scénario 2 : l'admin baisse le cupo APRÈS des ventes, pendant qu'une réservation tient le verrou.
//
// La course libre ci-dessus est presque toujours gagnée par l'admin (un UPDATE est bien plus court
// que create_order) : elle ne prouve donc pas le cas qui compte, celui où des nuits sont DÉJÀ vendues
// au-dessus du nouveau cupo. Ce scénario le force, sans sleep : 3 ventes validées, une 4ᵉ ouverte
// (verrou tenu, `booked` à 4 non encore validé), l'UPDATE de l'admin lancé et observé EN ATTENTE de
// ce verrou (pg_stat_activity), puis la 4ᵉ validée. Le déclencheur doit relire `booked` APRÈS le
// verrou : capacity = max(2, 4) = 4. S'il lisait l'état d'avant (3), la contrainte
// booked <= capacity ferait échouer l'enregistrement de l'admin.
const SOLD_BEFORE = 3;

async function waitForLockWait(seedClient, pid) {
  for (let essai = 0; essai < 200; essai++) {
    const { rows } = await seedClient.query(
      "select count(*)::int as n from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'",
      [pid]
    );
    if (rows[0].n === 1) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function runHeldLockOnce(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  const { startDate, endDate } = await resetFixtures(seedClient);
  for (const buyerId of BUYER_IDS) {
    await seedClient.query(
      "insert into cart_items (account_id, product_id, date, end_date, qty) values ($1, $2, $3, $4, 1)",
      [buyerId, PRODUCT_ID, startDate, endDate]
    );
  }

  const buyers = await Promise.all(BUYER_IDS.map((id) => buyerClient(id)));
  const admin = await adminClient();
  const { rows: pidRows } = await admin.query("select pg_backend_pid() as pid");
  const order = (client) =>
    client.query("select create_order($1, $2, $3, $4) as result", [
      "Realign Buyer",
      "realign-buyer@hifago.test",
      null,
      false,
    ]);

  let clean = true;
  const fail = (message) => {
    console.error(`    ${message}`);
    clean = false;
  };

  for (let i = 0; i < SOLD_BEFORE; i++) {
    const res = await order(buyers[i]);
    if (!res.rows[0].result.ok) fail(`vente préalable ${i} refusée : ${JSON.stringify(res.rows[0].result)}`);
  }

  const holder = buyers[SOLD_BEFORE];
  await holder.query("begin");
  const held = await order(holder);
  if (!held.rows[0].result.ok) fail(`réservation tenue refusée : ${JSON.stringify(held.rows[0].result)}`);

  const adminUpdate = admin.query("update products set default_capacity = $1 where id = $2", [
    NEW_DEFAULT,
    PRODUCT_ID,
  ]);
  const waited = await waitForLockWait(seedClient, pidRows[0].pid);
  if (!waited) fail("l'UPDATE de l'admin n'a jamais attendu le verrou de la réservation ouverte");
  await holder.query("commit");

  let adminOk = true;
  try {
    const res = await withTimeout(adminUpdate, `scénario 2 run ${run}`);
    if (res.rowCount !== 1) adminOk = false;
  } catch (err) {
    adminOk = false;
    fail(`UPDATE de l'admin en échec : ${err.message}`);
  }

  // Les acheteurs restants arrivent tous ensemble sur des nuits pleines (4/4).
  const rest = buyers.slice(SOLD_BEFORE + 1);
  let readyCount = 0;
  let resolveGo;
  const go = new Promise((resolve) => {
    resolveGo = resolve;
  });
  const late = await withTimeout(
    Promise.all(
      rest.map(async (client) => {
        if (++readyCount === rest.length) resolveGo();
        await go;
        return (await order(client)).rows[0].result;
      })
    ),
    `scénario 2 run ${run} (acheteurs tardifs)`
  );
  const lateAccepted = late.filter((r) => r.ok).length;
  const lateUnexpected = late.filter((r) => !r.ok && r.reason !== "full");

  const { rows: state } = await seedClient.query(
    `select to_char(date, 'YYYY-MM-DD') as date, capacity, booked
       from product_availability where product_id = $1 order by date`,
    [PRODUCT_ID]
  );
  const sold = SOLD_BEFORE + 1;
  const exact = state.every((row) => row.booked === sold && row.capacity === Math.max(NEW_DEFAULT, sold));

  console.log(
    `  run ${run}: ${sold} vendues avant/pendant, admin=${adminOk ? "appliqué après attente" : "ÉCHEC"}, ` +
      `tardifs acceptés ${lateAccepted}/${rest.length}, nuits ${state.map((r) => `${r.date} ${r.booked}/${r.capacity}`).join(", ")}` +
      (exact ? "" : " — ÉTAT FINAL INATTENDU")
  );
  if (lateUnexpected.length > 0) fail(`refus inattendus : ${JSON.stringify(lateUnexpected)}`);

  await Promise.all([...buyers, admin].map((client) => client.end()));
  await seedClient.end();

  return clean && adminOk && waited && exact && lateAccepted === 0 && lateUnexpected.length === 0;
}

async function runScenario(name, runOnceFn) {
  console.log(`\n=== ${name} — ${RUNS} runs consécutifs requis ===`);
  for (let run = 1; run <= RUNS; run++) {
    let clean;
    try {
      clean = await runOnceFn(run);
    } catch (err) {
      console.error(`  run ${run} a levé une erreur : ${err.message}`);
      clean = false;
    }
    if (!clean) {
      console.error(`\nÉCHEC — ${name}, run ${run}/${RUNS}. Zéro tolérance à un échec isolé.`);
      return false;
    }
  }
  console.log(`  ${RUNS} runs consécutifs propres.`);
  return true;
}

async function runAll() {
  const libre = await runScenario(
    "Scénario 1 — course libre : l'admin baisse le cupo pendant que 10 clients réservent",
    runOnce
  );
  if (!libre) return 1;
  const tenu = await runScenario(
    "Scénario 2 — après 3 ventes, pendant qu'une 4ᵉ tient le verrou",
    runHeldLockOnce
  );
  if (!tenu) return 1;
  console.log("\nAucune survente, réalignement toujours correct, jamais sous ce qui est vendu.");
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

// Codes de sortie RENDUS par runAll : un `process.exit` en cours de route sauterait la purge finale.
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
