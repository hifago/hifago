// Époque du jeton Lobby (migration 20261004005336) sous concurrence réelle : le remplacement du
// jeton (set_establishment_pms_connector) contre les claims qui lisent ce jeton, les écrivains qui
// enfilent des annulations et la synchro du miroir.
//
// Ce qui ne se voit pas en pgTAP, et que chaque cas DÉTERMINISTE sert par construction (un
// coordinateur tient le verrou que les appels attendent ; chaque attente attendue est constatée sur
// la session elle-même, sinon le cas échoue) :
//   C1a  claim PUIS remplacement, la transaction du remplacement ouverte AVANT celle du claim : le
//        claim lit l'ancien jeton, son booking est classé ancien — l'époque est lue à l'horloge après
//        le verrou, jamais now() ;
//   C1b  remplacement écrit mais pas validé quand le claim part : le claim l'attend (for share) et lit
//        le NOUVEAU jeton, son booking est classé nouveau ;
//   C1c  le remplacement attend un établissement tenu en partage ; pendant ce temps un claim et son
//        record passent (partage compatible) avec l'ancien jeton : l'époque, prise APRÈS l'attente,
//        les classe anciens, et l'entrée est posée (jamais l'heure de l'instruction ni de la
//        transaction) ;
//   C2a  un écrivain tient une ligne bookée puis l'annule (enfilement → KEY SHARE sur
//        l'établissement) pendant que le remplacement attend cette ligne pour son entrée : aucun
//        interblocage (for no key update) ;
//   C2b  record_pms_booking sur une ligne qui porte déjà un booking, pendant le remplacement : aucun
//        interblocage (établissement avant la ligne) ;
//   C2c  record_pms_booking d'un booking vivant pendant le remplacement : il l'attend, puis pose
//        l'entrée que le remplacement n'a pas pu voir ;
//   C4   record_pms_booking (établissement, puis le mois du miroir) contre la synchro du même mois :
//        aucun interblocage, aucune invalidation perdue (la synchro prend l'établissement d'abord) ;
//   C5   deux bookings d'une commande dont l'ordre des numéros contredit celui des lignes, le
//        remplacement contre l'expiration de la commande (lignes par id) : aucun interblocage ;
//   C6   sonde : les rattrapages de claim_pms_cancellation_batch n'attendent jamais une annulation
//        tenue ailleurs.
// Puis une COURSE LIBRE (barrière) : un remplacement contre des expirations de commande, des issues
// de poll, des claims de réservation suivis de leur record, deux claims de poll et un claim
// d'annulation (annulés en fin de transaction : jamais une donnée étrangère modifiée).
//
// Attendu à chaque run : 0 interblocage (40P01), aucune erreur ; un booking est classé ancien si et
// seulement si le claim a lu l'ancien jeton ; chaque booking vivant ancien a exactement une entrée
// ouverte ; aucun claim d'annulation ne rend un booking ancien avec le nouveau jeton.
//
// ⚠️ Nettoyage AVANT et APRÈS chaque run. Préfixe d'identifiants dédié : 6b200000-. Stack locale.
import pg from "pg";

const { Client } = pg;
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5;
const RACE_ORDERS = 8; // course libre : commandes bookées à expirer ou à interroger
const RACE_CLAIMS = 4; // course libre : commandes à réserver (claim puis record)
const P = "6b200000-0000-4000-8000-";
const id = (n) => `${P}${String(n).padStart(12, "0")}`;
const PARTNER_ID = id(1);
const E_ID = id(2);
const LODGING_ID = id(4);
const ACTIVITY_ID = id(5);
const BUYER_ID = id(7);
const ADMIN_ID = id(8);
const orderId = (n) => id(1000 + n);
const lineId = (n) => id(2000 + n);
const activityId = (n) => id(3000 + n);
const booking = (n) => `CONC-TE-${n}`;
const OLD = "2026-01-01 00:00+00";
const CLASS = "jeton Lobby remplacé%";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect() {
  // Un mutant qui fait attendre un appel au-delà du raisonnable échoue au lieu de bloquer le banc.
  const client = new Client({ connectionString: CONNECTION_STRING, statement_timeout: 20_000 });
  await client.connect();
  return client;
}

