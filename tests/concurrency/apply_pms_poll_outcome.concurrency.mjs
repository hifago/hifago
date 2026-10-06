// Issue « booking disparu » du poll Lobby (migration 20261003223900) contre les autres écrivains des
// mêmes lignes — apply_pms_poll_outcome(…, 'gone') rend les places des activités du booking : c'est
// une opération de capacité (CLAUDE.md §4), prouvée sous concurrence réelle.
//
// Par commande : une nuit PMS et une activité qui partagent le booking. La RPC `gone` part en même
// temps (barrière) qu'UN adversaire, à tour de rôle : cancel_order_line (le client annule l'activité :
// la place est rendue depuis la migration 20261006192424), modify_order_line (l'admin tente de
// déplacer l'activité : refusée sans rien écrire depuis 20261006204938, une prestation adossée à un
// booking LobbyPMS ne se modifie pas) ou expire_payment_order (la commande expire : les places
// reviennent). Tous prennent la commande avant la capacité : ils sont sérialisés.
//
// Deux phases par run :
//   1. DÉTERMINISTE — chaque adversaire est servi dans les DEUX ordres, par construction : un
//      coordinateur tient la commande, que tous prennent en premier (cancel_order_line aussi depuis
//      20261006192424), le premier appel part et sa mise en attente est constatée, puis le second,
//      puis le coordinateur relâche — la file d'attente du verrou sert le premier arrivé. L'issue
//      exacte de chacun est vérifiée.
//   2. COURSE LIBRE — la RPC et un adversaire par commande, libérés ensemble par une barrière, avec
//      deux claim_pms_poll_batch (ils prennent les lignes sans jamais attendre). L'ordre est celui de
//      la machine : cette phase cherche les interblocages, pas la couverture des ordres.
//
// Attendu à chaque run, quel que soit l'ordre :
//   - 0 interblocage (40P01), aucune erreur hors le refus attendu de modify_order_line quand la
//     ligne n'est plus `reserved` (servie avant, elle rend `pms_line_not_modifiable`, sans erreur) ;
//   - pour chaque date, `booked` = la somme des quantités des lignes encore `reserved` (toute
//     annulation rend sa place depuis 20261006192424) — jamais une place rendue deux fois, jamais une
//     place perdue ;
//   - plus aucune ligne `reserved` sur un booking, et exactement UNE annulation en file par booking.
// Avant chaque run, une sonde DÉTERMINISTE : une ligne sœur tenue par une autre transaction, le claim
// doit répondre sans l'attendre (skip locked).
//
// ⚠️ Nettoyage AVANT et APRÈS chaque run. Préfixe d'identifiants dédié : 6a000000-. Stack locale.
import pg from "pg";

