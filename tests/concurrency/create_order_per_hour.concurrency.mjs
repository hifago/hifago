// Spec 43 (docs/specs/43-activite-prix-par-heure-ou-par-activite.md) — anti-survente réelle d'une
// activité À L'HEURE : une ligne de qty heures consomme 1 place sur CHACUN de ses qty créneaux
// horaires (public.order_line_slot_units). Un bateau de capacité 1, horaires 08:00-17:00 par
// créneaux d'une heure, jamais matérialisés à l'avance.
//
// Deux scénarios, chacun sous barrière de synchronisation (jamais pgTAP, jamais de sleep —
// hifago/CLAUDE.md §6), N acheteurs DISTINCTS (create_order lit le panier de son propre compte) :
//   A. les N visent la MÊME plage 10:00 × 3 h → exactement 1 succès, 10/11/12 à booked 1 ;
//   B. les N visent des plages différentes qui se CHEVAUCHENT → aucun créneau au-delà de sa
//      capacité, les lignes acceptées ne se chevauchent jamais deux à deux, et chaque compteur est
//      exactement le nombre de lignes acceptées qui couvrent ce créneau.
// Les verrous portent sur des ENSEMBLES de créneaux différents d'un acheteur à l'autre, toujours
// pris triés (produit, date, heure) : le scénario B prouve aussi l'absence d'interblocage.
//
// Contre la stack Supabase locale uniquement (127.0.0.1:54322), surchargeable par PGURL.
import pg from "pg";

const { Client } = pg;

const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5; // barre d'acceptation : ≥5 runs consécutifs propres

// Préfixe UUID dédié à ce fichier (94000000-…), libre dans tests/concurrency et seed.sql.
const PARTNER_ID = "94000000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "94000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "94000000-0000-4000-8000-000000000010";
const DATE = "2029-06-04";
const N = 20;
const BUYER_ID_SEGMENT = "8400";
function buyerAccountId(i) {
  return `94000000-0000-4000-${BUYER_ID_SEGMENT}-${String(i).padStart(12, "0")}`;
}

// Scénario B : des plages de 1 à 3 h qui démarrent entre 08:00 et 14:00 — beaucoup se chevauchent,
// certaines sont bout à bout. Déterministe : un échec se rejoue à l'identique.
function rangeB(i) {
  const start = 8 + ((i * 5) % 7); // 8..14
  const hours = 1 + (i % 3); // 1..3, fin au plus tard 17:00
  return { start, hours };
}
const hhmm = (h) => `${String(h).padStart(2, "0")}:00`;

async function connectBuyer(i, line) {
  const accountId = buyerAccountId(i);
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    accountId,
    `concurrency-per-hour-buyer-${i}@hifago.test`,
  ]);
  await client.query(
    "insert into cart_items (account_id, product_id, date, slot_start_time, qty) values ($1, $2, $3, $4, $5)",
    [accountId, PRODUCT_ID, DATE, line.slot_start_time, line.qty]
  );
  await client.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: accountId, role: "authenticated" }),
  ]);
  return client;
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

async function purgeFixtures(seedClient) {
  await seedClient.query(
    `delete from order_lines where product_id in (select id from products where establishment_id = $1)`,
    [ESTABLISHMENT_ID]
  );
  for (const table of ["orders", "cart_items", "carts"]) {
    await seedClient.query(
      `delete from ${table} where account_id::text like '94000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
    );
  }
  await seedClient.query(
    `delete from partner_accounts where id::text like '94000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  await seedClient.query(
    `delete from auth.users where id::text like '94000000-0000-4000-${BUYER_ID_SEGMENT}-%'`
  );
  for (const table of ["product_slot_availability", "product_slot_rules"]) {
    await seedClient.query(
      `delete from ${table} where product_id in (select id from products where establishment_id = $1)`,
      [ESTABLISHMENT_ID]
    );
  }
  await seedClient.query("delete from products where establishment_id = $1", [ESTABLISHMENT_ID]);
  await seedClient.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]);
  await seedClient.query("delete from partners where id = $1", [PARTNER_ID]);
}

