// Annulation d'une prestation (migration 20261006192424) contre les autres écrivains de la même
// commande. cancel_order_line REND la place (opération de capacité, CLAUDE.md §4) sous les verrous
// `orders` → ligne → capacité : prouvé sous concurrence réelle.
//
// Trois adversaires, une commande d'UNE prestation chacune :
//   - `webhook` : le paiement est approuvé (apply_payment_webhook_checked) pendant que le client
//     annule. Ce que l'issue doit dire, quel que soit l'ordre : soit le paiement a été appliqué AVANT
//     l'annulation (commande payée, acompte acquis : compensation de l'établissement, aucun
//     remboursement), soit APRÈS (intent annulé par l'annulation, commande non payée, remboursement
//     `refund_required`, aucune compensation). Jamais un mélange — c'est ce que la commande verrouillée
//     d'abord garantit : l'annulation décide sur le paiement que le webhook a décidé, ou l'inverse ;
//   - `expire` : la commande expire (expire_payment_order) pendant que le client annule — la place
//     est rendue UNE fois, par celui qui passe le premier ;
//   - `cancel` : deux annulations de la même prestation (double clic) — une seule réussit.
//
// Deux phases par run :
//   1. DÉTERMINISTE — chaque adversaire est servi dans les DEUX ordres, par construction : un
//      coordinateur tient la commande (que tous prennent en premier), le premier appel part et sa mise
//      en attente est constatée, puis le second, puis le coordinateur relâche.
//   2. COURSE LIBRE — une annulation et un adversaire par commande, libérés ensemble par une
//      barrière. Cette phase cherche les interblocages, pas la couverture des ordres.
// Et une SONDE déterministe de l'ordre des verrous entre le trigger d'une annulation (ligne, puis
// file d'annulation PMS) et le remplacement d'un jeton Lobby (set_establishment_pms_connector :
// lignes, puis file, depuis 20261006192424) : la ligne est tenue, le remplacement attend, puis
// l'annulation enfile — jamais un interblocage.
//
// Attendu à chaque run : 0 interblocage (40P01), aucune erreur ; `booked` = la somme des quantités
// des prestations encore réservées ; chaque issue conforme à son ordre.
//
// ⚠️ Nettoyage AVANT et APRÈS chaque run. Préfixe d'identifiants dédié : 7c710000-. Stack locale.
import pg from "pg";

const { Client } = pg;
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5;
const ORDERS = 12; // course libre : commandes 1 à ORDERS
const OPPONENTS = ["webhook", "expire", "cancel"];
const CASES = OPPONENTS.flatMap((kind) => [
  { kind, first: "client" },
  { kind, first: "opponent" },
]);
const TOTAL = ORDERS + CASES.length;
const P = "7c710000-0000-4000-8000-";
const id = (n) => `${P}${String(n).padStart(12, "0")}`;
const PARTNER_ID = id(1);
const REFERRER_ID = id(2);
const ESTABLISHMENT_ID = id(3);
const ACTIVITY_ID = id(4);
const BUYER_ID = id(5);
const ADMIN_ID = id(6);
const PMS_ESTABLISHMENT_ID = id(7);
const PMS_ACTIVITY_ID = id(8);
const DATE = "2029-09-10";
const orderId = (i) => id(1000 + i);
const lineId = (i) => id(2000 + i);
const paymentId = (i) => id(3000 + i);
const mpId = (i) => `MP-CONC-CL-${i}`;
const PROBE_ORDER = id(4001);
// Une commande « ancre » garde ANCHOR places à DATE, jamais touchée : sans elle, `booked` finirait à
// 0 et le plancher de release_order_line_capacity (greatest(0, …)) masquerait une place rendue deux fois.
const ANCHOR_ORDER = id(4003);
const ANCHOR_LINE = id(4004);
const ANCHOR = 5;
const PROBE_LINE = id(4002);
const PROBE_BOOKING = "CONC-CL-PROBE";
const ACOMPTE = 3000;
const REFERRER_CUT = 1500;
const kindOf = (i) => (i <= ORDERS ? OPPONENTS[(i - 1) % OPPONENTS.length] : CASES[i - ORDERS - 1].kind);
const QUERY_FRAGMENT = {
  client: "cancel_order_line",
  webhook: "apply_payment_webhook_checked",
  expire: "expire_payment_order",
  cancel: "cancel_order_line",
};
const clientOk = (r) => r.ok && r.r?.ok === true && r.r?.remaining_active_lines === 0;
const notActive = (r) => r.ok && r.r?.reason === "line_not_active";
// L'issue EXACTE attendue de chaque appel, selon qui est servi le premier (cancel/cancel : symétrique).
const EXPECTED = {
  "webhook/client": { client: clientOk, opponent: (r) => r.ok && r.r?.ok === true && r.r?.reason === "paid_after_expiry" },
  // Appliqué : `{ok: true}` sans motif (apply_payment_webhook, fin du chemin nominal).
  "webhook/opponent": { client: clientOk, opponent: (r) => r.ok && r.r?.ok === true && r.r?.reason === undefined },
  "expire/client": { client: clientOk, opponent: (r) => r.ok && r.r?.reason === "not_candidate" },
  "expire/opponent": { client: notActive, opponent: (r) => r.ok && r.r?.ok === true },
  "cancel/client": { client: clientOk, opponent: notActive },
  "cancel/opponent": { client: notActive, opponent: clientOk },
};

