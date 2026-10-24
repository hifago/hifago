// Spec 21 §8.2 (Lobby APRÈS l'acompte, 2026-10-23) — test d'intégration RÉEL du tunnel de vérification
// d'un logement PMS-backed : `create_order` (la vraie RPC, depuis un vrai panier) puis
// `POST /api/pms/check-nights` (le vrai Route Handler, contre un serveur de fixtures LobbyPMS), et la
// vraie RPC `hold_pms_nights` derrière.
//
// CE QU'IL PROUVE, ET POURQUOI IL EXISTE. La route lit Lobby à chaud, tient la place dans hifago
// (hold_pms_nights) et NE CRÉE AUCUN BOOKING : la jonction route ↔ RPC (forme de l'instantané, nuits
// [date, départ), verrou de catégorie) n'était vérifiée nulle part, et un changement de forme aurait
// suffi à ce que la route tienne « rien » en répondant ok. Il prouve aussi la concurrence À TRAVERS la
// route : deux paniers sur la dernière unité → exactement un ok, jamais deux.
//
// ⚠️ PRÉREQUIS, et le second n'est pas optionnel :
//   1. `npx supabase start` actif.
//   2. Un serveur Next lancé avec LOBBY_API_BASE_URL pointant sur CE serveur de fixtures :
//        cd apps/web && LOBBY_API_BASE_URL=http://127.0.0.1:4546 npm run dev
//      SANS cette variable, `check-nights` retombe sur LOBBY_DEFAULT_BASE_URL — c'est-à-dire le
//      VRAI LobbyPMS (lecture seule, mais avec un jeton factice). Le script refuse de tourner s'il
//      détecte que le serveur ne pointe pas sur la fixture.
import pg from "pg";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const { Client } = pg;
const CONNECTION_STRING = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const WEB_URL = process.env.WEB_URL ?? "http://127.0.0.1:3100";
// Port distinct de 4545 (pms_poll_bookings) pour que les deux tests puissent coexister.
const FIXTURE_PORT = 4546;
const LOBBY_CATEGORY_ID = 776001;

let appels = { bookings: 0, addService: 0, availability: 0 };
// Unités libres que la fixture cote pour la catégorie, chaque nuit ; `lobbyDown` rejoue une panne.
let disponibilite = 5;
let lobbyDown = false;

function startFixtureServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    // Sonde d'identité : c'est elle qui permet au test de REFUSER de tourner contre le vrai Lobby.
    if (req.method === "GET" && url.pathname === "/__fixture__") return send(200, { fixture: true });

    // LA LECTURE (end_date INCLUSIF, un enregistrement par nuit — forme mesurée le 2026-08-28).
    if (req.method === "GET" && url.pathname === "/api/v2/available-rooms") {
      appels.availability++;
      if (lobbyDown) return send(500, { message: "fixture: Lobby en panne" });
      const nuits = [];
      const fin = new Date(`${url.searchParams.get("end_date")}T00:00:00Z`);
      for (let jour = new Date(`${url.searchParams.get("start_date")}T00:00:00Z`); jour <= fin; jour.setUTCDate(jour.getUTCDate() + 1)) {
        nuits.push({
          date: jour.toISOString().slice(0, 10),
          categories: [{ category_id: LOBBY_CATEGORY_ID, available_rooms: disponibilite, plans: [] }],
        });
      }
      return send(200, { data: nuits, meta: { total_records: nuits.length, current_page: 1, records_per_page: 100, total_pages: 1 } });
    }

    // Toute ÉCRITURE chez Lobby est une faute de cette route : elle est comptée, le test exige zéro.
    if (req.method === "POST" && url.pathname === "/api/v1/bookings") {
      appels.bookings++;
      return send(200, { booking: { booking_id: 90000001, room_id: 90000002 } });
    }
    if (req.method === "POST" && url.pathname === "/api/v1/booking/add-product-service") {
      appels.addService++;
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
  acheteur5: randomUUID(),
  acheteur6: randomUUID(),
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
async function creerCommande(accountId, email, decalage = 20) {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  try {
    await client.query("insert into auth.users (id, email) values ($1, $2)", [accountId, email]);
    // Les dates civiles sont calculées PAR POSTGRES, jamais en JS : `today_in_bogota()` est la
    // seule source du « aujourd'hui » de Guatapé, et `to_char` évite le `toISOString()` que
    // `scripts/check-timezone.sh` refuse à juste titre (un `Date` JS projette un instant, pas un
    // jour civil — c'est le lot fuseau du 2026-08-28).
    const { rows: jours } = await client.query(
      `select to_char(today_in_bogota() + $1::int, 'YYYY-MM-DD') as debut,
              to_char(today_in_bogota() + $1::int + 2, 'YYYY-MM-DD') as fin`,
      [decalage]
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

// Migration 20261014211217 : un refus défait la commande ET rend ses lignes au panier du client.
async function panierRendu(client, accountId, dateIso, endIso) {
  const { rows } = await client.query(
    `select to_char(ci.date, 'YYYY-MM-DD') as debut, to_char(ci.end_date, 'YYYY-MM-DD') as fin, ci.qty,
            exists (select 1 from carts c where c.account_id = ci.account_id) as panier
       from cart_items ci where ci.account_id = $1 and ci.product_id = $2`,
    [accountId, ids.product]
  );
  return {
    ok: rows.length === 1 && rows[0].debut === dateIso && rows[0].fin === endIso && rows[0].qty === 1 && rows[0].panier,
    rows,
  };
}

async function intent(accountId, orderId) {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  try {
    await client.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: accountId, role: "authenticated" })]);
    const { rows } = await client.query("select create_payment_intent($1) as result", [orderId]);
    return rows[0].result;
  } finally {
    await client.end();
  }
}

