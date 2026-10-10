// Spec 20 §0 (docs/specs/20-agenda-reservations-socio.md) — anti-survente réelle de
// create_manual_order_line, branche date unique/default_capacity. Même risque combiné que
// create_order_default_capacity.concurrency.mjs (matérialisation product_availability AVANT
// verrouillage, jamais seedée à l'avance — deux premières réservations manuelles simultanées d'un
// jour JAMAIS configuré doivent quand même se sérialiser via ON CONFLICT DO NOTHING +
// unique(product_id, date)) : capacité=1, N=20 tentatives concurrentes, exactement 1 succès.
// Différence avec create_order : l'appelant est un OPERATOR authentifié (has_capability), pas un
// acheteur — la RPC est plus étroite (pas de p_lines, une seule ligne par appel).
//
// Même squelette que les autres fichiers de ce dossier : driver `pg` direct, barrière de
// synchronisation, jamais pgTAP ni Promise.all naïf, jamais de sleep pour synchroniser (cf.
// hifago/CLAUDE.md §6). Contre la stack Supabase locale uniquement (127.0.0.1:54322) — jamais un
// projet cloud partagé.
import pg from "pg";

const { Client } = pg;

// Surchargeable par PGURL : ces tests ÉCRIVENT. Les pointer ailleurs que sur la stack locale
// partagée est le seul moyen de les vérifier sans écraser le travail d'une autre session
// (cf. AGENTS-PARALLELES.md §3). Défaut inchangé : la stack locale.
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5; // barre d'acceptation : ≥5 runs consécutifs propres

// Préfixe UUID dédié à ce fichier (92000000-…) — ne collisionne avec aucun préfixe déjà utilisé par
// seed.sql (a0000000-…/b0000000-…) ni les autres tests de concurrence (00000000-…/20000000-…/
// 60000000-…/70000000-…/80000000-…/90000000-…/91000000-…/99990000-…).
const PARTNER_ID = "92000000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "92000000-0000-4000-8000-000000000002";
const OPERATOR_ID = "92000000-0000-4000-8000-000000000003";
const PRODUCT_ID = "92000000-0000-4000-8000-000000000010";
const DATE = "2029-06-01";
const DEFAULT_CAPACITY = 1;
const N = 20; // tentatives concurrentes visant la même date jamais configurée

async function connectAuthenticated(count) {
  return Promise.all(
    Array.from({ length: count }, async () => {
      const client = new Client({ connectionString: CONNECTION_STRING });
      await client.connect();
      await client.query("select set_config('request.jwt.claims', $1, false)", [
        JSON.stringify({ sub: OPERATOR_ID, role: "authenticated" }),
      ]);
      return client;
    })
  );
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
  await seedClient.query(
    `delete from orders where holder_email = 'reserva-manual@hifago.local'
      and id not in (select order_id from order_lines)`
  );
  await seedClient.query(
    `delete from product_availability
      where product_id in (select id from products where establishment_id = $1)`,
    [ESTABLISHMENT_ID]
  );
  await seedClient.query("delete from products where establishment_id = $1", [ESTABLISHMENT_ID]);
  await seedClient.query("delete from partner_capabilities where partner_id = $1", [PARTNER_ID]);
  await seedClient.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  // create_manual_order_line journalise dans audit_log (actor_id → partner_accounts, FK sans
  // cascade) — à purger avant de supprimer le compte, sinon la 2e itération échoue.
  await seedClient.query("delete from audit_log where actor_id = $1", [OPERATOR_ID]);
  await seedClient.query("delete from partner_accounts where id = $1", [OPERATOR_ID]);
  await seedClient.query("delete from partners where id = $1", [PARTNER_ID]);
  await seedClient.query("delete from auth.users where id = $1", [OPERATOR_ID]);
}

async function resetAndSeed(seedClient) {
  await purgeFixtures(seedClient);

  await seedClient.query("insert into auth.users (id, email) values ($1, $2)", [
    OPERATOR_ID,
    "create-manual-order-line-default-capacity-concurrency@test.local",
  ]);
  await seedClient.query("insert into partners (id, display_name) values ($1, $2)", [
    PARTNER_ID,
    "Manual Order Line Default Capacity Concurrency Partner",
  ]);
  // Trigger on_auth_user_created provisionne déjà partner_accounts(id) avec partner_id null — UPDATE.
  await seedClient.query("update partner_accounts set partner_id = $1 where id = $2", [
    PARTNER_ID,
    OPERATOR_ID,
  ]);
  await seedClient.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID,
    PARTNER_ID,
    JSON.stringify({ es: "Manual Order Line Default Capacity Concurrency Establishment" }),
  ]);
  // operator ⇒ referrer (trigger enforce_operator_implies_referrer) : capacité referrer active
  // requise avant toute capacité operator sur le même partner_id.
  await seedClient.query(
    "insert into partner_capabilities (partner_id, role, source, status) values ($1, 'referrer', 'migration', 'active')",
    [PARTNER_ID]
  );
  await seedClient.query(
    `insert into partner_capabilities (partner_id, role, establishment_id, source, status)
     values ($1, 'operator', $2, 'migration', 'active')`,
    [PARTNER_ID, ESTABLISHMENT_ID]
  );
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                           default_capacity)
     values ($1, $2, $3, 'activity', jsonb_build_object('es', 'Manual default capacity concurrency slot'),
             50000, true, $4, $5)`,
    [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID, "manual-default-capacity-concurrency-slot", DEFAULT_CAPACITY]
  );
  // AUCUNE ligne product_availability semée ici, volontairement — c'est exactement le scénario
  // ciblé : la toute première réservation manuelle d'un jour jamais configuré, sous concurrence
  // réelle.
}

async function runOnce(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetAndSeed(seedClient);

  const clients = await connectAuthenticated(N);
  const { go, markReady } = makeBarrier(N);

  const settled = await Promise.allSettled(
    clients.map(async (client) => {
      markReady();
      await go;
      const res = await client.query(
        "select create_manual_order_line($1, $2, $3, $4, $5, $6, $7) as result",
        [PRODUCT_ID, DATE, 1, "Concurrency Walk-in", null, null, "Test de concurrence"]
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
    `\n=== create_manual_order_line — matérialisation default_capacity sous concurrence (N=${N}, ${RUNS} runs consécutifs requis) ===`
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
    `\n${RUNS} runs consécutifs propres — matérialisation par défaut de create_manual_order_line validée sous concurrence réelle (aucune survente, aucun conflit de matérialisation).`
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
