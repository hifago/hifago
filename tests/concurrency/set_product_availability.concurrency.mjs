// Test de concurrence réelle du correctif Tranche 2/3 — même squelette à barrière que
// create_order.concurrency.mjs (driver `pg` direct, jamais pgTAP ni Promise.all naïf, cf.
// hifago/CLAUDE.md §6). Le côté acheteur appelle create_order (feature 6, remplace
// reserve_order_line) avec un panier à 1 ligne — même invariant testé, deux TYPES d'opérations
// concurrentes coexistent ici légitimement : un admin qui descend la capacité pendant que N
// clients réservent simultanément la même ressource. Pas de nombre de succès fixe attendu — le
// seul invariant vérifié est booked <= capacity dans l'état final, quelle que soit
// l'interposition réelle des deux opérations (les deux se sérialisent sur le même verrou FOR
// UPDATE de product_availability).
//
// ⚠️ Réécrit le 2026-09-10 (spec 32, panier en base) : create_order ne reçoit plus les lignes en
// paramètre, il les lit dans cart_items pour SON PROPRE account_id. Ce fichier avait déjà N
// identités acheteuses distinctes (contrairement aux autres fichiers de ce dossier), donc pas de
// restructuration de fond — juste le panier posé en base avant l'appel, et la nouvelle signature.
//
// Contre la stack Supabase locale uniquement (127.0.0.1:54322) — jamais un projet cloud partagé.
import pg from "pg";

const { Client } = pg;

// Surchargeable par PGURL : ces tests ÉCRIVENT. Les pointer ailleurs que sur la stack locale
// partagée est le seul moyen de les vérifier sans écraser le travail d'une autre session
// (cf. AGENTS-PARALLELES.md §3). Défaut inchangé : la stack locale.
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const N = 10; // clients concurrents tentant de réserver la même ressource
const RUNS = 5; // barre d'acceptation : ≥5 runs consécutifs propres

const PARTNER_ID = "20000000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "20000000-0000-4000-8000-000000000002";
const ADMIN_ID = "20000000-0000-4000-8000-000000000003";
const PRODUCT_ID = "20000000-0000-4000-8000-000000000004";
const SLOT_DATE = "2027-04-01";
const INITIAL_CAPACITY = 5;
const NEW_CAPACITY = 2;

function buyerAccountId(i) {
  return `20000000-0000-4000-8000-0000000001${i.toString(16).padStart(2, "0")}`;
}

const BUYER_IDS = Array.from({ length: N }, (_, i) => buyerAccountId(i));

