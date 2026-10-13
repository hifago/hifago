// Équipements d'un logement dans une proposition d'ÉDITION — migration 20261013151206. Pendant de
// lib/tags/proposedTags.ts, dont `toTagOptions` et `tagLabels` servent aussi aux équipements (même
// forme `{ id, label }`). Pas de "use client" : lu par les pages comme par les formulaires.

/**
 * La clé `amenity_ids` n'entre dans le payload QUE si la sélection diffère des équipements en
 * place — même contrat que `tagIdsIfChanged` : côté SQL, une clé présente REMPLACE l'ensemble à
 * l'approbation, une clé absente n'y touche pas.
 */
export function amenityIdsIfChanged(current: string[], selected: string[]): { amenity_ids?: string[] } {
  const enPlace = new Set(current);
  const inchangee = selected.length === enPlace.size && selected.every((id) => enPlace.has(id));
  return inchangee ? {} : { amenity_ids: selected };
}

/** Le tableau proposé, ou `null` quand la proposition ne touche pas aux équipements. */
export function proposedAmenityIds(payload: { amenity_ids?: unknown }): string[] | null {
  return Array.isArray(payload.amenity_ids)
    ? payload.amenity_ids.filter((id): id is string => typeof id === "string")
    : null;
}
