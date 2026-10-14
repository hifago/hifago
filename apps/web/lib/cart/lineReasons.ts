// Raisons qui visent UNE ligne du panier : celles que create_order renvoie avec `line`
// (product_id/date de LA ligne fautive), et exactement celles que cart_lines_availability rend pour
// une ligne indisponible (migration 20261014211217, même liste fermée). Partagée par le formulaire
// de `/pago` (refus de create_order) et par `CartSummary` (ligne signalée avant l'envoi) : chaque
// littéral n'existe qu'ici, et son texte est `CheckoutPage.errors.<raison>`.
//
// Spec 17 §0 Tranche 2 (alojamiento par plage) : invalid_date_range/unsupported_date_range, jamais
// censées surgir via l'écran réel, mais mappées en défense en profondeur si la RPC est appelée
// directement avec un panier malformé. Spec 18 §0 Tranche 1 (produit à créneaux horaires) :
// slot_required/unsupported_slot_combination, même traitement — défense en profondeur, l'écran réel
// (SlotReservationForm) empêche déjà l'absence de slot_start_time ou une combinaison incohérente.
//
// room_type_required/room_type_mismatch/room_type_not_found/end_date_required ont disparu avec
// l'étage hôtel (T3 étape 2, 20260827220000) : create_order ne les produit plus. Les garder ici
// aurait promis une traduction pour une réponse impossible.
// camp_missing_lodging (2026-09-15) : un camp sans hébergement compatible dans le panier —
// l'écran réel (ReservationForm.tsx) guide déjà vers /alojamientos après l'ajout d'un camp, mais
// cette raison reste atteignable si le client revient au checkout sans avoir ajouté d'hébergement,
// ou via un appel direct à la RPC.
// Migration 20260929112240 : qty_cap_exceeded vise une ligne (create_order renvoie `line`) et
// rejoint cette liste ; date_range_required (logement sans date de départ, défense en profondeur :
// LodgingReservationForm envoie toujours endDate) ; pms_unavailable (logement PMS dont le
// connecteur de l'établissement est coupé, CLAUDE.md §4.4).
export const LINE_SCOPED_REASONS = [
  "product_not_found",
  "not_sellable",
  "date_closed",
  "slot_not_found",
  "full",
  "resource_unavailable",
  "camp_missing_lodging",
  "invalid_date_range",
  "unsupported_date_range",
  "slot_required",
  "unsupported_slot_combination",
  "qty_below_minimum",
  "qty_cap_exceeded",
  "date_range_required",
  "pms_unavailable",
  // Migration 20260929112240, renvoyées avec la ligne fautive comme les autres : date qui n'est pas
  // une représentation d'un evento réservable, quantité hors des paliers de prix, produit sans prix.
  "invalid_occurrence_date",
  "no_matching_tier",
  "price_missing",
  // Migration 20261014031656 : une ligne dont la date est passée (heure de Colombie).
  "date_in_past",
] as const;

export type LineScopedReason = (typeof LINE_SCOPED_REASONS)[number];

export function isLineScopedReason(raw: string | null | undefined): raw is LineScopedReason {
  return typeof raw === "string" && (LINE_SCOPED_REASONS as readonly string[]).includes(raw);
}