const appelerRoute = async (orderId) => {
  const reponse = await fetch(`${WEB_URL}/api/pms/check-nights`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
  return { status: reponse.status, corps: await reponse.json().catch(() => null) };
};

async function main() {
  const server = await startFixtureServer();
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();

  try {
    // ── Garde-fou : le serveur web pointe-t-il bien sur CETTE fixture ? ──────────────────────────
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

    // ── 1. Chemin heureux : lecture, place tenue, AUCUN booking ────────────────────────────────
    disponibilite = 5;
    const { result } = await creerCommande(ids.acheteur, `check-nights-${ids.acheteur.slice(0, 8)}@hifago.test`);
    verifier(result?.ok === true, `create_order accepte une ligne PMS-backed (${JSON.stringify(result).slice(0, 120)})`);
    const orderId = result?.order_id;
    if (!orderId) throw new Error("create_order n'a pas rendu d'order_id — le reste du test n'a plus de sens");

    // Sans lecture, « Pagar » est refusé : aucune nuit PMS n'est ni bookée ni tenue.
    const avantTenue = await intent(ids.acheteur, orderId);
    verifier(avantTenue?.ok === false && avantTenue?.reason === "pms_booking_missing", `avant check-nights, l'intent est refusé pms_booking_missing (${JSON.stringify(avantTenue)})`);

    const { status, corps } = await appelerRoute(orderId);
    console.log("réponse check-nights :", status, JSON.stringify(corps));
    verifier(status === 200 && corps?.ok === true, `check-nights répond 200 ok:true (${status})`);
    verifier(appels.availability >= 1, `Lobby a été LU à chaud (${appels.availability} lecture(s))`);
    verifier(appels.bookings === 0 && appels.addService === 0, `AUCUNE écriture chez Lobby avant paiement (${appels.bookings} booking, ${appels.addService} service)`);

    const { rows: apres } = await client.query(
      `select ol.status, ol.pms_booking_id, ol.pms_held_at is not null as tenue, o.pms_checked_at is not null as verifiee
         from order_lines ol join orders o on o.id = ol.order_id where ol.order_id = $1`,
      [orderId]
    );
    verifier(apres[0]?.status === "reserved" && apres[0]?.pms_booking_id === null, "la ligne reste réservée, sans booking Lobby");
    verifier(apres[0]?.tenue === true && apres[0]?.verifiee === true, "la place est TENUE (pms_held_at) et la commande vérifiée (pms_checked_at)");

    const avecTenue = await intent(ids.acheteur, orderId);
    verifier(avecTenue?.ok === true, `après check-nights, l'intent de paiement est accordé (${JSON.stringify(avecTenue)})`);

    // Idempotence : rappeler la route ne change rien et ne crée toujours rien chez Lobby.
    const second = await appelerRoute(orderId);
    verifier(second.status === 200 && appels.bookings === 0, "un second appel reste ok et n'écrit toujours rien chez Lobby");

    // ── 2. Nuit pleine ──────────────────────────────────────────────────────────────────────────
    disponibilite = 0;
    const { result: result2, dateIso: debut2, endIso: fin2 } = await creerCommande(
      ids.acheteur2,
      `check-nights-plein-${ids.acheteur2.slice(0, 8)}@hifago.test`,
      30
    );
    const orderId2 = result2?.order_id;
    verifier(Boolean(orderId2), "seconde commande créée pour le scénario de nuit pleine");
    const plein = await appelerRoute(orderId2);
    console.log("réponse nuit pleine :", plein.status, JSON.stringify(plein.corps));
    verifier(plein.status === 409 && plein.corps?.reason === "pms_refused", `nuit pleine → 409 pms_refused (${plein.status} ${plein.corps?.reason})`);
    verifier(plein.corps?.released === true, "la commande est DÉFAITE — c'est ce qui garantit que rien n'est encaissé");
    const { rows: apresPlein } = await client.query("select status from order_lines where order_id = $1", [orderId2]);
    verifier(apresPlein[0]?.status === "cancelled_by_provider", `la ligne repasse en cancelled_by_provider (${apresPlein[0]?.status})`);
    const { rows: paiement } = await client.query("select payment_status from orders where id = $1", [orderId2]);
    verifier(paiement[0]?.payment_status === "unpaid", `la commande reste 'unpaid' (${paiement[0]?.payment_status})`);
    const panier2 = await panierRendu(client, ids.acheteur2, debut2, fin2);
    verifier(panier2.ok, `le panier du client contient de nouveau la ligne relâchée (${JSON.stringify(panier2.rows)})`);
    verifier(appels.bookings === 0, "Lobby n'a toujours reçu aucune écriture");

    // ── 3. Lobby en panne ───────────────────────────────────────────────────────────────────────
    disponibilite = 5;
    lobbyDown = true;
    const { result: result3, dateIso: debut3, endIso: fin3 } = await creerCommande(
      ids.acheteur3,
      `check-nights-panne-${ids.acheteur3.slice(0, 8)}@hifago.test`,
      40
    );
    const orderId3 = result3?.order_id;
    const panne = await appelerRoute(orderId3);
    lobbyDown = false;
    verifier(panne.status === 409 && panne.corps?.reason === "pms_unreachable" && panne.corps?.released === true,
      `Lobby en panne → 409 pms_unreachable, commande défaite — échec fermé (${panne.status} ${JSON.stringify(panne.corps)})`);
    const panier3 = await panierRendu(client, ids.acheteur3, debut3, fin3);
    verifier(panier3.ok, "panne : le panier du client est rendu");

    // ── 4. La dernière unité, deux paniers simultanés → UN SEUL ok ──────────────────────────────
    // hold_pms_nights sérialise sur le verrou de catégorie : mutation « sans le for update » → deux ok.
    disponibilite = 1;
    const { result: r4a } = await creerCommande(ids.acheteur4, `check-nights-course-a-${ids.acheteur4.slice(0, 8)}@hifago.test`, 60);
    const { result: r4b } = await creerCommande(ids.acheteur5, `check-nights-course-b-${ids.acheteur5.slice(0, 8)}@hifago.test`, 60);
    const course = await Promise.all([appelerRoute(r4a?.order_id), appelerRoute(r4b?.order_id)]);
    const oks = course.filter((r) => r.status === 200 && r.corps?.ok === true).length;
    const refus = course.filter((r) => r.status === 409 && r.corps?.reason === "pms_refused" && r.corps?.released === true).length;
    verifier(oks === 1 && refus === 1, `dernière unité, 2 paniers simultanés → 1 ok, 1 pms_refused (${oks} / ${refus} : ${JSON.stringify(course.map((r) => r.status))})`);
    verifier(appels.bookings === 0, "toujours aucune écriture chez Lobby");

    // ── 5. Connecteur coupé ENTRE create_order et la route ──────────────────────────────────────
    // CLAUDE.md §4.4 : la commande est défaite (échec fermé).
    disponibilite = 5;
    const { result: r5, dateIso: debut5, endIso: fin5 } = await creerCommande(
      ids.acheteur6,
      `check-nights-coupe-${ids.acheteur6.slice(0, 8)}@hifago.test`,
      80
    );
    await client.query("update establishments set lobby_connector_active = false where id = $1", [ids.establishment]);
    const lecturesAvant = appels.availability;
    const coupe = await appelerRoute(r5?.order_id);
    await client.query("update establishments set lobby_connector_active = true where id = $1", [ids.establishment]);
    verifier(coupe.status === 409 && coupe.corps?.reason === "pms_unavailable" && coupe.corps?.released === true,
      `connecteur coupé → 409 pms_unavailable, commande relâchée (${coupe.status} ${JSON.stringify(coupe.corps)})`);
    verifier(appels.availability === lecturesAvant, "Lobby n'est jamais lu pour un connecteur coupé");
    const panier5 = await panierRendu(client, ids.acheteur6, debut5, fin5);
    verifier(panier5.ok, "connecteur coupé : le panier du client est rendu");
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
  const comptes = [ids.acheteur, ids.acheteur2, ids.acheteur3, ids.acheteur4, ids.acheteur5, ids.acheteur6];
  // cart_items PUIS carts, avant le compte : un refus les recrée (20261014211217), et carts tient
  // une clé étrangère sur partner_accounts, supprimé en cascade avec auth.users plus bas.
  await client.query(`delete from cart_items where account_id = any($1::uuid[])`, [comptes]);
  await client.query(`delete from carts where account_id = any($1::uuid[])`, [comptes]);
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
