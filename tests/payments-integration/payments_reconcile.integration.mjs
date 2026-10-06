// Spec 39 — test d'intégration RÉEL de l'Edge Function payments-reconcile contre la stack Supabase
// locale : invoque l'URL HTTP de la fonction (jamais en attendant un tick pg_cron), Mercado Pago
// étant rejoué par un serveur de fixtures node:http. Même squelette que
// tests/pms-integration/pms_poll_bookings.integration.mjs.
//
// PRÉREQUIS (voir l'en-tête de supabase/functions/payments-reconcile/index.ts) :
//   1. npx supabase start actif.
//   2. supabase/functions/.env (gitignoré) contient
//        MERCADOPAGO_API_BASE_URL=http://host.docker.internal:4547
//        MERCADOPAGO_ACCESS_TOKEN=<n'importe quelle valeur non vide>
//      puis `npx supabase stop && npx supabase start` (le runtime Edge lit .env au démarrage).
//      SANS ce réglage, la fonction pointerait vers le VRAI Mercado Pago — jamais souhaitable en test.
//
// Six scénarios, un par commande, tous dans le même run de la fonction :
//   S1 approuvé tardif sans retour client → commande payée ;
//   S2 rien chez MP après 30 min + marge → expirée, place rendue ;
//   S3 PSE en attente > 2 h, MP accepte l'annulation → expirée ;
//   S4 PSE en attente > 2 h, MP REFUSE l'annulation et le re-GET dit approuvé → payée, jamais expirée ;
//   S5 paiement dont le collector_id ≠ /users/me → rien ne bouge, heartbeat ok=false ;
//   S6 paiement annulé d'une commande déjà expirée, MP dit approuvé → refund_required (surveillance) ;
//   S7 remboursement demandé par l'admin → POST /refunds (X-Idempotency-Key) → approuvé, entrée résolue ;
//   S8 remboursement refusé par MP (4xx métier) → rejected, entrée rouverte, corps conservé ;
//   S9 (P6) paiement approuvé dans une AUTRE devise → montant inexploitable (null), jamais payée,
//      entrée refund_required / amount_mismatch ;
//   S10 (P6) PSE > 2 h, PUT refusé, re-GET approuvé en USD → idem, par le chemin de l'annulation.
// Et (P6) : seule la clé service_role déclenche le job (sans en-tête, anon, publishable → 401) ; le
// jeton Mercado Pago n'apparaît nulle part (heartbeat, réponse, journaux si FUNCTION_LOG est fourni) ;
// l'événement conservé est APLATI — jamais le payeur que Mercado Pago renvoie.
// La fonction peut aussi tourner en Deno autonome : FUNCTIONS_URL=http://127.0.0.1:<port>,
// MERCADOPAGO_API_BASE_URL=http://127.0.0.1:4547.
// Le Vault SANS pms_service_role_key, et aucune autre commande, surveillance ou remboursement
// réclamable dans la base (les claims sont globaux — sinon arrêt, exit 2).
import pg from "pg";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import {
  CONNECTION_STRING,
  callerChecks,
  localFunctionsUrl,
  refuseIfCronsCanFire,
  refuseIfForeignRows,
  restoreHeartbeat,
  runAsServiceRole,
  snapshotHeartbeat,
} from "../support/edgeJobIntegration.mjs";

const { Client } = pg;
const FUNCTIONS_URL = localFunctionsUrl("payments-reconcile");
const MP_TOKEN = "TEST-fixture-token";
const FIXTURE_PORT = 4547;
const COLLECTOR_ID = 1000000001; // compte encaisseur FICTIF (piège 19 : seul /users/me fait foi)
// Les coordonnées du payeur, que Mercado Pago renvoie et qu'aucun événement conservé ne doit porter.
const PAYER_EMAIL = "payer-fixture@test.local";

const P = "77780000-0000-4000-8000-";
const PARTNER_ID = `${P}000000000001`;
const ESTABLISHMENT_ID = `${P}000000000011`;
const PRODUCT_ID = `${P}000000000021`;
const ACCOUNT_ID = `${P}000000000031`;
const ord = (n) => `${P}000000000a${String(n).padStart(2, "0")}`;
const line = (n) => `${P}000000000b${String(n).padStart(2, "0")}`;
const pay = (n) => `${P}000000000c${String(n).padStart(2, "0")}`;

