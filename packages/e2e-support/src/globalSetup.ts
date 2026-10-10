import { withDb } from "./db";

/**
 * `globalSetup` Playwright, pendant de `cleanup.ts` (2026-10-07) : note l'heure de début de la
 * suite, à l'horloge de la BASE (jamais celle de la machine, qui peut différer du conteneur), pour
 * que le teardown ne retire du journal d'audit que ce que les comptes de test ont écrit PENDANT la
 * suite. Passée par l'environnement du processus Playwright, que le teardown partage.
 *
 * Ne fait jamais échouer la suite : sans base joignable, le teardown se rabat sur les seules
 * lignes rattachées aux entités qu'il purge.
 */
export default async function globalSetup() {
  try {
    const debut = await withDb(async (client) => {
      const { rows } = await client.query<{ now: string }>("select now()::text as now");
      return rows[0].now;
    });
    process.env.E2E_RUN_STARTED_AT = debut;
  } catch (erreur) {
    console.warn("[e2e setup] heure de début non relevée — le teardown purgera sans borne de temps :", erreur);
  }
}
