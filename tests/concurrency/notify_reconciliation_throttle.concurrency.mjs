// E-mails admin des exceptions de paiement (migration 20261002125023) — l'étranglement des échecs de
// signature tient SOUS CONCURRENCE : au plus une entrée notifiée par heure glissante, même quand des
// insertions arrivent en même temps.
//
// Sans verrou, chaque insertion concurrente vérifierait la fenêtre AVANT que la première
// notification soit validée, et notifierait aussi. Le trigger prend donc un verrou consultatif NON
// bloquant : une seule transaction décide, les autres se taisent sans attendre.
//
// DÉTERMINISTE : un coordinateur insère un échec de signature dans une transaction OUVERTE — il tient
// le verrou, sa notification n'est pas validée. Dix insertions concurrentes partent alors (et doivent
// aboutir sans attendre), puis le coordinateur valide, et une dernière insertion suit. Attendu : UNE
// entrée notifiée sur douze. Une version sans verrou en notifie au moins deux à chaque run — la
// première insertion concurrente validée ne voit ni la notification du coordinateur (non validée) ni
// celle d'une autre (aucune ne l'est encore) ; mesuré : de 8 à 11 sur cinq runs.
//
// ⚠️ Nettoyage AVANT et APRÈS chaque run (une notification restée dans l'heure étranglerait le run
// suivant). Préfixe d'identifiants dédié : 67000000-. Stack locale seulement.
import pg from "pg";

const { Client } = pg;
const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 5;
const WORKERS = 10;
const P = "67000000-0000-4000-8000-";
const entryId = (run, i) => `${P}${String(run * 100 + i).padStart(12, "0")}`;
const SIGNATURE = "signature invalide (SignatureMismatch)";

async function purge(seed) {
  await seed.query(`delete from notification_emails where related_id::text like '${P}%'`);
  await seed.query(`delete from payment_reconciliation_entries where id::text like '${P}%'`);
}

async function connect() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  return client;
}

const inserer = (client, run, i) =>
  client.query(
    "insert into payment_reconciliation_entries (id, mp_payment_id, raw_event, failure_reason) values ($1, $2, '{}'::jsonb, $3)",
    [entryId(run, i), `thr-${run}-${i}`, SIGNATURE]
  );

async function runOnce(run, seed) {
  await purge(seed);
  // Précondition : aucune notification ÉTRANGÈRE de la classe dans l'heure — elle étranglerait le
  // coordinateur lui-même, et le run ne prouverait rien.
  const { rows: etrangeres } = await seed.query(
    `select count(*)::int as n from notification_emails ne
       join payment_reconciliation_entries e on e.id = ne.related_id
      where ne.event_type = 'admin_new_reconciliation_exception' and ne.related_table = 'payment_reconciliation_entries'
        and ne.created_at > now() - interval '1 hour'
        and e.kind = 'webhook_failure' and e.payment_id is null and e.failure_reason like 'signature invalide (%'
        and e.id::text not like '${P}%'`
  );
  if (etrangeres[0].n > 0) {
    throw new Error(`précondition : ${etrangeres[0].n} notification(s) de la classe dans l'heure, hors de ce test`);
  }

  const coordinateur = await connect();
  const workers = await Promise.all(Array.from({ length: WORKERS }, connect));
  try {
    await coordinateur.query("begin");
    await inserer(coordinateur, run, 0); // tient le verrou, notification non validée

    // Les dix insertions concurrentes : elles doivent aboutir SANS attendre le coordinateur.
    let readyCount = 0;
    let resolveGo;
    const go = new Promise((resolve) => (resolveGo = resolve));
    const debut = Date.now();
    await Promise.race([
      Promise.all(
        workers.map(async (c, i) => {
          if (++readyCount === WORKERS) resolveGo();
          await go;
          await inserer(c, run, i + 1);
        })
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("les insertions concurrentes ont attendu le coordinateur (verrou bloquant ?)")), 10000)
      ),
    ]);
    const attente = Date.now() - debut;
    await coordinateur.query("commit");
    // Après validation, une insertion de plus voit la notification et se tait aussi.
    await inserer(seed, run, WORKERS + 1);

    const { rows } = await seed.query(
      `select count(distinct ne.related_id)::int as notifiees,
              (select count(*)::int from payment_reconciliation_entries where id::text like '${P}%') as entrees
         from notification_emails ne
        where ne.event_type = 'admin_new_reconciliation_exception' and ne.related_id::text like '${P}%'`
    );
    const { notifiees, entrees } = rows[0];
    console.log(
      `  run ${run}: entrées écrites ${entrees}/${WORKERS + 2}, entrées notifiées ${notifiees} (attendu 1), insertions concurrentes terminées en ${attente} ms sans attendre`
    );
    return notifiees === 1 && entrees === WORKERS + 2;
  } finally {
    await Promise.all([coordinateur, ...workers].map((c) => c.end().catch(() => {})));
    await purge(seed);
  }
}

async function main() {
  const seed = await connect();
  let toutPropre = true;
  try {
    for (let run = 1; run <= RUNS; run++) {
      if (!(await runOnce(run, seed))) toutPropre = false;
    }
  } finally {
    await purge(seed);
    await seed.end();
  }
  if (!toutPropre) {
    console.error("ÉCHEC : plus d'une entrée notifiée dans l'heure sous insertions concurrentes.");
    process.exit(1);
  }
  console.log(`${RUNS} runs consécutifs propres — au plus une notification par heure, même sous concurrence.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
