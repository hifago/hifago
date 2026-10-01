// Spec 21 §8 — test d'intégration RÉEL du tunnel de réservation d'un logement PMS-backed :
// `create_order` (la vraie RPC, depuis un vrai panier) puis `POST /api/pms/reserve-nights` (le vrai
// Route Handler, contre un serveur de fixtures LobbyPMS).
//
// CE QU'IL PROUVE, ET POURQUOI IL N'EXISTAIT PAS. Le Route Handler `reserve-nights` n'était exercé
// par AUCUN parcours : les specs Playwright l'interceptent au niveau navigateur
// (`mockPmsReserveNights`), donc le handler lui-même ne tourne jamais, et son fichier Vitest mocke
// entièrement Supabase. Autrement dit, la JONCTION entre `create_order` et `reserve-nights`
// n'était vérifiée nulle part — alors que `create_order` a été réécrit DEUX fois depuis la dernière
// vérification réelle du tunnel (spec 32 le 2026-09-10, correctif prix le 2026-09-16) et que le
// handler filtre les lignes sur `status = 'reserved'` et `pms_booking_id is null`. Un changement de
// statut par défaut aurait suffi à ce que la route ne trouve plus rien et réponde `{ok:true}` sans
// créer le moindre booking — en silence, chez un vrai partenaire.
//
// ⚠️ PRÉREQUIS, et le second n'est pas optionnel :
//   1. `npx supabase start` actif.
//   2. Un serveur Next lancé avec LOBBY_API_BASE_URL pointant sur CE serveur de fixtures :
//        cd apps/web && LOBBY_API_BASE_URL=http://127.0.0.1:4546 npm run dev
//      SANS cette variable, `reserve-nights` retombe sur LOBBY_DEFAULT_BASE_URL — c'est-à-dire le
//      VRAI LobbyPMS, et le test créerait de vrais bookings chez un vrai partenaire. Le script
//      refuse de tourner s'il détecte que le serveur ne pointe pas sur la fixture (voir plus bas).
import pg from "pg";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const { Client } = pg;
const CONNECTION_STRING = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const WEB_URL = process.env.WEB_URL ?? "http://127.0.0.1:3100";
// Port distinct de 4545 (pms_poll_bookings) pour que les deux tests puissent coexister.
const FIXTURE_PORT = 4546;
const LOBBY_CATEGORY_ID = 776001;

let appels = { bookings: 0, addService: 0 };
let refuserLeBooking = false;
// Délai de réponse de `POST /bookings` : sans lui, deux POST concurrents ne se chevauchent jamais
// côté Lobby et le scénario 3 ne prouverait rien.
let delaiBookingMs = 0;

function startFixtureServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    // Sonde d'identité : c'est elle qui permet au test de REFUSER de tourner contre le vrai Lobby.
    if (req.method === "GET" && url.pathname === "/__fixture__") return send(200, { fixture: true });

    if (req.method === "POST" && url.pathname === "/api/v1/bookings") {
      appels.bookings++;
      if (refuserLeBooking) {
        // Le 422 réel : Lobby refuse une catégorie tout en l'ayant cotée disponible (spec 24 §11.2,
        // C1 réfuté). Corps volontairement NON exploitable par parseLobbyBookingResponse.
        return send(422, { message: "fixture: catégorie non réservable par API" });
      }
      // Forme RÉELLE observée le 2026-08-27, jamais celle de la doc officielle
      // ({"data":[{"idBooking":…}]}), qui s'est révélée fausse.
      if (delaiBookingMs > 0) {
        setTimeout(() => send(200, { booking: { booking_id: 90000001, room_id: 90000002 } }), delaiBookingMs);
        return;
      }
      return send(200, { booking: { booking_id: 90000001, room_id: 90000002 } });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/booking/add-product-service") {
      appels.addService++;
      // Aligné sur `packages/e2e-support/src/pmsFixtureServer.ts` : cette fixture-ci répondait
      // `{add_product_service:true}`, l'autre `{sale:{…}}`. Deux descriptions contradictoires du
      // même service dans le même dépôt — l'une des deux ment forcément, et c'est le mode de
      // défaillance que l'en-tête du serveur partagé documente sur trois paragraphes.
      return send(200, { sale: { id: 90000003, total: 0 } });
    }

    send(404, { message: `fixture: route inattendue ${req.method} ${url.pathname}` });
  });
  return new Promise((resolve) => server.listen(FIXTURE_PORT, () => resolve(server)));
}

