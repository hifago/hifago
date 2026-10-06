// Miroir de disponibilité LobbyPMS — test d'intégration RÉEL de l'Edge Function
// pms-sync-availability contre la stack Supabase locale, du claim jusqu'au filtre de recherche.
//
// CE QU'IL PROUVE, et qu'aucun autre palier ne peut prouver : la chaîne complète
//   claim_pms_sync_batch → appel HTTP Lobby → parseur du domaine → sync_pms_availability_month
//   → pms_availability_mirror → search_catalog
// tourne réellement dans le runtime Edge, avec les imports Deno relatifs et les vraies RPC. Le
// pgTAP couvre les RPC, Vitest couvre le domaine — ni l'un ni l'autre ne monte l'Edge Function, et
// c'est précisément là que vivent les défauts qui ne se voient qu'au boot (un import sans `.ts`
// casse la fonction sans que typecheck, lint ni tests ne bougent).
//
// P6 : un 429 de Lobby est consigné avec son statut, et son `Retry-After` repousse le couple
// au-delà du backoff calculé.
//
// PRÉREQUIS (cf. tests/pms-integration/pms_poll_bookings.integration.mjs, même protocole) :
//   1. npx supabase start actif, le Vault SANS pms_service_role_key.
//   2. supabase/functions/.env contient LOBBY_API_BASE_URL=http://host.docker.internal:4545 —
//      SANS ce réglage la fonction appellerait le VRAI LobbyPMS, jamais souhaitable en test.
//   3. Aucun autre établissement au connecteur actif (sinon arrêt, exit 2). La fixture répond la
//      MÊME catégorie à tout appel : un autre établissement réclamé recevrait des disponibilités
//      inventées — et le test ne met plus en pause les connecteurs des autres (la pile est partagée,
//      ses données ne sont pas les siennes). Sur une pile au seed (Casa Kayam connecté), le couper
//      à la main le temps du test.
import pg from "pg";
import { createServer } from "node:http";
import {
  CONNECTION_STRING,
  KEYS,
  callerChecks,
  localFunctionsUrl,
  refuseIfCronsCanFire,
  refuseIfForeignRows,
  restoreHeartbeat,
  snapshotHeartbeat,
} from "../support/edgeJobIntegration.mjs";

const { Client } = pg;
const FUNCTIONS_URL = localFunctionsUrl("pms-sync-availability");
const FIXTURE_PORT = 4545;

const PARTNER_ID = "88880000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "88880000-0000-4000-8000-000000000011";
const PRODUCT_ID = "88880000-0000-4000-8000-000000000021";
// Un second établissement, connecté après le premier passage : Lobby lui répond 429.
const RATE_ESTABLISHMENT_ID = "88880000-0000-4000-8000-000000000012";
const RATE_PRODUCT_ID = "88880000-0000-4000-8000-000000000022";
const RATE_TOKEN = "fake-token-rate-limited";
const RETRY_AFTER_SECONDS = 900;
const CATEGORY_ID = 888001;

let appels = 0;
let dernieresDates = { start: "", end: "" };

// La nuit où tout est complet — celle qui doit faire DISPARAÎTRE le produit d'une recherche datée.
let nuitComplete = "";