async function asRole(role, sub) {
  const client = await connect();
  await client.query(`set role ${role}`);
  if (sub) {
    await client.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub, role: "authenticated" })]);
  }
  return client;
}

const run = (client, sql, params) =>
  client.query(sql, params).then(
    (res) => ({ ok: true, r: res.rows[0]?.r, rows: res.rows }),
    (error) => ({ ok: false, code: error.code, message: error.message })
  );

async function purge(seed) {
  await seed.query(
    `delete from notification_emails where related_table = 'pms_reconciliation_entries' and related_id in (
       select e.id from pms_reconciliation_entries e join order_lines ol on ol.id = e.order_line_id
        where ol.order_id::text like '${P}%')`
  );
  await seed.query(
    "delete from notification_emails where (related_table = 'establishments' and subject like '%Conc TE%') or recipient_account_id in ($1, $2)",
    [BUYER_ID, ADMIN_ID]
  );
  await seed.query(`delete from pms_reconciliation_entries where order_line_id in (select id from order_lines where order_id::text like '${P}%')`);
  await seed.query("delete from pms_cancellation_queue where pms_booking_id like 'CONC-TE-%'");
  await seed.query("delete from pms_sync_state where establishment_id = $1", [E_ID]);
  await seed.query("delete from pms_availability_mirror where establishment_id = $1", [E_ID]);
  await seed.query("delete from audit_log where actor_id = $1", [ADMIN_ID]);
  await seed.query(`delete from ledger_entries where order_line_id in (select id from order_lines where order_id::text like '${P}%')`);
  await seed.query(`delete from order_lines where order_id::text like '${P}%'`);
  await seed.query(`delete from orders where id::text like '${P}%'`);
  await seed.query("delete from product_availability where product_id = $1", [ACTIVITY_ID]);
  await seed.query("delete from products where id in ($1, $2)", [LODGING_ID, ACTIVITY_ID]);
  await seed.query("delete from establishments where id = $1", [E_ID]);
  await seed.query("delete from partner_capabilities where account_id = $1", [ADMIN_ID]);
  await seed.query("delete from partners where id = $1", [PARTNER_ID]);
  await seed.query("delete from partner_accounts where id in ($1, $2)", [BUYER_ID, ADMIN_ID]);
  await seed.query("delete from auth.users where id in ($1, $2)", [BUYER_ID, ADMIN_ID]);
}

