// Test de concurrence réelle de consume_partner_invitation — squelette de
// hifago/docs/05-reference-technique.md §2 (barrière de synchronisation, driver `pg` direct,
// jamais pgTAP ni Promise.all naïf — cf. hifago/CLAUDE.md §6). La « ressource à capacité limitée »
// est ici l'invitation elle-même : sur N tentatives concurrentes de consommation du même token,
// exactement une doit réussir.
//
// Contre la stack Supabase locale uniquement (127.0.0.1:54322) — jamais un projet cloud partagé.
import pg from "pg";

const { Client } = pg;

// Surchargeable par PGURL : ces tests ÉCRIVENT. Les pointer ailleurs que sur la stack locale
// partagée est le seul moyen de les vérifier sans écraser le travail d'une autre session
// (cf. AGENTS-PARALLELES.md §3). Défaut inchangé : la stack locale.
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const N = 20; // tentatives concurrentes visant le même token
const RUNS = 5; // barre d'acceptation : ≥5 runs consécutifs propres

const ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";
const TOKEN = "concurrency-test-token";
const CODE = "CONCURTEST";

// Purge des fixtures de ce fichier — avant chaque run (par le reset ci-dessous) ET une dernière fois
// en fin de fichier, quoi qu'il arrive (audit P12e, 2026-10-06). Sans la seconde, le dernier run
// laissait ses lignes en base : sur la pile locale partagée comme en CI, où le job `concurrence`
// compare désormais les comptes de lignes avant/après.
async function purgeFixtures(seedClient) {
  // Ordre imposé par les FK : d'abord ce qui référence partners/partner_accounts, puis
  // partner_accounts (libère la FK vers partners), puis partners lui-même.
  await seedClient.query("delete from partner_invitations where promo_code = $1", [CODE]);
  await seedClient.query("delete from partner_capabilities where partner_id in (select id from partners where display_name = 'Concurrency Test Partner')");
  await seedClient.query("delete from role_agreements where account_id = $1", [ACCOUNT_ID]);
  await seedClient.query("delete from partner_accounts where id = $1", [ACCOUNT_ID]);
  await seedClient.query("delete from partner_codes where code = $1", [CODE]);
  await seedClient.query("delete from partners where display_name = 'Concurrency Test Partner'");
  await seedClient.query("delete from auth.users where id = $1", [ACCOUNT_ID]);
}

async function resetFixtures(seedClient) {
  await purgeFixtures(seedClient);

  await seedClient.query("insert into auth.users (id, email) values ($1, $2)", [
    ACCOUNT_ID,
    "concurrency@test.local",
  ]);
  await seedClient.query("insert into partner_codes (code) values ($1)", [CODE]);
  await seedClient.query(
    `insert into partner_invitations (token_hash, promo_code, onboarding_path, expires_at, partner_hint)
     values (encode(extensions.digest($1, 'sha256'), 'hex'), $2, 'provider', now() + interval '7 days',
             jsonb_build_object('display_name', 'Concurrency Test Partner'))`,
    [TOKEN, CODE]
  );
}

async function runOnce(run) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetFixtures(seedClient);

  // Connexions indépendantes, ouvertes en parallèle (le classement se fait plus tard, à la
  // barrière ci-dessous — l'ordre d'établissement de la connexion n'a aucune importance ici).
  const clients = await Promise.all(
    Array.from({ length: N }, async () => {
      const client = new Client({ connectionString: CONNECTION_STRING });
      await client.connect();
      // request.jwt.claims au niveau session (is_local=false) : chaque connexion ne fait qu'un
      // seul appel, pas besoin de transaction explicite pour porter le réglage.
      await client.query("select set_config('request.jwt.claims', $1, false)", [
        JSON.stringify({ sub: ACCOUNT_ID, role: "authenticated" }),
      ]);
      return client;
    })
  );

  // Barrière : chaque worker signale qu'il est prêt, puis attend un signal commun. Le signal ne se
  // déclenche que lorsque TOUS les workers sont prêts, pour maximiser le chevauchement réel des
  // requêtes FOR UPDATE dans la RPC.
  let readyCount = 0;
  let resolveGo;
  const go = new Promise((resolve) => {
    resolveGo = resolve;
  });
  function markReady() {
    if (++readyCount === N) resolveGo();
  }

  const results = await Promise.all(
    clients.map(async (client) => {
      markReady();
      await go;
      const res = await client.query(
        "select consume_partner_invitation($1, $2, $3, $4, $5) as result",
        [TOKEN, "Concurrency Tester", "v1", null, null]
      );
      return res.rows[0].result;
    })
  );

  const successes = results.filter((r) => r.ok === true);
  console.log(`Run ${run}: succès ${successes.length} / ${N} (doit être exactement 1)`);

  await Promise.all(clients.map((client) => client.end()));
  await seedClient.end();

  return successes.length === 1;
}

async function runAll() {
  for (let run = 1; run <= RUNS; run++) {
    const clean = await runOnce(run);
    if (!clean) {
      console.error(`Run ${run} a échoué — arrêt immédiat, zéro tolérance à un échec isolé.`);
      return 1;
    }
  }
  console.log(`${RUNS} runs consécutifs propres — exactement 1 succès à chaque fois.`);
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
