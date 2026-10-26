// `products.pricing_unit` — ce que compte la quantité d'une activité (spec 43, migration
// 20261025140000). À ne pas confondre avec `products.unit` (lodgingUnit.ts), simple libellé de prix
// d'un logement.
//   - per_person : des personnes — le comportement de toujours ;
//   - per_hour : des heures consécutives, sur des créneaux d'une heure (1 place par heure couverte) ;
//   - per_activity : des activités entières (la fiche en réserve une).
// Seule une activité choisit son mode : tout autre type vaut per_person en base.
export const PRICING_UNITS = ["per_person", "per_hour", "per_activity"] as const;

export type PricingUnit = (typeof PRICING_UNITS)[number];

/** Lecture sûre d'une valeur venue de la base ou d'un payload : tout inconnu vaut `per_person`. */
export function asPricingUnit(value: unknown): PricingUnit {
  return typeof value === "string" && (PRICING_UNITS as readonly string[]).includes(value)
    ? (value as PricingUnit)
    : "per_person";
}

/** Durée d'un créneau d'une activité à l'heure : une heure facturée = un créneau. */
export const PER_HOUR_SLOT_MINUTES = 60;