const { Client } = pg;
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5;
const ORDERS = 12; // course libre : commandes 1 à ORDERS
// Phase déterministe : commandes ORDERS + 1 à ORDERS + 6, une par (adversaire, premier servi).
const CASES = [
  { kind: "cancel", first: "poll" },
  { kind: "cancel", first: "opponent" },
  { kind: "modify", first: "poll" },
  { kind: "modify", first: "opponent" },
  { kind: "expire", first: "poll" },
  { kind: "expire", first: "opponent" },
];
const TOTAL = ORDERS + CASES.length;
const P = "6a000000-0000-4000-8000-";
const id = (n) => `${P}${String(n).padStart(12, "0")}`;
const PARTNER_ID = id(1);
const ESTABLISHMENT_ID = id(2);
const LODGING_ID = id(3);
const ACTIVITY_ID = id(4);
const BUYER_ID = id(5);
const ADMIN_ID = id(6);
const DATE = "2029-08-10";
const DATE_MOVED = "2029-08-11";
const orderId = (i) => id(1000 + i);
const nightLineId = (i) => id(2000 + i);
const activityLineId = (i) => id(3000 + i);
const booking = (i) => `CONC-PO-${i}`;
// Une commande « ancre » garde ANCHOR places aux deux dates, jamais touchée : sans elle, `booked`
// finirait à 0 et le plancher de release_order_line_capacity (greatest(0, …)) masquerait une place
// rendue deux fois.
const ANCHOR = 3;
const ANCHOR_ORDER = id(9001);
const anchorLineId = (k) => id(9002 + k);
const OPPONENTS = ["cancel", "modify", "expire"];
const CLAIMERS = 2;
const MODIFY_REFUSED = /seule une ligne au statut reserved/;
const gone = (lines) => (r) => r.ok && r.r?.ok === true && r.r?.outcome === "gone" && r.r?.lines === lines;
// L'issue EXACTE attendue de chaque appel, selon qui est servi le premier.
const EXPECTED = {
  "cancel/poll": { poll: gone(2), opponent: (r) => r.ok && r.r?.reason === "line_not_active" },
  "cancel/opponent": { poll: gone(1), opponent: (r) => r.ok && r.r?.ok === true },
  // Le seul refus attendu de modify_order_line : la ligne n'est plus `reserved`.
  "modify/poll": { poll: gone(2), opponent: (r) => !r.ok && MODIFY_REFUSED.test(r.message) },
  // Servie la première, modify_order_line refuse sans rien écrire une prestation adossée à un booking
  // LobbyPMS (migration 20261006204938) : la RPC trouve encore les deux lignes.
  "modify/opponent": { poll: gone(2), opponent: (r) => r.ok && r.r?.ok === false && r.r?.reason === "pms_line_not_modifiable" },
  "expire/poll": { poll: gone(2), opponent: (r) => r.ok && r.r?.reason === "not_candidate" },
  "expire/opponent": { poll: (r) => r.ok && r.r?.reason === "no_live_line", opponent: (r) => r.ok && r.r?.ok === true },
};
const QUERY_FRAGMENT = {
  poll: "apply_pms_poll_outcome",
  cancel: "cancel_order_line",
  modify: "modify_order_line",
  expire: "expire_payment_order",
};

async function connect() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  return client;
}

async function purge(seed) {
  await seed.query(
    `delete from notification_emails where related_table = 'pms_reconciliation_entries' and related_id in (
       select e.id from pms_reconciliation_entries e join order_lines ol on ol.id = e.order_line_id
        where ol.order_id::text like '${P}%')`
  );
  await seed.query(
    `delete from pms_reconciliation_entries where order_line_id in (select id from order_lines where order_id::text like '${P}%')`
  );
  // Les confirmations d'annulation (migration 20261006192424) portent sur les lignes.
  await seed.query(`delete from notification_emails where related_table = 'order_lines' and related_id::text like '${P}%'`);
  await seed.query("delete from pms_cancellation_queue where pms_booking_id like 'CONC-PO-%'");
  await seed.query("delete from pms_sync_state where establishment_id = $1", [ESTABLISHMENT_ID]);
  await seed.query("delete from audit_log where actor_id = $1", [ADMIN_ID]);
  await seed.query(`delete from order_lines where order_id::text like '${P}%'`);
  await seed.query(`delete from orders where id::text like '${P}%'`);
  await seed.query("delete from product_availability where product_id in ($1, $2)", [LODGING_ID, ACTIVITY_ID]);
  await seed.query("delete from products where id in ($1, $2)", [LODGING_ID, ACTIVITY_ID]);
  await seed.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await seed.query("delete from partner_capabilities where account_id = $1", [ADMIN_ID]);
  await seed.query("delete from partners where id = $1", [PARTNER_ID]);
  await seed.query("delete from partner_accounts where id in ($1, $2)", [BUYER_ID, ADMIN_ID]);
  await seed.query("delete from auth.users where id in ($1, $2)", [BUYER_ID, ADMIN_ID]);
}