async function connect() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  return client;
}

async function purge(seed) {
  await seed.query(
    `delete from notification_emails where (related_table = 'order_lines' and related_id::text like '${P}%')
        or (related_table = 'payment_reconciliation_entries' and related_id in (
              select e.id from payment_reconciliation_entries e where e.payment_id::text like '${P}%'))
        or (related_table = 'pms_reconciliation_entries' and related_id in (
              select e.id from pms_reconciliation_entries e where e.order_line_id::text like '${P}%'))
        or (event_type = 'admin_new_reconciliation_exception' and subject like '%Conc Cancel PMS%')`
  );
  await seed.query(`delete from payment_refunds where payment_id::text like '${P}%'`);
  await seed.query(`delete from payment_reconciliation_entries where payment_id::text like '${P}%'`);
  await seed.query(`delete from pms_reconciliation_entries where order_line_id::text like '${P}%'`);
  await seed.query("delete from pms_cancellation_queue where pms_booking_id like 'CONC-CL-%'");
  await seed.query("delete from pms_sync_state where establishment_id in ($1, $2)", [ESTABLISHMENT_ID, PMS_ESTABLISHMENT_ID]);
  await seed.query("delete from audit_log where actor_id = $1", [ADMIN_ID]);
  await seed.query(`delete from ledger_entries where order_line_id::text like '${P}%'`);
  await seed.query(`delete from payments where order_id::text like '${P}%'`);
  await seed.query(`delete from order_lines where order_id::text like '${P}%'`);
  await seed.query(`delete from orders where id::text like '${P}%'`);
  await seed.query("delete from product_availability where product_id in ($1, $2)", [ACTIVITY_ID, PMS_ACTIVITY_ID]);
  await seed.query("delete from products where id in ($1, $2)", [ACTIVITY_ID, PMS_ACTIVITY_ID]);
  await seed.query("delete from establishments where id in ($1, $2)", [ESTABLISHMENT_ID, PMS_ESTABLISHMENT_ID]);
  await seed.query("delete from partner_capabilities where account_id = $1", [ADMIN_ID]);
  await seed.query("delete from partners where id in ($1, $2)", [PARTNER_ID, REFERRER_ID]);
  await seed.query("delete from partner_accounts where id in ($1, $2)", [BUYER_ID, ADMIN_ID]);
  await seed.query("delete from auth.users where id in ($1, $2)", [BUYER_ID, ADMIN_ID]);
}