async function seedRun(seed) {
  await purge(seed);
  await seed.query("insert into partners (id, display_name) values ($1, 'Conc TE')", [PARTNER_ID]);
  await seed.query(
    `insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token)
     values ($1, $2, jsonb_build_object('es', 'Conc TE'), true, 'tok-0')`,
    [E_ID, PARTNER_ID]
  );
  await seed.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id) values
       ($1, $3, $4, 'lodging', jsonb_build_object('es', 'Conc TE Noche'), 100000, true, 'conc-te-noche', 9961),
       ($2, $3, $4, 'activity', jsonb_build_object('es', 'Conc TE Actividad'), 30000, true, 'conc-te-actividad', null)`,
    [LODGING_ID, ACTIVITY_ID, PARTNER_ID, E_ID]
  );
  await seed.query("insert into auth.users (id, email) values ($1, 'conc-te-buyer@test.local'), ($2, 'conc-te-admin@test.local')", [
    BUYER_ID,
    ADMIN_ID,
  ]);
  await seed.query("insert into partner_capabilities (account_id, role, source, status) values ($1, 'admin', 'migration', 'active')", [
    ADMIN_ID,
  ]);
  // Les activités tiennent chacune une place (expiration et « gone » la rendent) : la course libre et C5.
  await seed.query("insert into product_availability (product_id, date, capacity, booked) values ($1, '2029-10-01', 100, $2)", [
    ACTIVITY_ID,
    RACE_ORDERS + 1,
  ]);
}

/**
 * Une commande et sa ligne de nuit (et, au besoin, une activité) : bookée ou à réserver.
 * `bookedAt` : un instant, ou "now" (l'horloge de la base au semis) ; `age` : 1 minute, la commande se
 * réserve encore ; 40 minutes, elle est expirable.
 */
async function seedOrder(seed, n, { status = "reserved", bookingId = null, activityBooking, bookedAt = null, claimedAt = null, withActivity = false, age = "1 minute" } = {}) {
  await seed.query(
    `insert into orders (id, account_id, holder_name, holder_email, payment_status, reference, pms_reserve_claimed_at, created_at)
     values ($1, $2, 'Conc TE', 'conc-te-buyer@test.local', 'unpaid', $3, $4, now() - $5::interval)`,
    [orderId(n), BUYER_ID, `CTE-${n}`, claimedAt, age]
  );
  const insertLine = (lid, pid, end, bk) =>
    seed.query(
      `insert into order_lines (
         id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
         price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
         acompte_cop, referrer_commission_cop, app_commission_cop, pms_booking_id, pms_booked_at
       ) values ($1, $2, $3, $4, '2029-10-01', $5, 1, $6, 'Conc TE', 100000, 100000, 'direct', 0.1, 0, 0.1, 10000, 0, 10000, $7,
                 case when $9 then clock_timestamp() else $8::timestamptz end)`,
      [lid, orderId(n), BUYER_ID, pid, end, status, bk, bookedAt === "now" ? null : bookedAt, bookedAt === "now"]
    );
  await insertLine(lineId(n), LODGING_ID, "2029-10-03", bookingId);
  if (withActivity) await insertLine(activityId(n), ACTIVITY_ID, null, activityBooking ?? bookingId);
}

/** La session `client` est-elle bloquée sur un verrou ? Faux si `pending` aboutit avant. */
async function waitForLock(seed, client, pending) {
  let settled = false;
  pending?.then(() => (settled = true), () => (settled = true));
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await seed.query("select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = $1", [
      client.processID,
    ]);
    if (rows[0]?.waiting) return true;
    if (settled) return false;
    await sleep(20);
  }
  throw new Error(`session ${client.processID} : ni attente ni fin en 10 s`);
}

const replace = (client, token) =>
  run(client, "select public.set_establishment_pms_connector($1, $2, true, 'concurrence') as r", [E_ID, token]);
const claim = (client, n) => run(client, "select public.claim_order_for_pms_booking($1) as r", [orderId(n)]);
const record = (client, n, claimedAt, bk = booking(n)) =>
  run(client, "select public.record_pms_booking($1, $2, $3, $4) as r", [orderId(n), claimedAt, lineId(n), bk]);

async function epoch(seed) {
  const { rows } = await seed.query("select lobby_token_changed_at as t, lobby_api_token as tok from establishments where id = $1", [E_ID]);
  return rows[0];
}

/** Classement du booking d'une ligne, et ses entrées ouvertes (commande, numéro). */
async function lineState(seed, n) {
  const { rows } = await seed.query(
    `select ol.pms_booked_at < e.lobby_token_changed_at as old,
            (select count(*)::int from pms_reconciliation_entries r join order_lines ol2 on ol2.id = r.order_line_id
              where ol2.order_id = ol.order_id and r.status in ('open', 'retrying') and r.detail like $2
                and strpos(r.detail, ' : booking Lobby ' || ol.pms_booking_id || ' posé ') > 0) as entries
       from order_lines ol join establishments e on e.id = $3 where ol.id = $1`,
    [lineId(n), CLASS, E_ID]
  );
  return rows[0];
}

async function withClients(roles, fn) {
  const clients = await Promise.all(roles.map(([role, sub]) => (role ? asRole(role, sub) : connect())));
  try {
    return await fn(...clients);
  } finally {
    await Promise.all(clients.map((c) => c.end().catch(() => {})));
  }
}

const ADMIN = ["authenticated", ADMIN_ID];
const SERVICE = ["service_role"];
const RAW = [null];
const ok = (r) => r.ok && r.r?.ok !== false;

// ── Cas déterministes ─────────────────────────────────────────────────────────────────────────
async function caseC1a(seed, n) {
  await seedOrder(seed, n);
  return withClients([ADMIN, SERVICE], async (admin, service) => {
    const before = await epoch(seed);
    await admin.query("begin");
    await admin.query("select 1"); // la transaction du remplacement commence AVANT celle du claim
    await service.query("begin");
    const c = await claim(service, n);
    const pending = replace(admin, "tok-c1a");
    const waited = await waitForLock(seed, admin, pending);
    await service.query("commit");
    const repl = await pending;
    await admin.query("commit");
    const rec = await record(service, n, c.r?.claimed_at);
    const st = await lineState(seed, n);
    const pass = waited && ok(c) && ok(repl) && ok(rec) && c.r?.groups?.[0]?.api_token === before.tok && st.old === true && st.entries === 1;
    if (!pass) console.error(`    C1a : attente ${waited}, jeton ${c.r?.groups?.[0]?.api_token} (avant ${before.tok}), classé ancien ${st.old}, entrées ${st.entries}`);
    return { pass, results: [c, repl, rec] };
  });
}

async function caseC1b(seed, n) {
  await seedOrder(seed, n);
  return withClients([ADMIN, SERVICE], async (admin, service) => {
    await admin.query("begin");
    const repl = await replace(admin, "tok-c1b");
    const pending = claim(service, n);
    const waited = await waitForLock(seed, service, pending);
    await admin.query("commit");
    const c = await pending;
    const rec = await record(service, n, c.r?.claimed_at);
    const st = await lineState(seed, n);
    const pass = waited && ok(repl) && ok(c) && ok(rec) && c.r?.groups?.[0]?.api_token === "tok-c1b" && st.old === false && st.entries === 0;
    if (!pass) console.error(`    C1b : attente du claim ${waited}, jeton ${c.r?.groups?.[0]?.api_token ?? c.code} (attendu tok-c1b), classé ancien ${st.old}, entrées ${st.entries}`);
    return { pass, results: [repl, c, rec] };
  });
}

async function caseC1c(seed, n) {
  await seedOrder(seed, n);
  return withClients([RAW, ADMIN, SERVICE], async (coordinator, admin, service) => {
    const before = await epoch(seed);
    await coordinator.query("begin");
    await coordinator.query("select 1 from establishments where id = $1 for share", [E_ID]);
    const pending = replace(admin, "tok-c1c");
    const waited = await waitForLock(seed, admin, pending);
    // Pendant que le remplacement attend : un claim et son record passent (partage compatible).
    const claimPending = claim(service, n);
    const claimWaited = await waitForLock(seed, service, claimPending);
    const c = await claimPending;
    const rec = claimWaited ? { ok: false, message: "non servi" } : await record(service, n, c.r?.claimed_at);
    await coordinator.query("rollback");
    const repl = await pending;
    const st = await lineState(seed, n);
    const pass = waited && !claimWaited && ok(c) && ok(rec) && ok(repl) && c.r?.groups?.[0]?.api_token === before.tok && st.old === true && st.entries === 1;
    if (!pass) console.error(`    C1c : attente du remplacement ${waited}, du claim ${claimWaited}, jeton ${c.r?.groups?.[0]?.api_token}, classé ancien ${st.old}, entrées ${st.entries}`);
    return { pass, results: [c, rec, repl] };
  });
}

async function caseC2a(seed, n) {
  await seedOrder(seed, n, { bookingId: booking(n), bookedAt: OLD });
  return withClients([RAW, ADMIN], async (writer, admin) => {
    await writer.query("begin");
    await writer.query("select 1 from order_lines where id = $1 for update", [lineId(n)]);
    const pending = replace(admin, "tok-c2a");
    const waited = await waitForLock(seed, admin, pending);
    const cancel = await run(writer, "update order_lines set status = 'cancelled_by_client' where id = $1", [lineId(n)]);
    await writer.query(cancel.ok ? "commit" : "rollback").catch(() => {});
    const repl = await pending;
    const pass = waited && cancel.ok && ok(repl);
    if (!pass) console.error(`    C2a : attente ${waited}, annulation ${cancel.code ?? "ok"}, remplacement ${repl.code ?? "ok"}`);
    return { pass, results: [cancel, repl] };
  });
}

async function caseC2b(seed, n) {
  // Le remplacement est arrêté par un coordinateur juste avant ses entrées (une annulation en attente
  // de l'établissement, qu'il fait échouer) ; record_pms_booking vise une ligne déjà bookée.
  await seedOrder(seed, n, { bookingId: booking(n), bookedAt: OLD, claimedAt: OLD });
  await seed.query("insert into pms_cancellation_queue (pms_booking_id, establishment_id, hifago_status) values ($1, $2, 'expired')", [
    booking(`${n}-Q`),
    E_ID,
  ]);
  return withClients([RAW, ADMIN, SERVICE], async (coordinator, admin, service) => {
    await coordinator.query("begin");
    await coordinator.query("select 1 from pms_cancellation_queue where pms_booking_id = $1 for update", [booking(`${n}-Q`)]);
    const replPending = replace(admin, "tok-c2b");
    const w1 = await waitForLock(seed, admin, replPending);
    const recPending = record(service, n, OLD, booking(`${n}-R`));
    const w2 = await waitForLock(seed, service, recPending);
    await coordinator.query("rollback");
    const [repl, rec] = await Promise.all([replPending, recPending]);
    const { rows } = await seed.query("select status from pms_cancellation_queue where pms_booking_id = $1", [booking(`${n}-R`)]);
    const pass = w1 && w2 && ok(repl) && rec.ok && rec.r?.reason === "already_booked" && rows.length === 1 && rows[0].status === "failed";
    if (!pass) console.error(`    C2b : attentes ${w1}/${w2}, remplacement ${repl.code ?? "ok"}, record ${JSON.stringify(rec.r ?? rec.code)}, file ${JSON.stringify(rows)}`);
    return { pass, results: [repl, rec] };
  });
}

async function caseC2c(seed, n) {
  // Le claim a lu l'ancien jeton ; le remplacement est arrêté APRÈS ses entrées (le compte de l'admin,
  // tenu par le coordinateur, bloque l'audit) ; le record du booking doit l'attendre.
  await seedOrder(seed, n);
  return withClients([RAW, ADMIN, SERVICE], async (coordinator, admin, service) => {
    const c = await claim(service, n);
    await coordinator.query("begin");
    await coordinator.query("select 1 from partner_accounts where id = $1 for update", [ADMIN_ID]);
    const replPending = replace(admin, "tok-c2c");
    const w1 = await waitForLock(seed, admin, replPending);
    const recPending = record(service, n, c.r?.claimed_at);
    const w2 = await waitForLock(seed, service, recPending);
    await coordinator.query("rollback");
    const [repl, rec] = await Promise.all([replPending, recPending]);
    const st = await lineState(seed, n);
    const pass = w1 && w2 && ok(c) && ok(repl) && ok(rec) && st.old === true && st.entries === 1;
    if (!pass) console.error(`    C2c : attentes ${w1}/${w2}, record ${JSON.stringify(rec.r ?? rec.code)}, classé ancien ${st.old}, entrées ${st.entries}`);
    return { pass, results: [c, repl, rec] };
  });
}

async function caseC4(seed, n) {
  // record_pms_booking tient l'établissement et attend sa ligne ; la synchro du même mois arrive.
  await seedOrder(seed, n, { claimedAt: OLD });
  return withClients([RAW, SERVICE, SERVICE], async (coordinator, service, syncer) => {
    const notices = [];
    service.on("notice", (msg) => notices.push(msg.message));
    await coordinator.query("begin");
    await coordinator.query("select 1 from order_lines where id = $1 for update", [lineId(n)]);
    const recPending = record(service, n, OLD);
    const w1 = await waitForLock(seed, service, recPending);
    const syncPending = run(syncer, "select public.sync_pms_availability_month($1, '2029-10', '[]'::jsonb) as r", [E_ID]);
    const w2 = await waitForLock(seed, syncer, syncPending);
    await coordinator.query("rollback");
    const [rec, sync] = await Promise.all([recPending, syncPending]);
    const lost = notices.filter((m) => m.includes("invalidation du miroir impossible"));
    const pass = w1 && w2 && ok(rec) && ok(sync) && lost.length === 0;
    if (!pass) console.error(`    C4 : attentes ${w1}/${w2}, record ${JSON.stringify(rec.r ?? rec.code)}, synchro ${JSON.stringify(sync.r ?? sync.code)}, invalidations perdues ${lost.length}`);
    return { pass, results: [rec, sync] };
  });
}

async function caseC5(seed, n) {
  // Deux bookings anciens d'une commande expirable : « …-9 » sur la plus petite ligne, « …-10 » (avant
  // « …-9 » dans l'ordre du texte) sur la plus grande. Le remplacement attend la grande ; l'expiration
  // prend les lignes par id.
  await seedOrder(seed, n, {
    bookingId: `CONC-TE-${n}-9`, activityBooking: `CONC-TE-${n}-10`, bookedAt: OLD, withActivity: true, age: "40 minutes",
  });
  return withClients([RAW, ADMIN, SERVICE], async (coordinator, admin, service) => {
    await coordinator.query("begin");
    await coordinator.query("select 1 from order_lines where id = $1 for update", [activityId(n)]);
    const replPending = replace(admin, "tok-c5");
    const w1 = await waitForLock(seed, admin, replPending);
    const expPending = run(service, "select public.expire_payment_order($1, now()) as r", [orderId(n)]);
    const w2 = await waitForLock(seed, service, expPending);
    await coordinator.query("rollback");
    const [repl, exp] = await Promise.all([replPending, expPending]);
    const pass = w1 && w2 && ok(repl) && exp.ok;
    if (!pass) console.error(`    C5 : attentes ${w1}/${w2}, remplacement ${repl.code ?? "ok"}, expiration ${JSON.stringify(exp.r ?? exp.code)}`);
    return { pass, results: [repl, exp] };
  });
}

async function caseC6(seed, n) {
  // Une annulation au plafond (rattrapage a) et celle d'un booking ancien (rattrapage b), tenues par un
  // coordinateur : la réclamation ne les attend pas.
  await seedOrder(seed, n, { status: "cancelled_by_client", bookingId: booking(n), bookedAt: OLD });
  await seed.query(
    `insert into pms_cancellation_queue (pms_booking_id, establishment_id, hifago_status, attempts) values
       ($1, $3, 'expired', 3), ($2, $3, 'cancelled_by_client', 0)`,
    [booking(`${n}-cap`), booking(n), E_ID]
  );
  return withClients([RAW, SERVICE], async (coordinator, prober) => {
    await coordinator.query("begin");
    await coordinator.query("select 1 from pms_cancellation_queue where pms_booking_id in ($1, $2) for update", [booking(`${n}-cap`), booking(n)]);
    await prober.query("set statement_timeout = '3s'");
    await prober.query("begin");
    const probe = await run(prober, "select count(*)::int as r from public.claim_pms_cancellation_batch(1000, 3)", []);
    await prober.query("rollback").catch(() => {});
    await coordinator.query("rollback");
    if (!probe.ok) console.error(`    C6 : la réclamation a attendu une annulation tenue ailleurs (${probe.code})`);
    return { pass: probe.ok, results: [probe] };
  });
}

// ── Course libre ──────────────────────────────────────────────────────────────────────────────
async function race(seed, base) {
  // 1..RACE_ORDERS : commandes bookées APRÈS le dernier remplacement (nouvelles jusqu'à la course),
  // nuit + activité sur le même booking — une sur deux expire, l'autre reçoit une issue « gone ».
  // RACE_ORDERS+1.. : commandes à réserver.
  for (let k = 1; k <= RACE_ORDERS; k++) {
    await seedOrder(seed, base + k, { bookingId: booking(base + k), bookedAt: "now", withActivity: true, age: "40 minutes" });
  }
  for (let k = 1; k <= RACE_CLAIMS; k++) await seedOrder(seed, base + RACE_ORDERS + k);
  const tokenBefore = (await epoch(seed)).tok;
  const admin = await asRole(...ADMIN);
  const workers = await Promise.all(Array.from({ length: RACE_ORDERS + RACE_CLAIMS + 3 }, () => asRole(...SERVICE)));
  let ready = 0;
  let release;
  const go = new Promise((resolve) => (release = resolve));
  const total = 1 + RACE_ORDERS + RACE_CLAIMS + 3;
  const arm = () => {
    if (++ready === total) release();
  };
  // Les claims globaux tournent dans une transaction annulée : on garde ce qu'ils rendent, rien d'autre.
  const rolledBack = async (client, sql) => {
    await client.query("begin");
    const out = await run(client, sql, []);
    await client.query("rollback").catch(() => {});
    return out;
  };
  const tasks = [
    (async () => (arm(), await go, { who: "replace", ...(await replace(admin, "tok-race")) }))(),
    ...Array.from({ length: RACE_ORDERS }, (_, i) => (async () => {
      arm();
      await go;
      const n = base + 1 + i;
      return i % 2 === 0
        ? { who: "expire", n, ...(await run(workers[i], "select public.expire_payment_order($1, now()) as r", [orderId(n)])) }
        : { who: "gone", n, ...(await run(workers[i], "select public.apply_pms_poll_outcome($1, 'gone', 'concurrence') as r", [lineId(n)])) };
    })()),
    ...Array.from({ length: RACE_CLAIMS }, (_, i) => (async () => {
      arm();
      await go;
      const n = base + RACE_ORDERS + 1 + i;
      const client = workers[RACE_ORDERS + i];
      const c = await claim(client, n);
      const rec = ok(c) ? await record(client, n, c.r?.claimed_at) : { ok: false, message: `claim ${JSON.stringify(c.r ?? c.code)}` };
      const failed = [c, rec].find((r) => !ok(r));
      return { who: "claim+record", n, token: c.r?.groups?.[0]?.api_token, ok: !failed, code: failed?.code, message: failed?.message };
    })()),
    ...[0, 1].map((k) => (async () => (arm(), await go, {
      who: "poll-claim", ...(await rolledBack(workers[RACE_ORDERS + RACE_CLAIMS + k], "select count(*)::int as r from public.claim_pms_poll_batch(50)")),
    }))()),
    (async () => (arm(), await go, {
      who: "cancel-claim",
      ...(await rolledBack(workers[RACE_ORDERS + RACE_CLAIMS + 2],
        "select pms_booking_id, lobby_api_token, 1 as r from public.claim_pms_cancellation_batch(50, 3) where pms_booking_id like 'CONC-TE-%'")),
    }))(),
  ];
  const results = await Promise.all(tasks);
  await Promise.all([admin, ...workers].map((c) => c.end().catch(() => {})));

  // Aucun claim d'annulation (pendant la course, puis un de plus) ne rend un booking ancien avec le
  // NOUVEAU jeton. Avec l'ancien, c'est cohérent : la réclamation a lu le jeton avant le remplacement.
  const after = await asRole(...SERVICE);
  const post = await rolledBack(after,
    "select pms_booking_id, lobby_api_token, 1 as r from public.claim_pms_cancellation_batch(1000, 3) where pms_booking_id like 'CONC-TE-%'");
  await after.end();
  const claimed = [...(results.find((r) => r.who === "cancel-claim").rows ?? []), ...(post.rows ?? [])]
    .filter((r) => r.lobby_api_token === "tok-race");
  const { rows: oldClaimed } = await seed.query(
    `select b from unnest($1::text[]) b where exists (
       select 1 from order_lines ol join products p on p.id = ol.product_id join establishments e on e.id = p.establishment_id
        where ol.pms_booking_id = b and e.id = $2 and coalesce(ol.pms_booked_at, ol.created_at) < e.lobby_token_changed_at)`,
    [claimed.map((r) => r.pms_booking_id), E_ID]
  );
  // Chaque booking vivant ancien d'E : exactement une entrée ouverte (commande, numéro).
  const { rows: entries } = await seed.query(
    `select distinct ol.order_id, ol.pms_booking_id,
            (select count(*)::int from pms_reconciliation_entries r join order_lines ol2 on ol2.id = r.order_line_id
              where ol2.order_id = ol.order_id and r.status in ('open', 'retrying') and r.detail like $2
                and strpos(r.detail, ' : booking Lobby ' || ol.pms_booking_id || ' posé ') > 0) as n
       from order_lines ol join products p on p.id = ol.product_id join establishments e on e.id = p.establishment_id
      where e.id = $1 and ol.order_id::text like '${P}%' and ol.status = 'reserved' and ol.pms_booking_id is not null
        and coalesce(ol.pms_booked_at, ol.created_at) < e.lobby_token_changed_at`,
    [E_ID, CLASS]
  );
  const badEntries = entries.filter((r) => r.n !== 1);
  // Classé ancien si et seulement si le claim a lu l'ancien jeton.
  const misclassified = [];
  for (const r of results.filter((x) => x.who === "claim+record" && x.ok)) {
    const st = await lineState(seed, r.n);
    if (st.old !== (r.token === tokenBefore)) misclassified.push(`${r.n}:${r.token}:${st.old}`);
  }
  for (const row of oldClaimed) console.error(`    annulation d'un booking ancien rendue avec le nouveau jeton : ${row.b}`);
  return { results: [...results, { who: "post-claim", ...post }], oldClaimed: oldClaimed.length, badEntries, misclassified };
}

