import type { NightCatalogRow } from "./alignLobbyCatalogEntries.ts";
import type { LobbyNightPrices } from "./parseLobbyNightCatalog.ts";

/** Une ligne (catégorie, nuit) — la forme que `sync_pms_availability_month` attend en `p_rows`. */
export interface MirrorRow {
  category_id: number;
  date: string;
  available_units: number;
  min_stay: number | null;
  max_stay: number | null;
  lead_days: number | null;
  /**
   * Prix Lobby par occupation de cette nuit (2026-10-23), `null` si aucun n'est lisible. Le miroir
   * ne sert qu'à AFFICHER : le prix facturé vient du devis lu à chaud sur /pago.
   */
  prices: LobbyNightPrices | null;
}

/**
 * Aplatit un catalogue Lobby (nuit → catégories) en lignes (catégorie, nuit) pour le miroir de
 * disponibilité (`pms_availability_mirror`). Extrait de `pms-sync-availability/index.ts`
 * (20260917140000) pour être réutilisé par le repli de `/api/pms/night-availability`
 * (20260918170000, lot B) — même catalogue déjà en main, même transformation, deux appelants.
 *
 * Une catégorie ABSENTE de la map n'est pas cotée par Lobby cette nuit-là : elle ne produit aucune
 * ligne, ce qui est très différent d'une catégorie cotée à 0 (« complet », une réponse pleine et
 * entière). Ne jamais écrire un 0 pour une absence — le miroir mentirait par excès de zèle.
 */
export function toMirrorRows(nights: NightCatalogRow[]): MirrorRow[] {
  const rows: MirrorRow[] = [];
  for (const night of nights) {
    for (const [categoryId, availableUnits] of night.availableByCategory) {
      const restrictions = night.restrictionsByCategory.get(categoryId);
      rows.push({
        category_id: categoryId,
        date: night.date,
        available_units: availableUnits,
        min_stay: restrictions?.minStay ?? null,
        max_stay: restrictions?.maxStay ?? null,
        lead_days: restrictions?.leadDays ?? null,
        prices: night.pricesByCategory.get(categoryId) ?? null,
      });
    }
  }
  return rows;
}