const echecs = [];
function verifier(condition, libelle) {
  if (condition) console.log(`  ok  ${libelle}`);
  else {
    console.error(`  ÉCHEC  ${libelle}`);
    echecs.push(libelle);
  }
}

const ids = {
  partner: randomUUID(),
  establishment: randomUUID(),
  product: randomUUID(),
  acheteur: randomUUID(),
  acheteur2: randomUUID(),
  acheteur3: randomUUID(),
  acheteur4: randomUUID(),
};

async function poserFixtures(client) {
  await client.query(`insert into partners (id, display_name) values ($1, 'PMS Reserve Nights Test')`, [ids.partner]);
  await client.query(
    `insert into establishments (id, partner_id, name, slug, status, lobby_connector_active, lobby_api_token)
     values ($1, $2, '{"es":"Hotel Reserve Nights"}'::jsonb, $3, 'active', true, 'fake-token')`,
    [ids.establishment, ids.partner, `hotel-reserve-nights-${ids.establishment.slice(0, 8)}`]
  );
  await client.query(
    `insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop,
                           lobby_category_id, capacity, unit_count, lodging_kind, min_qty, max_qty)
     values ($1, $2, $3, 'lodging', '{"es":"Chambre Reserve Nights"}'::jsonb, $4, true, 100000, $5,
             2, 3, 'private', 1, 6)`,
    [ids.product, ids.partner, ids.establishment, `chambre-reserve-nights-${ids.product.slice(0, 8)}`, LOBBY_CATEGORY_ID]
  );
}

// Le VRAI chemin : un panier en base, puis create_order sous l'identité de l'acheteur — exactement
// ce que fait le tunnel depuis la spec 32 (les lignes ne sont plus un paramètre).
async function creerCommande(accountId, email) {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  try {
    await client.query("insert into auth.users (id, email) values ($1, $2)", [accountId, email]);
    // Les dates civiles sont calculées PAR POSTGRES, jamais en JS : `today_in_bogota()` est la
    // seule source du « aujourd'hui » de Guatapé, et `to_char` évite le `toISOString()` que
    // `scripts/check-timezone.sh` refuse à juste titre (un `Date` JS projette un instant, pas un
    // jour civil — c'est le lot fuseau du 2026-08-28).
    const { rows: jours } = await client.query(
      `select to_char(today_in_bogota() + 20, 'YYYY-MM-DD') as debut,
              to_char(today_in_bogota() + 22, 'YYYY-MM-DD') as fin`
    );
    const dateIso = jours[0].debut;
    const endIso = jours[0].fin;

    await client.query(
      "insert into cart_items (account_id, product_id, date, end_date, qty) values ($1, $2, $3, $4, 1)",
      [accountId, ids.product, dateIso, endIso]
    );
    await client.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: accountId, role: "authenticated" }),
    ]);
    const { rows } = await client.query("select create_order($1, $2, $3, $4) as result", [
      "Cliente Reserve Nights",
      email,
      "+573001234567",
      false,
    ]);
    return { result: rows[0].result, dateIso, endIso };
  } finally {
    await client.end();
  }
}