// Ce que Mercado Pago répond, par external_reference (= payments.id) et par id de paiement MP.
const mpPayment = (id, externalReference, status, amount = 17000, currency = "COP") => ({
  payer: { email: PAYER_EMAIL, first_name: "Payer", identification: { type: "CC", number: "0000000000" } },
  id,
  status,
  status_detail: status === "approved" ? "accredited" : status === "pending" ? "pending_waiting_transfer" : status,
  transaction_amount: amount,
  currency_id: currency,
  external_reference: externalReference,
  date_created: "2026-09-21T10:00:00.000-04:00",
  date_approved: status === "approved" ? "2026-09-21T10:00:30.000-04:00" : null,
  collector_id: COLLECTOR_ID,
  payment_type_id: status === "pending" ? "bank_transfer" : "credit_card",
});
const searchResults = {
  [pay(1)]: [mpPayment(910001, pay(1), "approved")],
  [pay(2)]: [],
  [pay(3)]: [mpPayment(910003, pay(3), "pending")],
  [pay(4)]: [mpPayment(910004, pay(4), "pending")],
  [pay(5)]: [],
  [pay(6)]: [mpPayment(910006, pay(6), "approved")],
  [pay(9)]: [mpPayment(910009, pay(9), "approved", 17000, "USD")],
  [pay(10)]: [mpPayment(910010, pay(10), "pending")],
};
// PUT /v1/payments/:id → ce que MP répond, puis ce que le re-GET renvoie.
const cancelBehaviour = {
  910003: { put: 200, after: "cancelled" },
  910004: { put: 400, after: "approved" }, // le virement a abouti entre le search et le PUT
  910010: { put: 400, after: "approved", currency: "USD" }, // … mais dans une autre devise
};
// POST /v1/payments/:id/refunds → ce que MP répond (corps à remplacer par des captures réelles
// de préprod dès qu'elles existent, spec 39 §10.5).
const refundBehaviour = {
  910007: { status: 201, body: { id: 55501, payment_id: 910007, amount: 17000, status: "approved", refund_mode: "standard" } },
  // Le corps recopie l'en-tête reçu (comme le ferait une page d'erreur bavarde) : la vérification
  // « aucun jeton conservé » porte sur une valeur réellement présente.
  910008: { status: 400, body: { message: "Payment-too-old-to-be-refunded", error: "bad_request", status: 400 }, echoAuthorization: true },
};
const seen = { me: 0, search: [], put: [], get: [], refunds: [] };

function startFixtureServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${MP_TOKEN}`) return send(401, { message: "invalid_token" });
    if (req.method === "GET" && url.pathname === "/users/me") {
      seen.me++;
      return send(200, { id: COLLECTOR_ID, nickname: "TESTUSER-fixture" });
    }
    if (req.method === "GET" && url.pathname === "/v1/payments/search") {
      const ref = url.searchParams.get("external_reference");
      seen.search.push(ref);
      // Une référence inconnue de la fixture n'est JAMAIS « rien chez MP » (qui ferait expirer la
      // commande) : une panne, rien ne bouge.
      if (!(ref in searchResults)) return send(500, { message: "référence inconnue de la fixture" });
      const results = searchResults[ref];
      return send(200, { paging: { total: results.length, limit: 50, offset: 0 }, results });
    }
    const r = url.pathname.match(/^\/v1\/payments\/(\d+)\/refunds$/);
    if (r && req.method === "POST") {
      const id = Number(r[1]);
      seen.refunds.push({ id, idempotencyKey: req.headers["x-idempotency-key"] ?? null });
      const behaviour = refundBehaviour[id];
      // Un remboursement inconnu n'est JAMAIS refusé (4xx = refus définitif) : une panne.
      if (!behaviour) return send(500, { message: "remboursement inconnu de la fixture" });
      return send(
        behaviour.status,
        behaviour.echoAuthorization ? { ...behaviour.body, request_headers: { authorization: req.headers.authorization } } : behaviour.body
      );
    }
    const m = url.pathname.match(/^\/v1\/payments\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      const behaviour = cancelBehaviour[id];
      if (req.method === "PUT") {
        seen.put.push(id);
        if (!behaviour) return send(500, { message: "paiement inconnu de la fixture" });
        return behaviour.put === 200
          ? send(200, { id, status: "cancelled" })
          : send(400, { message: "Payment cannot be cancelled", error: "bad_request", status: 400 });
      }
      if (req.method === "GET") {
        seen.get.push(id);
        if (!behaviour) return send(500, { message: "paiement inconnu de la fixture" });
        const ref = Object.keys(searchResults).find((k) => searchResults[k].some((p) => p.id === id));
        return send(200, mpPayment(id, ref, behaviour.after, 17000, behaviour.currency ?? "COP"));
      }
    }
    send(404, { message: "unhandled by fixture server" });
  });
  // Toutes les interfaces, pas 127.0.0.1 : la fonction tourne dans le conteneur du runtime Edge et
  // joint la fixture par host.docker.internal — sous Linux (job CI integration-edge), une écoute
  // limitée au loopback de l'hôte lui est injoignable. Même écoute que pms_sync_availability.
  return new Promise((resolve) => server.listen(FIXTURE_PORT, () => resolve(server)));
}

async function purge(client) {
  await client.query(`delete from payment_refunds where payment_id::text like '${P}%'`);
  await client.query(`delete from notification_emails where related_id in
    (select id from payment_reconciliation_entries where payment_id::text like '${P}%')`);
  await client.query(`delete from payment_reconciliation_entries where payment_id::text like '${P}%'`);
  await client.query(`delete from notification_emails where related_id::text like '${P}%'`);
  await client.query(`delete from payments where order_id::text like '${P}%'`);
  await client.query(`delete from order_lines where order_id::text like '${P}%'`);
  await client.query(`delete from orders where id::text like '${P}%'`);
  await client.query("delete from product_availability where product_id = $1", [PRODUCT_ID]);
  await client.query("delete from products where id = $1", [PRODUCT_ID]);
  await client.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await client.query("delete from partners where id = $1", [PARTNER_ID]);
  await client.query("delete from partner_accounts where id = $1", [ACCOUNT_ID]);
  await client.query("delete from auth.users where id = $1", [ACCOUNT_ID]);
}

async function makeOrder(client, n, { age, lineStatus = "reserved", paymentStatus = "pending", payment = true, paymentAge = age, collector = null }) {
  await client.query(
    `insert into orders (id, account_id, holder_name, holder_email, payment_status, created_at)
     values ($1, $2, $3, $4, $5, now() - $6::interval)`,
    [ord(n), ACCOUNT_ID, `Holder S${n}`, `s${n}@hifago.test`, paymentStatus, age]
  );
  await client.query(
    `insert into order_lines (id, order_id, account_id, product_id, date, qty, status, holder_name,
       price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop)
     values ($1, $2, $3, $4, '2028-11-01', 1, $5, 'Holder', 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000)`,
    [line(n), ord(n), ACCOUNT_ID, PRODUCT_ID, lineStatus]
  );
  if (payment) {
    await client.query(
      `insert into payments (id, order_id, status, amount_cop, created_at, mp_collector_id)
       values ($1, $2, $3, 17000, now() - $4::interval, $5)`,
      [pay(n), ord(n), lineStatus === "expired" ? "cancelled" : "pending", paymentAge, collector]
    );
  }
}

async function seed(client) {
  await purge(client);
  await client.query("insert into partners (id, display_name) values ($1, 'Reconcile Integration Partner')", [PARTNER_ID]);
  await client.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID, PARTNER_ID, JSON.stringify({ es: "Establecimiento Reconcile Integration" }),
  ]);
  await client.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values ($1, $2, $3, 'activity', jsonb_build_object('es', 'Actividad reconcile'), 100000, true, 'reconcile-integration')`,
    [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID]
  );
  // Une place par commande vivante : S1-S5, S9 et S10 (S6 a déjà été expirée par ailleurs : sa place
  // est déjà rendue), on part donc de 7.
  await client.query("insert into product_availability (product_id, date, capacity, booked) values ($1, '2028-11-01', 10, 7)", [PRODUCT_ID]);
  await client.query("insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing", [ACCOUNT_ID, "reconcile-integration@hifago.test"]);
  await makeOrder(client, 1, { age: "5 minutes" });
  await makeOrder(client, 2, { age: "35 minutes" });
  await makeOrder(client, 3, { age: "2 hours 10 minutes" });
  await makeOrder(client, 4, { age: "2 hours 10 minutes" });
  await makeOrder(client, 5, { age: "40 minutes", collector: "999999" });
  await makeOrder(client, 6, { age: "50 minutes", lineStatus: "expired", paymentStatus: "unpaid" });
  await makeOrder(client, 9, { age: "5 minutes" });
  await makeOrder(client, 10, { age: "2 hours 10 minutes" });
  // S7/S8 : deux commandes déjà expirées dont le paiement tardif a produit une entrée refund_required
  // (garde du Lot A), et pour lesquelles un admin a demandé le remboursement.
  for (const [n, mpId] of [[7, "910007"], [8, "910008"]]) {
    await makeOrder(client, n, { age: "3 hours", lineStatus: "expired", paymentStatus: "unpaid" });
    await client.query("update payments set mp_payment_id = $2, mp_last_status = 'approved' where id = $1", [pay(n), mpId]);
    const { rows: [entry] } = await client.query(
      `insert into payment_reconciliation_entries (payment_id, mp_payment_id, external_reference, raw_event, failure_reason, kind, reason_code)
       values ($1, $2, $3, '{"transaction_amount": 17000}'::jsonb, 'paiement approuvé après expiration de la commande', 'refund_required', 'paid_after_expiry')
       returning id`,
      [pay(n), mpId, pay(n)]
    );
    await client.query(
      `insert into payment_refunds (entry_id, payment_id, mp_payment_id, amount_cop, status, note)
       values ($1, $2, $3, 17000, 'pending', 'integration')`,
      [entry.id, pay(n), mpId]
    );
    await client.query("update payment_reconciliation_entries set status = 'retrying' where id = $1", [entry.id]);
  }
}

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  await refuseIfCronsCanFire(client);
  await refuseIfForeignRows(
    client,
    "commande(s) à rapprocher",
    `select count(*)::int as n from orders o
      where o.payment_status in ('unpaid', 'pending') and o.id::text not like $1
        and (exists (select 1 from order_lines ol where ol.order_id = o.id and ol.status = 'reserved' and ol.acompte_cop > 0)
             or exists (select 1 from payments p where p.order_id = o.id and p.status = 'pending'))`,
    [`${P}%`]
  );
  await refuseIfForeignRows(
    client,
    "paiement(s) sous surveillance",
    `select count(*)::int as n from payments
      where status in ('rejected', 'cancelled') and created_at > now() - interval '48 hours' and order_id::text not like $1`,
    [`${P}%`]
  );
  await refuseIfForeignRows(
    client,
    "remboursement(s) en attente",
    "select count(*)::int as n from payment_refunds where status = 'pending' and payment_id::text not like $1",
    [`${P}%`]
  );
  const fixture = await startFixtureServer();
  let exitCode = 0;
  const heartbeatBefore = await snapshotHeartbeat(client, "payments-reconcile");
  try {
    await seed(client);

    const authChecks = await callerChecks(FUNCTIONS_URL);
    authChecks.push([seen.me === 0, `aucun refus n'a appelé Mercado Pago (${seen.me})`]);

    const response = await runAsServiceRole(FUNCTIONS_URL, JSON.stringify({ limit: 25 }));
    let summary = null;
    try {
      summary = JSON.parse(response.text);
    } catch {
      // corps non JSON : summary reste null, les vérifications échouent.
    }
    console.log(`payments-reconcile → ${response.status}`, summary);
    if (response.status !== 200) throw new Error("la fonction n'a pas répondu 200");

    const { rows: orders } = await client.query(
      `select o.id, o.payment_status, ol.status as line_status, p.status as pay_status, p.mp_last_status, p.mp_cancel_attempts
         from orders o join order_lines ol on ol.order_id = o.id left join payments p on p.order_id = o.id
        where o.id::text like '${P}%' order by o.id`
    );
    const byOrder = Object.fromEntries(orders.map((r) => [r.id, r]));
    const { rows: [pa] } = await client.query("select booked from product_availability where product_id = $1", [PRODUCT_ID]);
    const { rows: entries } = await client.query(
      `select mp_payment_id, kind, reason_code, raw_event from payment_reconciliation_entries where payment_id::text like '${P}%'`
    );
    const { rows: events } = await client.query(
      `select id, raw_last_event from payments where order_id::text like '${P}%' and raw_last_event is not null`
    );
    const eventOf = (n) => events.find((e) => e.id === pay(n))?.raw_last_event ?? null;
    const { rows: [hb] } = await client.query("select last_ok_at, last_error, stats from job_heartbeats where job_name = 'payments-reconcile'");
    const { rows: refunds } = await client.query(
      `select r.mp_payment_id, r.status, r.mp_refund_id, r.last_error, r.raw_response, e.status as entry_status
         from payment_refunds r join payment_reconciliation_entries e on e.id = r.entry_id
        where r.payment_id::text like '${P}%' order by r.mp_payment_id`
    );
    const refundOf = (id) => refunds.find((r) => r.mp_payment_id === id);

    const checks = [
      ...authChecks,
      [seen.me === 1, `GET /users/me appelé une fois (obtenu ${seen.me})`],
      [byOrder[ord(1)]?.payment_status === "paid", `S1 approuvé tardif → paid (obtenu ${byOrder[ord(1)]?.payment_status})`],
      [byOrder[ord(2)]?.line_status === "expired" && byOrder[ord(2)]?.pay_status === "cancelled", `S2 rien chez MP à 35 min → expirée (ligne ${byOrder[ord(2)]?.line_status}, paiement ${byOrder[ord(2)]?.pay_status})`],
      [seen.put.includes(910003) && byOrder[ord(3)]?.line_status === "expired", `S3 PSE > 2 h, annulation acceptée → PUT envoyé, expirée (ligne ${byOrder[ord(3)]?.line_status})`],
      [seen.put.includes(910004) && byOrder[ord(4)]?.payment_status === "paid" && byOrder[ord(4)]?.line_status === "reserved", `S4 PUT refusé, re-GET approuvé → payée, jamais expirée (${byOrder[ord(4)]?.payment_status}/${byOrder[ord(4)]?.line_status})`],
      [byOrder[ord(5)]?.line_status === "reserved" && byOrder[ord(5)]?.payment_status === "pending", `S5 collector_id étranger → rien ne bouge (${byOrder[ord(5)]?.line_status})`],
      [hb?.last_error?.includes("identity_mismatch") === true, `S5 heartbeat ok=false, identity_mismatch (last_error: ${hb?.last_error})`],
      [entries.some((e) => e.mp_payment_id === "910006" && e.reason_code === "paid_after_expiry"), `S6 approuvé après expiration (surveillance) → refund_required (entrées: ${JSON.stringify(entries)})`],
      // S2 et S3 rendent leur place (6 → 4) ; S1/S4 payées, S5 et S9 intactes gardent la leur.
      // S2 et S3 rendent leur place (7 → 5) ; S1/S4 payées, S5, S9 et S10 intactes gardent la leur.
      [pa?.booked === 5, `D1-bis places rendues : booked 7 → 5 (obtenu ${pa?.booked})`],
      [byOrder[ord(9)]?.payment_status !== "paid" && byOrder[ord(9)]?.line_status === "reserved",
        `S9 approuvé en USD → montant inexploitable, jamais payée (${byOrder[ord(9)]?.payment_status}/${byOrder[ord(9)]?.line_status})`],
      [entries.some((e) => e.mp_payment_id === "910009" && e.kind === "refund_required" && e.reason_code === "amount_mismatch" &&
        e.raw_event?.currency_id === "USD" && e.raw_event?.transaction_amount === null && e.raw_event?.mp_transaction_amount === 17000),
        `S9 → entrée refund_required / amount_mismatch, événement aplati : devise et montant brut conservés (${JSON.stringify(entries.find((e) => e.mp_payment_id === "910009")?.raw_event)})`],
      [byOrder[ord(10)]?.payment_status !== "paid" && byOrder[ord(10)]?.line_status === "reserved" && seen.get.includes(910010),
        `S10 re-GET approuvé en USD → jamais payée, jamais expirée (${byOrder[ord(10)]?.payment_status}/${byOrder[ord(10)]?.line_status})`],
      [entries.some((e) => e.mp_payment_id === "910010" && e.reason_code === "amount_mismatch") &&
        eventOf(10)?.currency_id === "USD" && eventOf(10)?.transaction_amount === null && eventOf(10)?.mp_transaction_amount === 17000,
        `S10 → entrée amount_mismatch, événement aplati : montant exploitable null, brut conservé (${JSON.stringify(eventOf(10))})`],
      [eventOf(4)?.status === "approved" && eventOf(4)?.transaction_amount === 17000 && eventOf(4)?.currency_id === "COP",
        `S4 → événement aplati du re-GET conservé (${JSON.stringify(eventOf(4))})`],
      [!JSON.stringify(events).includes(PAYER_EMAIL) && !JSON.stringify(entries).includes(PAYER_EMAIL) && !JSON.stringify(events).includes("payer"),
        "aucun événement conservé ne porte le payeur (paiements et entrées de réconciliation)"],
      [summary?.applied === 2 && summary?.expired === 2 && summary?.identity_mismatch === 1 && summary?.checked_not_applied === 1 &&
        summary?.refunds_approved === 1 && summary?.refunds_rejected === 1 && summary?.errors === 0 && summary?.budget_hit === false,
        `stats : 2 appliquées, 2 expirées, 1 identité étrangère, 1 lue sans application (S10), remboursements 1/1, 0 erreur (${JSON.stringify(summary)})`],
      [summary?.ok === false && hb?.last_error === "identity_mismatch: MERCADOPAGO_ACCESS_TOKEN n'appartient pas au compte MP qui a créé les préférences (piège 19)",
        `ok=false, motif exact (${hb?.last_error})`],
      [!JSON.stringify(hb ?? {}).includes(MP_TOKEN) && !JSON.stringify(summary ?? {}).includes(MP_TOKEN) &&
        !(process.env.FUNCTION_LOG && readFileSync(process.env.FUNCTION_LOG, "utf8").includes(MP_TOKEN)),
        "le jeton Mercado Pago n'apparaît ni dans le heartbeat, ni dans la réponse, ni dans les journaux"],
      [Number(hb?.stats?.mp_calls) <= 60, `budget d'appels respecté (${hb?.stats?.mp_calls})`],
      [refundOf("910007")?.status === "approved" && refundOf("910007")?.mp_refund_id === "55501" && refundOf("910007")?.entry_status === "resolved",
        `S7 remboursement approuvé par MP → approved, refund 55501, entrée résolue (${JSON.stringify(refundOf("910007"))})`],
      [seen.refunds.some((x) => x.id === 910007 && typeof x.idempotencyKey === "string" && x.idempotencyKey.length === 36),
        `S7 POST /refunds porte X-Idempotency-Key = payment_refunds.id (${JSON.stringify(seen.refunds)})`],
      [refundOf("910008")?.status === "rejected" && refundOf("910008")?.entry_status === "open" && /too-old/.test(refundOf("910008")?.last_error ?? "") &&
        refundOf("910008")?.raw_response?.message === "Payment-too-old-to-be-refunded",
        `S8 refus MP 4xx → rejected, entrée rouverte, corps conservé (${JSON.stringify(refundOf("910008"))})`],
      [!JSON.stringify(refunds).includes(MP_TOKEN) && JSON.stringify(refunds).includes("[secret]"),
        "S8 → le corps recopiait l'en-tête Authorization : conservé masqué, jamais le jeton"],
    ];
    let failed = false;
    for (const [ok, label] of checks) {
      console.log(`${ok ? "OK " : "FAIL"} — ${label}`);
      if (!ok) failed = true;
    }
    if (failed) {
      console.error(
        `Échec — vérifier que supabase/functions/.env pointe MERCADOPAGO_API_BASE_URL vers http://host.docker.internal:${FIXTURE_PORT} ` +
          "avec MERCADOPAGO_ACCESS_TOKEN=TEST-fixture-token, et que supabase a été redémarré après ce réglage."
      );
      exitCode = 1;
    } else {
      console.log(`payments-reconcile : intégration bout en bout vérifiée (10 scénarios, ${checks.length} contrôles).`);
    }
  } catch (err) {
    console.error(err);
    exitCode = 1;
  } finally {
    await purge(client).catch((err) => console.error("Nettoyage final a échoué :", err));
    // Le heartbeat de ce job, tel qu'avant le test (la pile est partagée).
    await restoreHeartbeat(client, "payments-reconcile", heartbeatBefore).catch((err) =>
      console.error("Restauration du heartbeat a échoué :", err)
    );
    await client.end();
    await new Promise((resolve) => fixture.close(resolve));
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