async function runOnce(runNumber, seed) {
  await seedRun(seed);
  const cases = [];
  for (const [name, fn, n] of [
    ["C1a", caseC1a, 10], ["C1b", caseC1b, 20], ["C1c", caseC1c, 25], ["C2a", caseC2a, 30], ["C2b", caseC2b, 40],
    ["C2c", caseC2c, 45], ["C4", caseC4, 60], ["C5", caseC5, 70], ["C6", caseC6, 80],
  ]) {
    cases.push([name, await fn(seed, n)]);
  }
  const r = await race(seed, 100);
  const all = [...cases.flatMap(([, c]) => c.results), ...r.results];
  const deadlocks = all.filter((x) => x && x.ok === false && x.code === "40P01");
  const errors = r.results.filter((x) => x && x.ok === false && x.code !== "40P01");
  const tally = {};
  for (const x of r.results) {
    const key = `${x.who}:${x.ok ? x.r?.reason ?? x.r?.outcome ?? "ok" : "erreur"}`;
    tally[key] = (tally[key] ?? 0) + 1;
  }
  console.log(
    `  run ${runNumber}: cas ${cases.filter(([, c]) => c.pass).length}/${cases.length} (${cases.map(([k, c]) => `${k}${c.pass ? "" : "✗"}`).join(" ")}), ` +
      `40P01 ${deadlocks.length}, erreurs ${errors.length}, mal classés ${r.misclassified.length}, ` +
      `bookings anciens sans entrée unique ${r.badEntries.length}, annulations anciennes rendues avec le nouveau jeton ${r.oldClaimed} — course ${JSON.stringify(tally)}`
  );
  for (const x of [...deadlocks, ...errors]) console.error(`    ${x.who ?? "cas"} : ${x.code} ${x.message}`);
  for (const m of r.misclassified) console.error(`    mal classé (commande:jeton:ancien) ${m}`);
  await purge(seed);
  return (
    cases.every(([, c]) => c.pass) &&
    deadlocks.length === 0 &&
    errors.length === 0 &&
    r.misclassified.length === 0 &&
    r.badEntries.length === 0 &&
    r.oldClaimed === 0
  );
}

async function main() {
  const seed = await connect();
  let clean = true;
  try {
    for (let k = 1; k <= RUNS; k++) {
      if (!(await runOnce(k, seed))) clean = false;
    }
  } finally {
    await purge(seed);
    await seed.end();
  }
  if (!clean) {
    console.error("ÉCHEC : l'époque du jeton Lobby ne tient pas sous concurrence.");
    process.exit(1);
  }
  console.log(
    `${RUNS} runs consécutifs propres — chaque ordre servi par construction, aucun interblocage, un booking classé ancien si et seulement si son claim a lu l'ancien jeton, aucune annulation d'un booking ancien rendue.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
