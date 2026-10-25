/**
 * Bornes de quantité PAR RÉSERVATION (`products.min_qty` / `products.max_qty`) — quels types en ont.
 *
 * Décision Jérôme du 2026-10-25 : « s'il y a un cupo diario et qu'il peut être réservé en une fois,
 * on s'en fout ». Un produit qui a un cupo — activité, logement, camp — n'a plus de MAXIMUM par
 * réservation : un client peut prendre tout ce qui reste, la place restante (date, créneau, nuits)
 * est la seule borne. Le maximum ne reste que là où rien d'autre ne borne : le transport (sans cupo,
 * non vendu en ligne) et l'evento (ses modes « unlimited » / « rsvp » n'ont pas de cupo — repli 20).
 * Le MINIMUM n'a jamais été vérifié pour un logement (`create_order` ne le lit que hors lodging) :
 * il n'existe plus pour ce type.
 *
 * Miroir SQL, dans la migration 20261025120000 : `public.product_qty_cap` (même liste, même repli
 * 20) et les contraintes `products_max_qty_only_without_cupo` / `products_min_qty_not_lodging`.
 * Changer une liste ici sans l'autre fait diverger l'écran de la base : la base refuserait ce que
 * le formulaire propose, ou la fiche plafonnerait ce que `create_order` accepte.
 */
const TYPES_WITHOUT_MAX_QTY: ReadonlySet<string> = new Set(["activity", "lodging", "camp"]);

/** Le repli de `coalesce(max_qty, 20)` dans `public.product_qty_cap`. */
export const DEFAULT_MAX_QTY_PER_RESERVATION = 20;

/** Le type peut-il porter un maximum par réservation (`products.max_qty`) ? */
export function productTypeHasMaxQty(type: string): boolean {
  return !TYPES_WITHOUT_MAX_QTY.has(type);
}

/** Le type peut-il porter un minimum par réservation (`products.min_qty`) ? */
export function productTypeHasMinQty(type: string): boolean {
  return type !== "lodging";
}

/**
 * Le plafond d'UNE réservation, ou `null` quand seule la place restante borne — exactement
 * `public.product_qty_cap(type, max_qty)`.
 */
export function perReservationQtyCap(type: string, maxQty: number | null): number | null {
  if (!productTypeHasMaxQty(type)) return null;
  return maxQty !== null && maxQty > 0 ? maxQty : DEFAULT_MAX_QTY_PER_RESERVATION;
}