async function seedRun(seed) {
  await purge(seed);
  await seed.query("insert into partners (id, display_name) values ($1, 'Poll Outcome Concurrency')", [PARTNER_ID]);
  await seed.query(
    `insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token)
     values ($1, $2, jsonb_build_object('es', 'Poll Outcome Concurrency'), true, 'tok-conc-po')`,
    [ESTABLISHMENT_ID, PARTNER_ID]
  );
  await seed.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id) values
       ($1, $3, $4, 'lodging', jsonb_build_object('es', 'Conc PO Nuit'), 100000, true, 'conc-po-nuit', 9911),
       ($2, $3, $4, 'activity', jsonb_build_object('es', 'Conc PO Actividad'), 30000, true, 'conc-po-actividad', null)`,
    [LODGING_ID, ACTIVITY_ID, PARTNER_ID, ESTABLISHMENT_ID]
  );
  await seed.query("insert into auth.users (id, email) values ($1, 'conc-po-buyer@test.local'), ($2, 'conc-po-admin@test.local')", [
    BUYER_ID,
    ADMIN_ID,
  ]);
  await seed.query("insert into partner_capabilities (account_id, role, source, status) values ($1, 'admin', 'migration', 'active')", [
    ADMIN_ID,
  ]);
  // Chaque commande tient UNE place de l'activité à DATE ; l'ancre en tient ANCHOR à chaque date.
  await seed.query(
    "insert into product_availability (product_id, date, capacity, booked) values ($1, $2, 100, $4), ($1, $3, 100, $5)",
    [ACTIVITY_ID, DATE, DATE_MOVED, TOTAL + ANCHOR, ANCHOR]
  );
  await seed.query(
    `insert into orders (id, account_id, holder_name, holder_email, payment_status)
     values ($1, $2, 'Conc PO', 'conc-po-buyer@test.local', 'paid')`,
    [ANCHOR_ORDER, BUYER_ID]
  );
  for (const [k, date] of [DATE, DATE_MOVED].entries()) {
    await seed.query(
      `insert into order_lines (
         id, order_id, account_id, product_id, date, qty, status, holder_name,
         price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
         acompte_cop, referrer_commission_cop, app_commission_cop
       ) values ($1, $2, $3, $4, $5, $6, 'reserved', 'Conc PO', 30000, 30000 * $6::int, 'direct', 0.1, 0, 0.1,
                 3000 * $6::int, 0, 3000 * $6::int)`,
      [anchorLineId(k), ANCHOR_ORDER, BUYER_ID, ACTIVITY_ID, date, ANCHOR]
    );
  }
  for (let i = 1; i <= TOTAL; i++) {
    await seed.query(
      `insert into orders (id, account_id, holder_name, holder_email, payment_status, created_at)
       values ($1, $2, 'Conc PO', 'conc-po-buyer@test.local', 'unpaid', now() - interval '40 minutes')`,
      [orderId(i), BUYER_ID]
    );
    await seed.query(
      `insert into order_lines (
         id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
         price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
         acompte_cop, referrer_commission_cop, app_commission_cop, pms_booking_id
       ) values
         ($1, $3, $4, $5, '2029-08-09', '2029-08-11', 1, 'reserved', 'Conc PO', 100000, 100000, 'direct', 0.1, 0, 0.1, 10000, 0, 10000, $7),
         ($2, $3, $4, $6, $8, null, 1, 'reserved', 'Conc PO', 30000, 30000, 'direct', 0.1, 0, 0.1, 3000, 0, 3000, $7)`,
      [nightLineId(i), activityLineId(i), orderId(i), BUYER_ID, LODGING_ID, ACTIVITY_ID, booking(i), DATE]
    );
  }
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
    (res) => ({ ok: true, r: res.rows[0]?.r }),
    (error) => ({ ok: false, code: error.code, message: error.message })
  );

function opponentCall(kind, client, i) {
  if (kind === "cancel") return run(client, "select public.cancel_order_line($1) as r", [activityLineId(i)]);
  if (kind === "modify") {
    return run(client, "select public.modify_order_line($1, $2::date, 1, 'concurrence') as r", [activityLineId(i), DATE_MOVED]);
  }
  return run(client, "select public.expire_payment_order($1, now()) as r", [orderId(i)]);
}

async function opponentClient(kind) {
  if (kind === "cancel") return asRole("authenticated", BUYER_ID);
  if (kind === "modify") return asRole("authenticated", ADMIN_ID);
  return asRole("service_role");
}

/** Attend qu'une session soit bloquée sur un verrou en exécutant `fragment` (paramètres invisibles). */
async function waitForLockWait(seed, fragment) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await seed.query(
      "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like $1",
      [`%${fragment}%`]
    );
    if (rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`aucune attente de verrou constatée pour ${fragment}`);
}

/** Phase déterministe : sert la RPC et l'adversaire dans l'ordre demandé, sur la commande i. */
async function serveInOrder(seed, { kind, first }, i) {
  const coordinator = await connect();
  const poller = await asRole("service_role");
  const opponent = await opponentClient(kind);
  try {
    await coordinator.query("begin");
    await coordinator.query("select 1 from orders where id = $1 for update", [orderId(i)]);
    const launch = (who) =>
      who === "poll"
        ? run(poller, "select public.apply_pms_poll_outcome($1, 'gone', 'concurrence') as r", [nightLineId(i)])
        : opponentCall(kind, opponent, i);
    const order = first === "poll" ? ["poll", "opponent"] : ["opponent", "poll"];
    const fragment = (who) => QUERY_FRAGMENT[who === "poll" ? "poll" : kind];
    const firstCall = launch(order[0]);
    await waitForLockWait(seed, fragment(order[0]));
    const secondCall = launch(order[1]);
    await waitForLockWait(seed, fragment(order[1]));
    await coordinator.query("rollback");
    const [a, b] = await Promise.all([firstCall, secondCall]);
    const byWho = { [order[0]]: a, [order[1]]: b };
    const expected = EXPECTED[`${kind}/${first}`];
    const ok = expected.poll(byWho.poll) && expected.opponent(byWho.opponent);
    if (!ok) {
      console.error(`    ordre ${kind}/${first} (commande ${i}) : issue inattendue — poll ${JSON.stringify(byWho.poll)}, ${kind} ${JSON.stringify(byWho.opponent)}`);
    }
    return { ok, results: [{ i, who: "poll", ...byWho.poll }, { i, who: kind, ...byWho.opponent }] };
  } finally {
    await Promise.all([coordinator, poller, opponent].map((c) => c.end().catch(() => {})));
  }
}

async function runOnce(runNumber, seed) {
  await seedRun(seed);
  // Sonde : l'activité de la commande 1 est tenue ailleurs ; sa nuit (même booking) est réclamable.
  const holder = await connect();
  const probe = await asRole("service_role");
  await holder.query("begin");
  await holder.query("select 1 from order_lines where id = $1 for update", [activityLineId(1)]);
  await probe.query("set statement_timeout = '3s'");
  const probeResult = await run(probe, "select count(*)::int as r from public.claim_pms_poll_batch(1000)", []);
  await holder.query("rollback");
  await Promise.all([holder, probe].map((c) => c.end().catch(() => {})));
  const probeOk = probeResult.ok;
  if (!probeOk) console.error(`    sonde : le claim a attendu une ligne sœur tenue ailleurs (${probeResult.code})`);

  // Phase 1 — déterministe.
  const deterministic = [];
  for (const [k, c] of CASES.entries()) deterministic.push(await serveInOrder(seed, c, ORDERS + 1 + k));
  const deterministicOk = deterministic.every((d) => d.ok);

  // Phase 2 — course libre.
  const pollers = await Promise.all(Array.from({ length: ORDERS }, () => asRole("service_role")));
  const opponents = await Promise.all(
    Array.from({ length: ORDERS }, (_, k) => opponentClient(OPPONENTS[k % OPPONENTS.length]))
  );
  const claimers = await Promise.all(Array.from({ length: CLAIMERS }, () => asRole("service_role")));
  let ready = 0;
  let release;
  const go = new Promise((resolve) => (release = resolve));
  const arm = () => {
    if (++ready === ORDERS * 2 + CLAIMERS) release();
  };
  const results = await Promise.all([
    ...claimers.map(async (client, k) => {
      arm();
      await go;
      return { i: `claim-${k}`, who: "claim", ...(await run(client, "select count(*)::int as r from public.claim_pms_poll_batch(50)", [])) };
    }),
    ...Array.from({ length: ORDERS }, (_, k) => k + 1).flatMap((i) => [
      (async () => {
        arm();
        await go;
        return { i, who: "poll", ...(await run(pollers[i - 1], "select public.apply_pms_poll_outcome($1, 'gone', 'concurrence') as r", [nightLineId(i)])) };
      })(),
      (async () => {
        arm();
        await go;
        const kind = OPPONENTS[(i - 1) % OPPONENTS.length];
        return { i, who: kind, ...(await opponentCall(kind, opponents[i - 1], i)) };
      })(),
    ]),
  ]);
  await Promise.all([...pollers, ...opponents, ...claimers].map((c) => c.end().catch(() => {})));

  const deadlocks = results.filter((r) => !r.ok && r.code === "40P01");
  // Seul refus attendu : modify_order_line sur une ligne que la RPC a déjà annulée.
  const unexpected = results.filter(
    (r) => !r.ok && r.code !== "40P01" && !(r.who === "modify" && MODIFY_REFUSED.test(r.message))
  );
  const { rows: capacity } = await seed.query(
    `select pa.date::text as date, pa.booked,
            (select coalesce(sum(ol.qty), 0)::int from order_lines ol
              where ol.product_id = pa.product_id and ol.date = pa.date
                and ol.status = 'reserved') as expected
       from product_availability pa where pa.product_id = $1 order by pa.date`,
    [ACTIVITY_ID]
  );
  // L'ancre garde au moins ANCHOR places réservées à chaque date : une place rendue deux fois fait
  // descendre `booked` sous `expected` au lieu d'être masquée par le plancher 0.
  const badCapacity = capacity.filter((row) => row.booked !== row.expected || row.expected < ANCHOR);
  const { rows: liveOnBooking } = await seed.query(
    `select count(*)::int as n from order_lines where order_id::text like '${P}%' and pms_booking_id is not null and status = 'reserved'`
  );
  const { rows: queue } = await seed.query(
    `select count(*)::int as bookings, coalesce(sum((n = 1)::int), 0)::int as exactly_one from (
       select pms_booking_id, count(*) filter (where status = 'pending') as n
         from pms_cancellation_queue where pms_booking_id like 'CONC-PO-%' group by 1) q`
  );
  const tally = {};
  for (const r of results) {
    if (r.who === "claim") continue;
    const key = `${r.who}:${r.ok ? r.r?.reason ?? r.r?.outcome ?? "ok" : "erreur"}`;
    tally[key] = (tally[key] ?? 0) + 1;
  }
  console.log(
    `  run ${runNumber}: ordres déterministes ${deterministic.filter((d) => d.ok).length}/${CASES.length}, ` +
      `40P01 ${deadlocks.length}, erreurs inattendues ${unexpected.length}, ` +
      `capacité fausse ${badCapacity.length}/${capacity.length} dates, lignes vivantes sur booking ${liveOnBooking[0].n}, ` +
      `bookings en file ${queue[0].exactly_one}/${TOTAL}, sonde sans attente ${probeOk ? "oui" : "NON"} — course libre ${JSON.stringify(tally)}`
  );
  for (const r of unexpected) console.error(`    erreur inattendue (${r.who}, commande ${r.i}) : ${r.code} ${r.message}`);
  for (const row of badCapacity) console.error(`    capacité ${row.date} : booked ${row.booked}, attendu ${row.expected}`);
  await purge(seed);
  return (
    probeOk &&
    deterministicOk &&
    deadlocks.length === 0 &&
    unexpected.length === 0 &&
    badCapacity.length === 0 &&
    liveOnBooking[0].n === 0 &&
    queue[0].bookings === TOTAL &&
    queue[0].exactly_one === TOTAL
  );
}

async function main() {
  const seed = await connect();
  let clean = true;
  try {
    for (let r = 1; r <= RUNS; r++) {
      if (!(await runOnce(r, seed))) clean = false;
    }
  } finally {
    await purge(seed);
    await seed.end();
  }
  if (!clean) {
    console.error("ÉCHEC : l'issue « booking disparu » ne tient pas sous concurrence.");
    process.exit(1);
  }
  console.log(
    `${RUNS} runs consécutifs propres — chaque adversaire servi dans les deux ordres (par construction), places rendues une seule fois, aucun interblocage, une annulation en file par booking.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