async function seedRun(seed) {
  await purge(seed);
  await seed.query("insert into partners (id, display_name) values ($1, 'Conc Cancel Owner'), ($2, 'Conc Cancel Referrer')", [
    PARTNER_ID,
    REFERRER_ID,
  ]);
  await seed.query(
    `insert into establishments (id, partner_id, name) values ($1, $2, jsonb_build_object('es', 'Conc Cancel'))`,
    [ESTABLISHMENT_ID, PARTNER_ID]
  );
  await seed.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values ($1, $2, $3, 'activity', jsonb_build_object('es', 'Conc Cancel Actividad'), 30000, true, 'conc-cancel-actividad')`,
    [ACTIVITY_ID, PARTNER_ID, ESTABLISHMENT_ID]
  );
  await seed.query("insert into auth.users (id, email) values ($1, 'conc-cl-buyer@test.local'), ($2, 'conc-cl-admin@test.local')", [
    BUYER_ID,
    ADMIN_ID,
  ]);
  await seed.query("insert into partner_capabilities (account_id, role, source, status) values ($1, 'admin', 'migration', 'active')", [
    ADMIN_ID,
  ]);
  // Chaque commande tient UNE place de l'activité à DATE, l'ancre en tient ANCHOR.
  await seed.query("insert into product_availability (product_id, date, capacity, booked) values ($1, $2, 100, $3)", [
    ACTIVITY_ID,
    DATE,
    TOTAL + ANCHOR,
  ]);
  await seed.query(
    `insert into orders (id, account_id, holder_name, holder_email, payment_status, reference)
     values ($1, $2, 'Conc CL', 'conc-cl-buyer@test.local', 'paid', 'CONC-CL-ANCHOR')`,
    [ANCHOR_ORDER, BUYER_ID]
  );
  await seed.query(
    `insert into order_lines (
       id, order_id, account_id, product_id, date, qty, status, holder_name,
       price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
       acompte_cop, referrer_commission_cop, app_commission_cop
     ) values ($1, $2, $3, $4, $5, $6, 'reserved', 'Conc CL', 30000, 30000 * $6::int, 'direct', 0.1, 0, 0.1,
               3000 * $6::int, 0, 3000 * $6::int)`,
    [ANCHOR_LINE, ANCHOR_ORDER, BUYER_ID, ACTIVITY_ID, DATE, ANCHOR]
  );
  for (let i = 1; i <= TOTAL; i++) {
    const kind = kindOf(i);
    // webhook : commande `pending` récente avec son intent ; expire et cancel : impayée, 40 min.
    await seed.query(
      `insert into orders (id, account_id, holder_name, holder_email, payment_status, reference, created_at)
       values ($1, $2, 'Conc CL', 'conc-cl-buyer@test.local', $3, $4, now() - $5::interval)`,
      [orderId(i), BUYER_ID, kind === "webhook" ? "pending" : "unpaid", `CONC-CL-${i}`, kind === "webhook" ? "5 minutes" : "40 minutes"]
    );
    await seed.query(
      `insert into order_lines (
         id, order_id, account_id, product_id, date, qty, status, holder_name,
         price_cop, total_cop, commission_case, referrer_partner_id, acompte_pct, referrer_pct, app_pct,
         acompte_cop, referrer_commission_cop, app_commission_cop
       ) values ($1, $2, $3, $4, $5, 1, 'reserved', 'Conc CL', 30000, 30000, 'external_referrer', $6,
                 0.1, 0.05, 0.05, $8::int, $7::int, $8::int - $7::int)`,
      [lineId(i), orderId(i), BUYER_ID, ACTIVITY_ID, DATE, REFERRER_ID, REFERRER_CUT, ACOMPTE]
    );
    await seed.query(
      `insert into ledger_entries (order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status)
       values ($1, 'referrer', $2, 'referral_earned', $3, 'estimated')`,
      [lineId(i), REFERRER_ID, REFERRER_CUT]
    );
    if (kind === "webhook") {
      await seed.query("insert into payments (id, order_id, status, amount_cop) values ($1, $2, 'pending', $3)", [
        paymentId(i),
        orderId(i),
        ACOMPTE,
      ]);
    }
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

const cancelCall = (client, i) => run(client, "select public.cancel_order_line($1) as r", [lineId(i)]);

function opponentCall(kind, client, i) {
  if (kind === "cancel") return cancelCall(client, i);
  if (kind === "webhook") {
    return run(
      client,
      "select public.apply_payment_webhook_checked($1, $2::uuid, 'approved', $3::numeric, jsonb_build_object('transaction_amount', $4::int)) as r",
      [mpId(i), paymentId(i), ACOMPTE, ACOMPTE]
    );
  }
  return run(client, "select public.expire_payment_order($1, now()) as r", [orderId(i)]);
}

const opponentClient = (kind) => (kind === "cancel" ? asRole("authenticated", BUYER_ID) : asRole("service_role"));

/** Attend qu'une session soit bloquée sur un verrou en exécutant `fragment` (paramètres invisibles). */
async function waitForLockWait(seed, fragment, count = 1) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await seed.query(
      "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like $1",
      [`%${fragment}%`]
    );
    if (rows[0].n >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`aucune attente de verrou constatée pour ${fragment}`);
}

/** Phase déterministe : sert l'annulation et l'adversaire dans l'ordre demandé, sur la commande i. */
async function serveInOrder(seed, { kind, first }, i) {
  const coordinator = await connect();
  const buyer = await asRole("authenticated", BUYER_ID);
  const opponent = await opponentClient(kind);
  try {
    await coordinator.query("begin");
    await coordinator.query("select 1 from orders where id = $1 for update", [orderId(i)]);
    const launch = (who) => (who === "client" ? cancelCall(buyer, i) : opponentCall(kind, opponent, i));
    const order = first === "client" ? ["client", "opponent"] : ["opponent", "client"];
    const fragment = (who) => QUERY_FRAGMENT[who === "client" ? "client" : kind];
    const firstCall = launch(order[0]);
    await waitForLockWait(seed, fragment(order[0]));
    const secondCall = launch(order[1]);
    // cancel/cancel : les deux appels portent le même texte — on attend DEUX sessions en attente.
    await waitForLockWait(seed, fragment(order[1]), kind === "cancel" ? 2 : 1);
    await coordinator.query("rollback");
    const [a, b] = await Promise.all([firstCall, secondCall]);
    const byWho = { [order[0]]: a, [order[1]]: b };
    const expected = EXPECTED[`${kind}/${first}`];
    const ok = expected.client(byWho.client) && expected.opponent(byWho.opponent);
    if (!ok) {
      console.error(
        `    ordre ${kind}/${first} (commande ${i}) : issue inattendue — client ${JSON.stringify(byWho.client)}, ${kind} ${JSON.stringify(byWho.opponent)}`
      );
    }
    return { ok, results: [{ i, who: "client", ...byWho.client }, { i, who: kind, ...byWho.opponent }] };
  } finally {
    await Promise.all([coordinator, buyer, opponent].map((c) => c.end().catch(() => {})));
  }
}

/**
 * Sonde de l'ordre des verrous : une ligne bookée est tenue (comme l'annulation la tient avant que
 * son trigger n'enfile), le remplacement de jeton démarre et doit ATTENDRE cette ligne avant de
 * toucher la file ; l'annulation enfile alors sans attendre personne. Avec l'ordre d'avant (file
 * puis lignes), le remplacement tenait déjà l'entrée en attente du booking : interblocage.
 */
async function probeConnectorLockOrder(seed) {
  await seed.query(
    `insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token)
     values ($1, $2, jsonb_build_object('es', 'Conc Cancel PMS'), true, 'tok-conc-cl-old')`,
    [PMS_ESTABLISHMENT_ID, PARTNER_ID]
  );
  await seed.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values ($1, $2, $3, 'activity', jsonb_build_object('es', 'Conc Cancel PMS Act'), 30000, true, 'conc-cancel-pms-act')`,
    [PMS_ACTIVITY_ID, PARTNER_ID, PMS_ESTABLISHMENT_ID]
  );
  await seed.query(
    `insert into orders (id, account_id, holder_name, holder_email, payment_status, reference)
     values ($1, $2, 'Conc CL', 'conc-cl-buyer@test.local', 'paid', 'CONC-CL-PROBE')`,
    [PROBE_ORDER, BUYER_ID]
  );
  await seed.query(
    `insert into order_lines (
       id, order_id, account_id, product_id, date, qty, status, holder_name, pms_booking_id, pms_booked_at,
       price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
       acompte_cop, referrer_commission_cop, app_commission_cop
     ) values ($1, $2, $3, $4, $5, 1, 'reserved', 'Conc CL', $6, now() - interval '1 hour',
               30000, 30000, 'direct', 0.1, 0, 0.1, 3000, 0, 3000)`,
    [PROBE_LINE, PROBE_ORDER, BUYER_ID, PMS_ACTIVITY_ID, DATE, PROBE_BOOKING]
  );
  // L'entrée en attente du même booking (la nuit annulée plus tôt, par exemple).
  await seed.query(
    "insert into pms_cancellation_queue (pms_booking_id, establishment_id, hifago_status) values ($1, $2, 'cancelled_by_client')",
    [PROBE_BOOKING, PMS_ESTABLISHMENT_ID]
  );
  const holder = await connect();
  const admin = await asRole("authenticated", ADMIN_ID);
  try {
    await holder.query("begin");
    await holder.query("select 1 from order_lines where id = $1 for update", [PROBE_LINE]);
    const replacement = run(
      admin,
      "select public.set_establishment_pms_connector($1, 'tok-conc-cl-new', true, 'concurrence', false) as r",
      [PMS_ESTABLISHMENT_ID]
    );
    await waitForLockWait(seed, "set_establishment_pms_connector");
    // Le trigger d'annulation enfile le booking : il ne doit attendre personne.
    const cancelled = await run(holder, "update order_lines set status = 'cancelled_by_client' where id = $1 returning 1 as r", [PROBE_LINE]);
    const committed = cancelled.ok ? await run(holder, "commit", []) : await run(holder, "rollback", []);
    const replaced = await replacement;
    const ok = cancelled.ok && committed.ok && replaced.ok && replaced.r?.ok === true;
    if (!ok) {
      console.error(`    sonde verrous : annulation ${JSON.stringify(cancelled)}, remplacement ${JSON.stringify(replaced)}`);
    }
    return ok;
  } finally {
    await Promise.all([holder, admin].map((c) => c.end().catch(() => {})));
  }
}

