// Colonnes de `products` que les DEUX écrans d'édition relisent avant d'ouvrir le formulaire :
// admin/products/[id]/edit (ProductForm) et partner/(app)/products/[id]/edit (EditProposalForm).
// Pas de "use client" : importé par ces deux Server Components.
//
// LA RÈGLE : toute colonne que buildProductEditPayload réécrit DOIT figurer ici. Une colonne réécrite
// sans être lue s'ouvre vide dans le formulaire, et l'enregistrement — ou l'approbation de la
// proposition — l'efface, sans erreur nulle part. C'est arrivé quatre fois, une colonne à la fois :
// `price_label` (2026-09-17), l'occurrence d'un evento (2026-10-13), puis `external_booking_url`
// côté admin et `group_discount_*` des deux côtés (2026-10-14). Les deux écrans tenaient chacun leur
// propre liste, et elles divergeaient. productEditColumns.test.ts vérifie désormais la règle, type
// par type.
//
// `duration_days` est l'exception assumée : lu, jamais réécrit (il n'alimente que la prop
// `campDurationDays` de l'éditeur de programme). Le rendre éditable réécrirait rétroactivement les
// dates de commandes déjà payées (apps/web/lib/orders/formatLineSchedule.ts, getOrderByToken.ts).
//
// online_bookable et ses quatre voisins ne sont jamais proposables par un socio (réglage admin) :
// lus quand même côté socio, pour que le formulaire sache qu'un evento se réserve en ligne et
// n'affiche pas un prix libre vide.
export const PRODUCT_EDIT_COLUMNS =
  "id, type, name, description, establishment_id, address, lat, lon, price_cop, price_tiers, min_qty, max_qty, check_in_time, check_out_time, capacity, unit_count, lodging_kind, unit, default_capacity, stay_rates, lobby_category_id, lobby_product_id, external_booking_url, price_label, online_bookable, evento_capacity_mode, is_free, evento_payment_mode, evento_occupies_resource, occurrence_type, occurrence_date, recurrence_frequency_days, recurrence_end_date, recurrence_end_count, start_time, duration_minutes, transport_first_departure_time, transport_last_departure_time, transport_seats_per_departure, transport_departure_address, transport_departure_lat, transport_departure_lon, transport_arrival_address, transport_arrival_lat, transport_arrival_lon, transport_contact_phone, program, duration_days, group_discount_threshold_qty, group_discount_pct" as const;
