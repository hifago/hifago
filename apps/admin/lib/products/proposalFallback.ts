// Ce que l'écran de modération affiche pour une proposition d'ÉDITION : les valeurs proposées, et
// pour les clés que la proposition NE PORTE PAS, celles de la fiche en place.
//
// ⚠️ POURQUOI (2026-10-13). ModerateProposalForm hydrate son formulaire depuis la proposition PUIS
// reconstruit tout le payload à l'approbation (buildProductEditPayload). Une clé absente de la
// proposition donnait donc un champ vide, renvoyé à `null`, et l'approbation effaçait la valeur en
// place : le cupo par défaut d'un logement, la date d'un evento. `program` était déjà traité à la
// main pour cette raison ; cette liste généralise le geste.
//
// Une proposition ne porte pas une clé dans trois cas : elle a été déposée avant la migration qui
// l'a whitelistée, le formulaire socio ne l'envoie que si elle change, ou elle n'est jamais
// proposable (réglage admin d'un evento réservable). Dans les trois, « absent » veut dire « ne
// pas toucher » — exactement ce que la forme gardée (`?`) de moderate_product_proposal applique
// côté SQL. Une clé PRÉSENTE à `null` reste une demande explicite d'effacement, et l'emporte.
//
// Pas de "use client" : fonction pure, testée (proposalFallback.test.ts).
export const KEPT_WHEN_ABSENT = [
  "program",
  "default_capacity",
  "external_booking_url",
  "price_label",
  "group_discount_threshold_qty",
  "group_discount_pct",
  // Quand un evento a lieu (migration 20261013212500).
  "occurrence_type",
  "occurrence_date",
  "recurrence_frequency_days",
  "recurrence_end_date",
  "recurrence_end_count",
  "start_time",
  "duration_minutes",
  // Réglage admin d'un evento réservable en ligne : jamais dans une proposition.
  "online_bookable",
  "evento_capacity_mode",
  "is_free",
  "evento_payment_mode",
  "evento_occupies_resource",
  // Transport informatif (migration 20260916150000).
  "transport_first_departure_time",
  "transport_last_departure_time",
  "transport_seats_per_departure",
  "transport_departure_address",
  "transport_departure_lat",
  "transport_departure_lon",
  "transport_arrival_address",
  "transport_arrival_lat",
  "transport_arrival_lon",
  "transport_contact_phone",
] as const;

export function withCurrentValuesForAbsentKeys<T extends object>(proposed: T, current: object): T {
  const merged = { ...proposed } as Record<string, unknown>;
  const enPlace = current as Record<string, unknown>;
  for (const key of KEPT_WHEN_ABSENT) {
    if (!(key in merged) && key in enPlace) {
      merged[key] = enPlace[key];
    }
  }
  return merged as T;
}