async function checkOutcomes(seed) {
  const problems = [];
  const { rows } = await seed.query(
    `select o.id, o.payment_status, ol.status as line_status,
            exists (select 1 from ledger_entries le where le.order_line_id = ol.id and le.entry_type = 'establishment_compensation') as comp,
            exists (select 1 from payment_reconciliation_entries e where e.payment_id::text like $1 and e.payment_id = (
                      select p.id from payments p where p.order_id = o.id limit 1) and e.kind = 'refund_required') as refund
       from orders o join order_lines ol on ol.order_id = o.id
      where o.id::text like $1 and o.id not in ($2, $3)`,
    [`${P}%`, PROBE_ORDER, ANCHOR_ORDER]
  );
  for (const row of rows) {
    const i = Number(row.id.slice(-4)) - 1000;
    const kind = kindOf(i);
    if (kind === "webhook") {
      const paidThenCancelled = row.payment_status === "paid" && row.comp && !row.refund;
      const cancelledThenPaid = row.payment_status !== "paid" && !row.comp && row.refund;
      if (row.line_status !== "cancelled_by_client" || !(paidThenCancelled || cancelledThenPaid)) {
        problems.push(`webhook ${i} : ${JSON.stringify(row)}`);
      }
    } else if (kind === "expire") {
      if (!["cancelled_by_client", "expired"].includes(row.line_status) || row.comp) problems.push(`expire ${i} : ${JSON.stringify(row)}`);
    } else if (row.line_status !== "cancelled_by_client" || row.comp) {
      problems.push(`cancel ${i} : ${JSON.stringify(row)}`);
    }
  }
  return problems;
}