async function resetAndSeed(seedClient) {
  await purgeFixtures(seedClient);
  await seedClient.query("insert into partners (id, display_name) values ($1, $2)", [
    PARTNER_ID,
    "Create Order Per Hour Concurrency Partner",
  ]);
  await seedClient.query("insert into establishments (id, partner_id, name) values ($1, $2, $3)", [
    ESTABLISHMENT_ID,
    PARTNER_ID,
    JSON.stringify({ es: "Per Hour Concurrency Establishment" }),
  ]);
  await seedClient.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, pricing_unit)
     values ($1, $2, $3, 'activity', jsonb_build_object('es', 'Wakeboard concurrency'), 420000, true, $4, 'per_hour')`,
    [PRODUCT_ID, PARTNER_ID, ESTABLISHMENT_ID, "per-hour-concurrency-wakeboard"]
  );
  await seedClient.query(
    `insert into product_slot_rules (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity)
     values ($1, array[1,2,3,4,5,6,7]::smallint[], '08:00', '17:00', 60, 1)`,
    [PRODUCT_ID]
  );
  // AUCUNE ligne product_slot_availability semée : la matérialisation concurrente fait partie du test.
}

async function race(lines, { premateriaise = false } = {}) {
  const seedClient = new Client({ connectionString: CONNECTION_STRING });
  await seedClient.connect();
  await resetAndSeed(seedClient);
  if (premateriaise) {
    // Scénario C : les créneaux existent déjà (une réservation antérieure les a matérialisés). Plus
    // aucun `insert … on conflict` ne sérialise les transactions : seuls les verrous `for update`
    // de create_order les protègent. Sans ce scénario, retirer le verrou des heures suivantes
    // restait vert (mutation du 2026-10-25).
    await seedClient.query(
      `insert into product_slot_availability (product_id, slot_date, slot_start_time, slot_duration_minutes, capacity, booked)
       select $1, $2::date, make_time(h, 0, 0), 60, 1, 0 from generate_series(8, 16) as h`,
      [PRODUCT_ID, DATE]
    );
  }
  const clients = await Promise.all(lines.map((line, i) => connectBuyer(i, line)));
  const { go, markReady } = makeBarrier(lines.length);
  const settled = await Promise.allSettled(
    clients.map(async (client) => {
      markReady();
      await go;
      const res = await client.query("select create_order($1, $2, $3, $4) as result", [
        "Concurrency Buyer",
        "concurrency-buyer@hifago.test",
        null,
        false,
      ]);
      return res.rows[0].result;
    })
  );
  const { rows: slots } = await seedClient.query(
    `select to_char(slot_start_time, 'HH24:MI') as slot, capacity, booked, slot_duration_minutes
       from product_slot_availability where product_id = $1 and slot_date = $2 order by slot_start_time`,
    [PRODUCT_ID, DATE]
  );
  await Promise.all(clients.map((client) => client.end()));
  await seedClient.end();
  return { settled, slots };
}

function summarize(settled) {
  const rejected = settled.filter((s) => s.status === "rejected");
  const results = settled.map((s) => (s.status === "fulfilled" ? s.value : null));
  for (const r of rejected) console.error(`    rejet inattendu (interblocage ?) : ${r.reason?.message ?? r.reason}`);
  const unexpected = results.filter((r) => r && r.ok === false && r.reason !== "full");
  if (unexpected.length > 0) console.error(`    raisons inattendues : ${JSON.stringify(unexpected)}`);
  return { rejected, results, unexpected };
}

async function scenarioA(run) {
  const lines = Array.from({ length: N }, () => ({ slot_start_time: "10:00", qty: 3 }));
  const { settled, slots } = await race(lines);
  const { rejected, results, unexpected } = summarize(settled);
  const successes = results.filter((r) => r?.ok === true).length;
  const byslot = Object.fromEntries(slots.map((s) => [s.slot, s.booked]));
  const exact = byslot["10:00"] === 1 && byslot["11:00"] === 1 && byslot["12:00"] === 1;
  const neverAbove = slots.every((s) => s.booked <= s.capacity);
  console.log(
    `  run ${run} A: succès ${successes}/${N} (attendu 1), 10/11/12 booked ${byslot["10:00"]}/${byslot["11:00"]}/${byslot["12:00"]} (attendu 1/1/1), créneaux matérialisés ${slots.length}`
  );
  return rejected.length === 0 && unexpected.length === 0 && successes === 1 && exact && neverAbove;
}

async function scenarioB(run, { premateriaise = false } = {}) {
  const label = premateriaise ? "C" : "B";
  const ranges = Array.from({ length: N }, (_, i) => rangeB(i));
  const lines = ranges.map(({ start, hours }) => ({ slot_start_time: hhmm(start), qty: hours }));
  const { settled, slots } = await race(lines, { premateriaise });
  const { rejected, results, unexpected } = summarize(settled);
  const accepted = ranges.filter((_, i) => results[i]?.ok === true);

  // (1) aucune paire de plages acceptées ne se chevauche
  let overlap = null;
  for (let a = 0; a < accepted.length && !overlap; a++) {
    for (let b = a + 1; b < accepted.length; b++) {
      const x = accepted[a];
      const y = accepted[b];
      if (x.start < y.start + y.hours && y.start < x.start + x.hours) {
        overlap = [x, y];
        break;
      }
    }
  }
  if (overlap) console.error(`    CHEVAUCHEMENT ACCEPTÉ : ${JSON.stringify(overlap)}`);

  // (2) chaque compteur = nombre de plages acceptées qui couvrent ce créneau, jamais > capacité
  const expected = new Map();
  for (const { start, hours } of accepted) {
    for (let h = start; h < start + hours; h++) expected.set(hhmm(h), (expected.get(hhmm(h)) ?? 0) + 1);
  }
  const counterMismatch = slots.filter((s) => s.booked !== (expected.get(s.slot) ?? 0) || s.booked > s.capacity);
  if (counterMismatch.length > 0) console.error(`    compteurs faux : ${JSON.stringify(counterMismatch)}`);
  const missingSlots = [...expected.keys()].filter((k) => !slots.some((s) => s.slot === k));
  if (missingSlots.length > 0) console.error(`    créneaux pris mais absents : ${missingSlots}`);

  console.log(
    `  run ${run} ${label}: ${accepted.length}/${N} plages acceptées (${accepted
      .map(({ start, hours }) => `${hhmm(start)}+${hours}h`)
      .join(", ")}), chevauchement ${overlap ? "OUI" : "aucun"}, compteurs ${counterMismatch.length === 0 ? "exacts" : "FAUX"}`
  );
  return (
    rejected.length === 0 &&
    unexpected.length === 0 &&
    accepted.length >= 1 &&
    !overlap &&
    counterMismatch.length === 0 &&
    missingSlots.length === 0
  );
}

async function runAll() {
  console.log(
    `\n=== create_order — activité à l'heure sous concurrence (N=${N}, capacité 1 par heure, ${RUNS} runs consécutifs requis) ===`
  );
  for (let run = 1; run <= RUNS; run++) {
    let clean;
    try {
      clean =
        (await scenarioA(run)) &&
        (await scenarioB(run)) &&
        (await scenarioB(run, { premateriaise: true }));
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
    `\n${RUNS} runs consécutifs propres — aucune heure vendue deux fois, aucun chevauchement accepté, aucun interblocage.`
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