// Incrément de date CIVILE, sans jamais projeter d'instant : `Date.UTC` sert uniquement d'algèbre
// calendaire (il connaît les mois et les bissextiles), et le résultat est reformaté composant par
// composant — pas de `toISOString()`, que `scripts/check-timezone.sh` refuse à juste titre. Même
// parti pris que `enumerateNights` dans `packages/e2e-support/src/pmsFixtureServer.ts`, y compris
// la comparaison LEXICOGRAPHIQUE, exacte sur des `yyyy-MM-dd` zéro-padés.
function ajouterUnJour(iso) {
  const [annee, mois, jour] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(annee, mois - 1, jour + 1));
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const jj = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${jj}`;
}

function enumererNuits(start, end) {
  const nuits = [];
  let curseur = start;
  // `end_date` est INCLUSIF chez LobbyPMS (mesuré le 2026-08-28) — la fixture le respecte, sinon
  // elle serait plus complaisante que le vrai service et ne prouverait rien.
  for (let garde = 0; garde < 400 && curseur <= end; garde += 1) {
    nuits.push(curseur);
    curseur = ajouterUnJour(curseur);
  }
  return nuits;
}

function startFixtureServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/v2/available-rooms") {
      appels++;
      // Un jeton inconnu de la fixture (un autre établissement réclamé) n'obtient JAMAIS de
      // disponibilités inventées : une panne, son miroir ne bouge pas.
      if (url.searchParams.get("api_token") !== "fake-token" && url.searchParams.get("api_token") !== RATE_TOKEN) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "jeton inconnu de la fixture" }));
        return;
      }
      if (url.searchParams.get("api_token") === RATE_TOKEN) {
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(RETRY_AFTER_SECONDS) });
        res.end(JSON.stringify({ message: "Too Many Attempts." }));
        return;
      }
      const start = url.searchParams.get("start_date") ?? "";
      const end = url.searchParams.get("end_date") ?? "";
      dernieresDates = { start, end };
      const records = enumererNuits(start, end).map((date) => ({
        date,
        categories: [
          {
            category_id: CATEGORY_ID,
            name: "Chambre Integration",
            available_rooms: date === nuitComplete ? 0 : 4,
            restrictions: { min_stay: 0, max_stay: 0, lead_days: 0 },
            plans: [{ plan_id: 1, prices: [{ people: 1, price: 100000 }] }],
          },
        ],
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          records.length === 1
            ? records[0]
            : {
                data: records,
                meta: {
                  total_records: records.length,
                  current_page: 1,
                  records_per_page: 100,
                  total_pages: 1,
                },
              }
        )
      );
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "fixture: route inattendue" }));
  });
  return new Promise((resolve) => server.listen(FIXTURE_PORT, () => resolve(server)));
}

const echecs = [];
function verifier(condition, libelle) {
  if (condition) {
    console.log(`  ok  ${libelle}`);
  } else {
    console.error(`  ÉCHEC  ${libelle}`);
    echecs.push(libelle);
  }
}

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  // ⚠️ ISOLATION OBLIGATOIRE, apprise en réel le 2026-09-17 : le claim sert des couples de
  // N'IMPORTE QUEL établissement connecté, et cette fixture répond la MÊME catégorie (888001) à tout
  // appel — le miroir d'un autre établissement se remplissait de disponibilités inventées, et ça
  // SURVIVAIT au test. Un test d'intégration qui laisse de fausses données dans une base partagée
  // est pire qu'absent : il s'arrête plutôt.
  await refuseIfCronsCanFire(client);
  await refuseIfForeignRows(
    client,
    "établissement(s) au connecteur actif",
    "select count(*)::int as n from establishments where lobby_connector_active and id not in ($1, $2)",
    [ESTABLISHMENT_ID, RATE_ESTABLISHMENT_ID]
  );
  const server = await startFixtureServer();
  const heartbeatAvant = await snapshotHeartbeat(client, "pms-sync-availability");

  try {
    // P6 — seule la clé service_role déclenche le job ; un refus ne réclame rien, n'appelle pas Lobby.
    for (const [ok, libelle] of await callerChecks(FUNCTIONS_URL)) verifier(ok, libelle);
    verifier(appels === 0, `aucun refus n'a appelé Lobby (${appels})`);

    await nettoyer(client);

    // `to_char` côté SQL plutôt qu'un `toISOString()` sur l'objet Date rendu par pg : celui-ci
    // projette un INSTANT, donc reprojette le jour civil dans le fuseau du runner (cf. le lot
    // fuseau du 2026-08-28 et `scripts/check-timezone.sh`).
    const { rows: jours } = await client.query(
      "select to_char(today_in_bogota(), 'YYYY-MM-DD') as today"
    );
    const today = jours[0].today;
    const moisCourant = today.slice(0, 7);
    // Une nuit complète dans le mois courant, assez loin d'aujourd'hui pour exister quel que soit
    // le jour d'exécution — sinon la recherche porterait sur une date déjà passée.
    const [annee, mois] = moisCourant.split("-");
    nuitComplete = `${annee}-${mois}-28`;

    await client.query(
      `insert into partners (id, display_name) values ($1, 'PMS Sync Integration')`,
      [PARTNER_ID]
    );
    await client.query(
      `insert into establishments (id, partner_id, name, slug, status, lobby_connector_active, lobby_api_token)
       values ($1, $2, '{"es":"Hotel Sync Integration"}'::jsonb, 'hotel-sync-integration', 'active', true, 'fake-token')`,
      [ESTABLISHMENT_ID, PARTNER_ID]
    );
    await client.query(
      `insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop,
                             lobby_category_id, capacity, unit_count, lodging_kind)
       values ($1, $2, $3, 'lodging', '{"es":"Chambre Sync Integration"}'::jsonb,
               'chambre-sync-integration', true, 100000, $4, 2, 1, 'private')`,
      [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID, CATEGORY_ID]
    );

    // ── L'appel réel ────────────────────────────────────────────────────────────────────────────
    // limit 7, pas 6 : l'horizon couvre les rangs 0..6 (sept mois), et un lot plus court
    // laisserait un couple dû au passage suivant — l'assertion de fraîcheur plus bas mesurerait
    // alors ce reste plutôt que ce qu'elle prétend mesurer.
    const reponse = await fetch(FUNCTIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEYS.serviceRole}`,
      },
      body: JSON.stringify({ limit: 7 }),
    });
    const resultat = await reponse.json();
    console.log("réponse de la fonction :", JSON.stringify(resultat));

    verifier(reponse.status === 200, "l'Edge Function répond 200");
    verifier(resultat.ok === true, "elle rend ok:true");
    verifier(resultat.synced >= 1, `au moins un couple (établissement, mois) synchronisé (${resultat.synced})`);

    // UN appel par mois, jamais un par nuit ni un par catégorie — c'est tout l'intérêt de
    // getNightAvailabilityRange, et le seul rempart contre le quota de 60/min.
    verifier(appels === resultat.synced, `un seul appel Lobby par mois synchronisé (${appels} appels pour ${resultat.synced} mois)`);
    verifier(
      dernieresDates.start !== "" && dernieresDates.end !== "",
      "la fonction demande bien une PLAGE (start_date + end_date), pas une nuit"
    );

    // ── Le miroir ───────────────────────────────────────────────────────────────────────────────
    const { rows: miroir } = await client.query(
      `select count(*)::int as n,
              count(*) filter (where available_units = 0)::int as completes
         from pms_availability_mirror where establishment_id = $1`,
      [ESTABLISHMENT_ID]
    );
    verifier(miroir[0].n > 0, `le miroir est rempli (${miroir[0].n} nuits)`);
    verifier(miroir[0].completes >= 1, "la nuit complète est écrite avec available_units = 0, pas omise");

    const { rows: etat } = await client.query(
      `select count(*)::int as n from pms_sync_state where establishment_id = $1 and synced_at is not null`,
      [ESTABLISHMENT_ID]
    );
    verifier(etat[0].n >= 1, `l'état de synchronisation est consigné (${etat[0].n} mois)`);

    const { rows: horodatage } = await client.query(
      `select lobby_last_synced_at is not null as ecrite from establishments where id = $1`,
      [ESTABLISHMENT_ID]
    );
    verifier(horodatage[0].ecrite, "lobby_last_synced_at est écrite — colonne morte depuis le 2026-08-19");

    // ── Le filtre de recherche, bout du bout ────────────────────────────────────────────────────
    const { rows: complet } = await client.query(
      `select count(*)::int as n from search_catalog(p_desde => $1::date, p_hasta => $1::date, p_limite => 100000)
        where slug = 'chambre-sync-integration'`,
      [nuitComplete]
    );
    verifier(complet[0].n === 0, "sur la nuit COMPLÈTE, le logement disparaît de la recherche datée");

    const { rows: libre } = await client.query(
      `select count(*)::int as n from search_catalog(p_desde => $1::date, p_hasta => $1::date, p_limite => 100000)
        where slug = 'chambre-sync-integration'`,
      [`${annee}-${mois}-27`]
    );
    verifier(libre[0].n === 1, "sur une nuit LIBRE, il apparaît");

    const { rows: sansDates } = await client.query(
      `select count(*)::int as n from search_catalog(p_limite => 100000) where slug = 'chambre-sync-integration'`
    );
    verifier(sansDates[0].n === 1, "sans dates, il apparaît toujours — le filtre ne joue pas");

    // ── Le second passage ne redemande rien (fraîcheur) ─────────────────────────────────────────
    const appelsAvant = appels;
    const reponse2 = await fetch(FUNCTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEYS.serviceRole}` },
      body: JSON.stringify({ limit: 7 }),
    });
    const resultat2 = await reponse2.json();
    verifier(
      appels === appelsAvant,
      `un second passage immédiat ne consomme AUCUN appel Lobby (${appels - appelsAvant}) — fraîcheur et visibility timeout`
    );
    console.log("second passage :", JSON.stringify(resultat2));

    // ── 429 de Lobby : statut consigné, Retry-After respecté ───────────────────────────────────
    await client.query(
      `insert into establishments (id, partner_id, name, slug, status, lobby_connector_active, lobby_api_token)
       values ($1, $2, '{"es":"Hotel Sync Rate"}'::jsonb, 'hotel-sync-rate', 'active', true, $3)`,
      [RATE_ESTABLISHMENT_ID, PARTNER_ID, RATE_TOKEN]
    );
    // claim_pms_sync_batch ne réclame qu'un établissement qui vend un logement adossé au PMS.
    await client.query(
      `insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop,
                             lobby_category_id, capacity, unit_count, lodging_kind)
       values ($1, $2, $3, 'lodging', '{"es":"Chambre Sync Rate"}'::jsonb,
               'chambre-sync-rate', true, 100000, $4, 2, 1, 'private')`,
      [RATE_PRODUCT_ID, PARTNER_ID, RATE_ESTABLISHMENT_ID, CATEGORY_ID + 1]
    );
    const appelsAvant429 = appels;
    const reponse3 = await fetch(FUNCTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEYS.serviceRole}` },
      body: JSON.stringify({ limit: 7 }),
    });
    const resultat3 = await reponse3.json();
    console.log("passage 429 :", JSON.stringify(resultat3));
    verifier(
      reponse3.status === 200 && resultat3.ok === false && resultat3.failed === 7 && appels - appelsAvant429 === 7,
      `429 → 7 mois en échec, ok=false, un appel chacun (${resultat3.ok}, ${resultat3.failed}, ${appels - appelsAvant429} appels)`
    );
    const { rows: heartbeat429 } = await client.query("select last_error from job_heartbeats where job_name = 'pms-sync-availability'");
    verifier(
      heartbeat429[0]?.last_error === "lobby : 7 mois en échec sur 7 — rate_limited 429 ×7",
      `heartbeat : motif exact avec le statut (${heartbeat429[0]?.last_error})`
    );
    const { rows: etat429 } = await client.query(
      `select count(*)::int as n,
              count(*) filter (where last_error = $2)::int as motif,
              count(*) filter (where next_attempt_at > now() + interval '14 minutes')::int as repousses
         from pms_sync_state where establishment_id = $1`,
      [RATE_ESTABLISHMENT_ID, `rate_limited 429 (retry-after ${RETRY_AFTER_SECONDS}s)`]
    );
    verifier(
      etat429[0].n === 7 && etat429[0].motif === 7 && etat429[0].repousses === 7,
      `pms_sync_state : 7 mois consignés avec le motif, repoussés au-delà du backoff de 5 min par Retry-After 900 s (${etat429[0].n}, ${etat429[0].motif}, ${etat429[0].repousses})`
    );
    const { rows: miroir429 } = await client.query(
      "select count(*)::int as n from pms_availability_mirror where establishment_id = $1",
      [RATE_ESTABLISHMENT_ID]
    );
    verifier(miroir429[0].n === 0, "un échec n'écrit jamais dans le miroir");
  } finally {
    await restoreHeartbeat(client, "pms-sync-availability", heartbeatAvant).catch((err) =>
      console.error("restauration du heartbeat impossible :", err)
    );
    await nettoyer(client);
    await client.end();
    server.close();
  }

  if (echecs.length > 0) {
    console.error(`\n${echecs.length} vérification(s) en échec.`);
    process.exit(1);
  }
  console.log("\nToutes les vérifications passent.");
}

async function nettoyer(client) {
  // Par CATÉGORIE et pas seulement par établissement : la fixture répond 888001 à tout appel, donc
  // une exécution mal isolée a pu en écrire ailleurs. Ceinture et bretelles — c'est le genre de
  // résidu qu'on ne retrouve jamais ensuite.
  await client.query(`delete from pms_availability_mirror where lobby_category_id = $1`, [CATEGORY_ID]);
  await client.query(`delete from pms_availability_mirror where establishment_id in ($1, $2)`, [ESTABLISHMENT_ID, RATE_ESTABLISHMENT_ID]);
  await client.query(`delete from pms_sync_state where establishment_id in ($1, $2)`, [ESTABLISHMENT_ID, RATE_ESTABLISHMENT_ID]);
  await client.query(`delete from products where id in ($1, $2)`, [PRODUCT_ID, RATE_PRODUCT_ID]);
  await client.query(`delete from establishments where id in ($1, $2)`, [ESTABLISHMENT_ID, RATE_ESTABLISHMENT_ID]);
  await client.query(`delete from partners where id = $1`, [PARTNER_ID]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
