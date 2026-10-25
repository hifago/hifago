/**
 * Borne une quantité saisie entre un plancher (`products.min_qty`, replié à 1) et un maximum.
 *
 * ⚠️ LA GARDE `NaN` N'EST PAS DÉCORATIVE, et elle n'existait que dans UN des trois formulaires
 * (`LodgingReservationForm`) — les deux autres écrivaient `Math.min(Math.max(next, 1), max)`, or
 * `Math.max(NaN, 1)` vaut `NaN` et `setQty(NaN)` passe sans rien casser de visible : le champ
 * devient vide, le bouton reste actif, et le panier reçoit une quantité non finie.
 *
 * Le champ HTML `type="number"` rend probablement `""` (donc 0, donc borné au plancher) plutôt que
 * du texte, ce qui rendrait le trou inatteignable par un utilisateur réel — mais l'asymétrie de
 * code était réelle, et c'est exactement ce qu'une extraction est censée refermer. Mesuré : spec 30
 * §7a, duplication n°1.
 *
 * ⚠️ `min` cesse d'être 1 en dur depuis le 2026-09-14 (retour Jérôme, produit « Hiking Group »,
 * `min_qty: 2`) — exactement le jour anticipé par ce commentaire avant sa réécriture : `create_order`
 * refusait déjà `qty_below_minimum` pour un produit à `min_qty > 1`, mais RIEN au-dessus ne
 * l'empêchait ni ne le signalait (`CheckoutPage.json` n'avait même pas la clé de traduction). Le
 * PLANCHER ne s'applique qu'aux produits hors lodging : `create_order` ne vérifie `min_qty` que dans
 * sa branche non-lodging — `LodgingReservationForm` appelle donc ce module avec `min` fixé à 1. Le
 * PLAFOND : chaque formulaire passe ici la place restante, bornée par le plafond par réservation du
 * produit QUAND IL EN A UN. Depuis la migration 20261025120000 (décision Jérôme du 2026-10-25), une
 * activité, un logement ou un camp n'en a plus — un client peut prendre tout le cupo d'un coup ;
 * seuls l'evento et le transport gardent `coalesce(max_qty, 20)` (`perReservationQtyCap`).
 */
export function limitarCantidad(bruto: number, min: number, max: number): number {
  const piso = pisoCantidad(min, max);
  if (!Number.isFinite(bruto)) return piso;
  return Math.min(Math.max(bruto, piso), topeCantidad(max));
}

/**
 * La borne BASSE d'un champ de quantité — jamais sous 1, jamais au-dessus du maximum disponible.
 *
 * Ce dernier cas (produit à `min_qty` élevé mais plus qu'une place restante sur le créneau/la date
 * choisie) reste volontairement permissif ici : le champ retombe sur ce qui est réellement
 * disponible plutôt que de se bloquer sans qu'aucune quantité ne satisfasse à la fois le plancher et
 * le plafond. `create_order` reste le filet (`qty_below_minimum`, dorénavant traduit) si le client
 * valide quand même — fail-closed côté serveur, jamais côté champ.
 */
export function pisoCantidad(min: number, max: number): number {
  return Math.min(Math.max(min, 1), topeCantidad(max));
}

/**
 * La borne HAUTE d'un champ de quantité — jamais sous 1.
 *
 * ⚠️ C'est la même règle que celle du dernier paragraphe de `limitarCantidad`, et c'est pour ça
 * qu'elle est ici plutôt que réécrite : les trois formulaires posaient `Math.max(reste, 1)` en dur
 * dans l'attribut `max` de leur `<Input>`, soit une quatrième copie d'une décision que ce module
 * possède déjà et teste.
 */
export function topeCantidad(max: number): number {
  return Math.max(max, 1);
}

/**
 * Le plafond de quantité d'un séjour : les places restantes sur les nuits — et `maxQty` quand le
 * produit en a un. Un logement n'en a plus depuis la migration 20261025120000 (`maxQty` null) : un
 * client peut prendre tout ce qui reste ; avant, `coalesce(max_qty, 20)` bornait à 20 un dortoir qui
 * en offrait 30.
 *
 * Avec une plage choisie, ce sont les MOINS fournies de ses nuits qui bornent (une nuit absente de
 * `restantes` vaut 0 : fail-closed, comme `nuitReservable`). Sans plage, on ne sait pas encore quelles
 * nuits seront retenues : le MAXIMUM des nuits chargées, pour ne pas brider avant d'avoir un choix.
 * Aucune nuit chargée → `maxQty` s'il existe, sinon 1 : rien n'est encore réservable, et
 * `create_order` reste le filet.
 */
export function plafondCantidad(
  maxQty: number | null,
  restantes: ReadonlyMap<string, number>,
  nochesElegidas: readonly string[]
): number {
  const tope = maxQty !== null && maxQty > 0 ? maxQty : Number.POSITIVE_INFINITY;
  if (nochesElegidas.length > 0) {
    const minimo = Math.min(...nochesElegidas.map((noche) => restantes.get(noche) ?? 0));
    return Math.min(tope, Math.max(minimo, 0));
  }
  if (restantes.size === 0) return Number.isFinite(tope) ? tope : 1;
  return Math.min(tope, Math.max(...restantes.values(), 0));
}