async function main() {
  const server = await startFixtureServer();
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();

  try {
    // ── Garde-fou : le serveur web pointe-t-il bien sur CETTE fixture ? ──────────────────────────
    // Sans elle, un oubli de LOBBY_API_BASE_URL enverrait de vrais bookings chez Casa Kayam.
    let web;
    try {
      web = await fetch(`${WEB_URL}/es`, { method: "HEAD" });
    } catch {
      console.error(`\n⛔ Serveur web injoignable sur ${WEB_URL}. Prérequis 2 de l'en-tête :`);
      console.error("   cd apps/web && LOBBY_API_BASE_URL=http://127.0.0.1:4546 npm run dev\n");
      process.exit(1);
    }
    if (!web.ok) console.warn(`  (le serveur web répond ${web.status} sur /es — on continue)`);

    await nettoyer(client);
    await poserFixtures(client);

    // ── 1. Chemin heureux ───────────────────────────────────────────────────────────────────────
    const { result, dateIso } = await creerCommande(ids.acheteur, `reserve-nights-${ids.acheteur.slice(0, 8)}@hifago.test`);
    verifier(result?.ok === true, `create_order accepte une ligne PMS-backed (${JSON.stringify(result).slice(0, 120)})`);
    const orderId = result?.order_id;
    if (!orderId) throw new Error("create_order n'a pas rendu d'order_id — le reste du test n'a plus de sens");

    const { rows: avant } = await client.query(
      "select status, pms_booking_id from order_lines where order_id = $1",
      [orderId]
    );
    verifier(avant.length === 1, `une ligne créée (${avant.length})`);
    verifier(
      avant[0]?.status === "reserved",
      `la ligne est en statut 'reserved' — c'est EXACTEMENT ce que reserve-nights filtre (${avant[0]?.status})`
    );
    verifier(avant[0]?.pms_booking_id === null, "aucun booking Lobby avant l'appel");

    const reponse = await fetch(`${WEB_URL}/api/pms/reserve-nights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
    const corps = await reponse.json().catch(() => null);
    console.log("réponse reserve-nights :", reponse.status, JSON.stringify(corps));

    verifier(reponse.status === 200, `reserve-nights répond 200 (${reponse.status})`);
    verifier(corps?.ok === true, "elle rend ok:true");
    verifier(
      appels.bookings === 1,
      `UN booking demandé à Lobby (${appels.bookings}) — si 0, la route n'a trouvé aucune ligne et personne ne l'aurait su`
    );

    const { rows: apres } = await client.query(
      "select pms_booking_id from order_lines where order_id = $1",
      [orderId]
    );
    verifier(
      apres[0]?.pms_booking_id === "90000001",
      `pms_booking_id écrit depuis le CORPS de la réponse Lobby (${apres[0]?.pms_booking_id})`
    );

    // Migration 20260918170000 : le miroir de disponibilité doit apprendre CE booking sans attendre
    // sa fenêtre de fraîcheur (jusqu'à 24 h) — c'est le trou que le lot referme. `dateIso` vient de
    // `today_in_bogota()` côté Postgres (jamais un Date JS) : le tronquer au mois par `slice(0, 7)`
    // reste une opération sur une chaîne déjà civile, pas une projection de fuseau.
    const { rows: syncState } = await client.query(
      "select invalidated_at from pms_sync_state where establishment_id = $1 and month = $2",
      [ids.establishment, dateIso.slice(0, 7)]
    );
    verifier(
      syncState[0]?.invalidated_at != null,
      `LE POINT DU LOT — reserve-nights invalide le mois du booking dans pms_sync_state (${JSON.stringify(syncState[0])})`
    );

    // Idempotence : rappeler la route ne doit PAS recréer un booking (le claim ne renvoie que les
    // lignes sans booking — 20260930221837).
    const appelsAvant = appels.bookings;
    await fetch(`${WEB_URL}/api/pms/reserve-nights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
    verifier(
      appels.bookings === appelsAvant,
      `un second appel ne redemande RIEN à Lobby (${appels.bookings - appelsAvant}) — la ligne porte déjà son booking`
    );

    // ── 2. Lobby refuse la nuit ─────────────────────────────────────────────────────────────────
    refuserLeBooking = true;
    const { result: result2 } = await creerCommande(
      ids.acheteur2,
      `reserve-nights-refus-${ids.acheteur2.slice(0, 8)}@hifago.test`
    );
    const orderId2 = result2?.order_id;
    verifier(Boolean(orderId2), "seconde commande créée pour le scénario de refus");

    const reponse2 = await fetch(`${WEB_URL}/api/pms/reserve-nights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: orderId2 }),
    });
    const corps2 = await reponse2.json().catch(() => null);
    console.log("réponse en cas de refus :", reponse2.status, JSON.stringify(corps2));

    verifier(reponse2.status === 409, `un refus Lobby rend 409, jamais 200 (${reponse2.status})`);
    verifier(corps2?.reason === "pms_refused", `motif 'pms_refused' (${corps2?.reason})`);
    verifier(corps2?.released === true, "la commande est DÉFAITE — c'est ce qui garantit que rien n'est encaissé");

    const { rows: apresRefus } = await client.query(
      "select status from order_lines where order_id = $1",
      [orderId2]
    );
    verifier(
      apresRefus[0]?.status === "cancelled_by_provider",
      `la ligne repasse en cancelled_by_provider (${apresRefus[0]?.status})`
    );
    const { rows: paiement } = await client.query("select payment_status from orders where id = $1", [orderId2]);
    verifier(paiement[0]?.payment_status === "unpaid", `la commande reste 'unpaid' (${paiement[0]?.payment_status})`);

    // ── 3. Dix POST simultanés sur la même commande → UN SEUL booking chez Lobby ────────────────
    // Migration 20260930221837 : le claim sérialise les appels — un seul réserve la commande, les
    // autres reçoivent pms_claim_in_progress. Mutation « claim sans bail » → plus d'un booking ici.
    refuserLeBooking = false;
    delaiBookingMs = 400;
    const { result: result3 } = await creerCommande(
      ids.acheteur3,
      `reserve-nights-concurrence-${ids.acheteur3.slice(0, 8)}@hifago.test`
    );
    const orderId3 = result3?.order_id;
    verifier(Boolean(orderId3), "troisième commande créée pour le scénario de concurrence");
    const bookingsAvant = appels.bookings;
    const reponses3 = await Promise.all(
      Array.from({ length: 10 }, () =>
        fetch(`${WEB_URL}/api/pms/reserve-nights`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: orderId3 }),
        }).then(async (r) => ({ status: r.status, corps: await r.json().catch(() => null) }))
      )
    );
    delaiBookingMs = 0;
    const oks3 = reponses3.filter((r) => r.status === 200 && r.corps?.ok === true).length;
    const enCours3 = reponses3.filter((r) => r.status === 409 && r.corps?.reason === "pms_claim_in_progress").length;
    verifier(
      appels.bookings - bookingsAvant === 1,
      `10 POST simultanés → UN SEUL booking demandé à Lobby (${appels.bookings - bookingsAvant})`
    );
    verifier(oks3 === 1 && enCours3 === 9, `1 réponse 200, 9 réponses 409 pms_claim_in_progress (${oks3} / ${enCours3})`);
    const { rows: apres3 } = await client.query("select pms_booking_id from order_lines where order_id = $1", [orderId3]);
    verifier(apres3[0]?.pms_booking_id === "90000001", `la ligne porte le booking (${apres3[0]?.pms_booking_id})`);

    // ── 4. Connecteur coupé ENTRE create_order et la route ──────────────────────────────────────
    // CLAUDE.md §4.4 : un logement PMS dont le connecteur est coupé n'a plus aucun contrôle de
    // capacité — la commande est défaite (échec fermé).
    const { result: result4 } = await creerCommande(
      ids.acheteur4,
      `reserve-nights-coupe-${ids.acheteur4.slice(0, 8)}@hifago.test`
    );
    const orderId4 = result4?.order_id;
    verifier(Boolean(orderId4), "quatrième commande créée connecteur actif");
    await client.query("update establishments set lobby_connector_active = false where id = $1", [ids.establishment]);
    const bookingsAvant4 = appels.bookings;
    const reponse4 = await fetch(`${WEB_URL}/api/pms/reserve-nights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: orderId4 }),
    });
    const corps4 = await reponse4.json().catch(() => null);
    verifier(
      reponse4.status === 409 && corps4?.reason === "pms_unavailable" && corps4?.released === true,
      `connecteur coupé → 409 pms_unavailable, commande relâchée (${reponse4.status} ${JSON.stringify(corps4)})`
    );
    verifier(appels.bookings === bookingsAvant4, "Lobby n'est jamais appelé pour un connecteur coupé");
    const { rows: apres4 } = await client.query("select status from order_lines where order_id = $1", [orderId4]);
    verifier(apres4[0]?.status === "cancelled_by_provider", `la ligne est défaite (${apres4[0]?.status})`);
  } finally {
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
  const comptes = [ids.acheteur, ids.acheteur2, ids.acheteur3, ids.acheteur4];
  await client.query(`delete from cart_items where account_id = any($1::uuid[])`, [comptes]);
  await client.query(
    `delete from pms_cancellation_queue where pms_booking_id in (
       select pms_booking_id from order_lines where product_id = $1 and pms_booking_id is not null)`,
    [ids.product]
  );
  await client.query(
    `delete from pms_reconciliation_entries where order_line_id in (
       select id from order_lines where product_id = $1)`,
    [ids.product]
  );
  await client.query(
    `delete from ledger_entries where order_line_id in (select id from order_lines where product_id = $1)`,
    [ids.product]
  );
  const { rows: commandes } = await client.query(
    `select distinct order_id from order_lines where product_id = $1`,
    [ids.product]
  );
  await client.query(`delete from order_lines where product_id = $1`, [ids.product]);
  for (const c of commandes) {
    await client.query(`delete from payments where order_id = $1`, [c.order_id]).catch(() => {});
    await client.query(`delete from orders where id = $1`, [c.order_id]);
  }
  await client.query(`delete from products where id = $1`, [ids.product]);
  await client.query(`delete from pms_sync_state where establishment_id = $1`, [ids.establishment]);
  await client.query(`delete from establishments where id = $1`, [ids.establishment]);
  await client.query(`delete from partners where id = $1`, [ids.partner]);
  await client.query(`delete from auth.users where id = any($1::uuid[])`, [comptes]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
