import { type LodgingKind } from "./lodgingKind.ts";

/**
 * Combien de « cupos » offre UNE unité physique d'un logement.
 *
 * hifago compte `qty` en CUPOS — `order_lines.qty`, `min_qty`/`max_qty`, `price_tiers` et
 * `product_availability.capacity` parlent tous cette langue-là. Elle a été écrite le 2026-08-28 pour
 * convertir `available_rooms` de Lobby, sur l'hypothèse que Lobby compte des unités physiques et
 * qu'un dortoir se vend au lit (`unités × capacity`).
 *
 * ⚠️ CETTE FONCTION NE SERT PLUS LES PRODUITS PMS (corrigé le 2026-10-23). Une catégorie Lobby
 * `compartida` compte DÉJÀ des lits : VIDPOVO = `capacity:1 × quantity:8` (spec 24 §11.1), donc
 * `available_rooms` y est déjà un nombre de lits. Le multiplier encore par `products.capacity` (8)
 * affichait 64 cupos, plafonnés seulement par `coalesce(max_qty, 20)`. Pour un PMS-backed, une unité
 * Lobby = un cupo : `pmsUnitsToCupos`, plus bas. `cuposPerUnit` reste la règle du vocabulaire
 * `unit_count × capacity` du garde-fou `capacity_exceeds_physical` (migration 20260827250000) :
 * un dortoir se vend au LIT, une privée ou une maison à l'UNITÉ, `lodging_kind` NULL suit le dortoir.
 * Les deux chemins ne se croisent pas : `create_order` saute verrou et décrément pour un produit PMS.
 *
 * CE QUI PROTÈGE VRAIMENT. Le `switch` ci-dessous est exhaustif sur `LodgingKind` : ajouter une
 * quatrième valeur casse la COMPILATION ici, et force à trancher explicitement. C'était le vrai
 * risque — la version précédente retombait par défaut sur `capacity` là où le SQL retombe sur
 * `unit_count`, deux défauts opposés qui auraient divergé en silence.
 */
export function cuposPerUnit(kind: LodgingKind | null, capacity: number | null): number {
  // `capacity` est nullable, et une valeur <= 0 ferait disparaître toute disponibilité par
  // multiplication — jamais un calendrier vide sur une donnée manquante.
  const perUnit = capacity !== null && capacity > 0 ? capacity : 1;

  // Type de couchage non renseigné : borne haute, exactement le choix du garde-fou SQL. Sans le
  // type on ignore si l'on vend des lits ou des unités, et ce n'est pas ici qu'on arbitre un
  // modèle de vente.
  if (kind === null) return perUnit;

  switch (kind) {
    case "dorm":
      return perUnit;
    case "private":
    case "whole_house":
      return 1;
    default: {
      // Inatteignable : `asLodgingKind` normalise à l'une des trois valeurs ou à null. Cette
      // branche existe pour que TypeScript refuse de compiler si LODGING_KINDS s'agrandit.
      const nonCouvert: never = kind;
      void nonCouvert;
      // Même repli que la branche `else` du garde-fou SQL, pour que les deux défauts coïncident.
      return 1;
    }
  }
}

/**
 * Unités Lobby → cupos hifago pour un produit PMS-backed : FACTEUR 1, quelle que soit
 * `products.capacity`. `available_rooms` de Lobby compte déjà ce que hifago vend — une tente, une
 * chambre, ou un lit pour une catégorie partagée (`capacity:1 × quantity:8`). Cf. l'en-tête de
 * `cuposPerUnit` pour le défaut du 2026-10-23 (64 cupos au lieu de 8 sur VIDPOVO).
 *
 * Une fonction nommée plutôt qu'un `* 1` muet : les deux sites de lecture (route
 * `night-availability`, semis SSR de la fiche) et le chat des réservations en vol s'accordent ici.
 * Un nombre non fini ou négatif ne fabrique jamais de disponibilité : 0.
 */
export function pmsUnitsToCupos(units: number): number {
  return Number.isFinite(units) && units > 0 ? units : 0;
}