async function runOnce(runNumber, seed) {
  await seedRun(seed);

  // Phase 1 — déterministe.
  const deterministic = [];
  for (const [k, c] of CASES.entries()) deterministic.push(await serveInOrder(seed, c, ORDERS + 1 + k));
  const deterministicOk = deterministic.every((d) => d.ok);

  // Phase 2 — course libre.
  const buyers = await Promise.all(Array.from({ length: ORDERS }, () => asRole("authenticated", BUYER_ID)));
  const opponents = await Promise.all(Array.from({ length: ORDERS }, (_, k) => opponentClient(kindOf(k + 1))));
  let ready = 0;
  let release;
  const go = new Promise((resolve) => (release = resolve));
  const arm = () => {
    if (++ready === ORDERS * 2) release();
  };
  const results = await Promise.all(
    Array.from({ length: ORDERS }, (_, k) => k + 1).flatMap((i) => [
      (async () => {
        arm();
        await go;
        return { i, who: "client", ...(await cancelCall(buyers[i - 1], i)) };
      })(),
      (async () => {
        arm();
        await go;
        return { i, who: kindOf(i), ...(await opponentCall(kindOf(i), opponents[i - 1], i)) };
      })(),
    ])
  );
  await Promise.all([...buyers, ...opponents].map((c) => c.end().catch(() => {})));

  const all = [...results, ...deterministic.flatMap((d) => d.results)];
  const deadlocks = all.filter((r) => !r.ok && r.code === "40P01");
  const unexpected = all.filter((r) => !r.ok && r.code !== "40P01");
  // cancel/cancel : exactement une réussite par commande.
  const doubleClick = Array.from({ length: TOTAL }, (_, k) => k + 1)
    .filter((i) => kindOf(i) === "cancel")
    .filter((i) => all.filter((r) => r.i === i && r.ok && r.r?.ok === true).length !== 1);
  const { rows: capacity } = await seed.query(
    `select pa.booked,
            (select coalesce(sum(ol.qty), 0)::int from order_lines ol
              where ol.product_id = pa.product_id and ol.date = pa.date and ol.status = 'reserved') as expected
       from product_availability pa where pa.product_id = $1 and pa.date = $2`,
    [ACTIVITY_ID, DATE]
  );
  const outcomes = await checkOutcomes(seed);
  const probeOk = await probeConnectorLockOrder(seed);

  const tally = {};
  for (const r of results) {
    const key = `${r.who}:${r.ok ? r.r?.reason ?? (r.r?.ok ? "ok" : "?") : r.code}`;
    tally[key] = (tally[key] ?? 0) + 1;
  }
  console.log(
    `  run ${runNumber}: ordres déterministes ${deterministic.filter((d) => d.ok).length}/${CASES.length}, ` +
      `40P01 ${deadlocks.length}, erreurs ${unexpected.length}, booked ${capacity[0].booked}/${capacity[0].expected} attendu, ` +
      `issues incohérentes ${outcomes.length}, doubles clics fautifs ${doubleClick.length}, sonde verrous ${probeOk ? "ok" : "ÉCHEC"} — ` +
      `course libre ${JSON.stringify(tally)}`
  );
  for (const r of unexpected) console.error(`    erreur (${r.who}, commande ${r.i}) : ${r.code} ${r.message}`);
  for (const p of outcomes) console.error(`    issue incohérente : ${p}`);
  await purge(seed);
  return (
    deterministicOk &&
    deadlocks.length === 0 &&
    unexpected.length === 0 &&
    doubleClick.length === 0 &&
    capacity[0].booked === capacity[0].expected &&
    capacity[0].expected === ANCHOR &&
    outcomes.length === 0 &&
    probeOk
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
    console.error("ÉCHEC : l'annulation d'une prestation ne tient pas sous concurrence.");
    process.exit(1);
  }
  console.log(
    `${RUNS} runs consécutifs propres — chaque adversaire servi dans les deux ordres (par construction), place rendue une seule fois, paiement et annulation jamais mêlés, aucun interblocage, remplacement de jeton sans interblocage.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