// Purge des fixtures de ce fichier — avant chaque run (par le reset ci-dessous) ET une dernière fois
// en fin de fichier, quoi qu'il arrive (audit P12e, 2026-10-06). Sans la seconde, le dernier run
// laissait ses lignes en base : sur la pile locale partagée comme en CI, où le job `concurrence`
// compare désormais les comptes de lignes avant/après.
async function purgeFixtures(seedClient) {
  // Ordre imposé par les FK : lignes/commandes d'abord, puis la ressource, puis l'identité.
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
  // set_product_availability journalise via log_admin_action (audit_log, immuable pour tout rôle
  // applicatif — mais ce nettoyage tourne en tant que postgres, qui contourne RLS comme les
  // autres deletes ci-dessus) : sans ce nettoyage, un run précédent où l'admin a réussi laisse
  // une ligne audit_log qui bloque ensuite la suppression de auth.users (FK).
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

async function resetFixtures(seedClient) {
  await purgeFixtures(seedClient);

  await seedClient.query("insert into auth.users (id, email) values ($1, $2)", [
    ADMIN_ID,
    "set-availability-admin@test.local",
  ]);
  for (const [i, buyerId] of BUYER_IDS.entries()) {
    await seedClient.query("insert into auth.users (id, email) values ($1, $2)", [
      buyerId,
      `set-availability-buyer-${i}@test.local`,
    ]);
  }
  await seedClient.query("insert into partners (id, display_name) values ($1, $2)", [
    PARTNER_ID,
    "Set Availability Concurrency Test Partner",
  ]);
  await seedClient.query(
    "insert into partner_capabilities (account_id, role, source, status) values ($1, 'admin', 'migration', 'active')",
    [ADMIN_ID]
  );
  await seedClient.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID,
    PARTNER_ID,
    JSON.stringify({ es: "Set Availability Concurrency Test Establishment" }),
  ]);
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values ($1, $2, $3, 'activity', jsonb_build_object('es', 'Concurrency availability slot'), 50000, true, $4)`,
    [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID, "concurrency-availability-slot"]
  );
  await seedClient.query(
    "insert into product_availability (product_id, date, capacity, booked) values ($1, $2, $3, 0)",
    [PRODUCT_ID, SLOT_DATE, INITIAL_CAPACITY]
  );
}

function shuffle(array) {
  // Fisher-Yates : sans mélange, la position de l'admin dans l'ordre de reprise après la
  // barrière est déterministe (toujours créé/inscrit en dernier), ce qui biaiserait
  // systématiquement la course en faveur des N acheteurs — pas une vraie concurrence entre les
  // deux types d'opération.
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function authenticatedClient(accountId) {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  await client.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: accountId, role: "authenticated" }),
  ]);
  return client;
}

async function runOnce(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetFixtures(seedClient);

  // Panier d'un seul acheteur, posé en base pour chaque identité AVANT l'appel — create_order lit
  // désormais cart_items pour son propre account_id, plus un paramètre (spec 32).
  for (const buyerId of BUYER_IDS) {
    await seedClient.query(
      "insert into cart_items (account_id, product_id, date, qty) values ($1, $2, $3, $4)",
      [buyerId, PRODUCT_ID, SLOT_DATE, 1]
    );
  }

  const buyerClients = await Promise.all(BUYER_IDS.map((id) => authenticatedClient(id)));
  const adminClient = await authenticatedClient(ADMIN_ID);
  const allClients = [...buyerClients, adminClient];

  // Ordre de reprise après la barrière mélangé à chaque run (cf. shuffle ci-dessus) — sinon
  // l'admin, toujours inscrit en dernier, perdrait systématiquement la course.
  const workers = shuffle([
    ...buyerClients.map((client) => ({ type: "buyer", client })),
    { type: "admin", client: adminClient },
  ]);

  // Barrière : chaque worker (N acheteurs + 1 admin) signale qu'il est prêt, puis attend un
  // signal commun — maximise le chevauchement réel des deux types d'opération concurrentes.
  let readyCount = 0;
  let resolveGo;
  const go = new Promise((resolve) => {
    resolveGo = resolve;
  });
  function markReady() {
    if (++readyCount === workers.length) resolveGo();
  }

  const outcomes = await Promise.all(
    workers.map(async (worker) => {
      markReady();
      await go;

      if (worker.type === "buyer") {
        const res = await worker.client.query("select create_order($1, $2) as result", [
          "Concurrency Buyer",
          "concurrency-buyer@hifago.test",
        ]);
        return { type: "buyer", result: res.rows[0].result };
      }

      try {
        await worker.client.query(
          "select set_product_availability($1, $2, $3, $4, $5)",
          [PRODUCT_ID, SLOT_DATE, NEW_CAPACITY, true, `concurrency-run-${run}`]
        );
        return { type: "admin", applied: true };
      } catch (err) {
        // Un refus "capacité < booked" est un résultat légitime sous concurrence réelle (cf.
        // commentaire en tête de fichier) — pas une erreur de script. Toute autre erreur remonte.
        if (err.message?.includes("inférieure aux places déjà vendues")) {
          return { type: "admin", applied: false };
        }
        throw err;
      }
    })
  );

  const successes = outcomes.filter((o) => o.type === "buyer" && o.result.ok === true).length;
  const adminOutcome = outcomes.find((o) => o.type === "admin");

  const { rows } = await seedClient.query(
    "select capacity, booked from product_availability where product_id = $1 and date = $2",
    [PRODUCT_ID, SLOT_DATE]
  );
  const { capacity, booked } = rows[0];

  console.log(
    `Run ${run}: ${successes}/${N} réservations réussies, admin capacité appliquée=${adminOutcome.applied}, ` +
      `état final capacity=${capacity} booked=${booked}`
  );

  await Promise.all(allClients.map((client) => client.end()));
  await seedClient.end();

  return booked <= capacity;
}

async function runAll() {
  for (let run = 1; run <= RUNS; run++) {
    const clean = await runOnce(run);
    if (!clean) {
      console.error(`Run ${run} a échoué — invariant booked <= capacity violé, arrêt immédiat.`);
      return 1;
    }
  }
  console.log(`${RUNS} runs consécutifs propres — booked <= capacity toujours vrai.`);
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
