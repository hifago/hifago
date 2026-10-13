import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import type { TagOption } from "@/components/tags-multiselect";

// Étiquettes dans une proposition d'ÉDITION (fiche ou établissement) — migration 20261013144848.
// Pas de "use client" : lu par les pages (Server Components) comme par les formulaires.

export function toTagOptions(rows: { id: string; label: unknown }[] | null): TagOption[] {
  return (rows ?? []).map((tag) => ({
    id: tag.id,
    label: resolveLocalizedField(asLocalizedField(tag.label), "es") ?? tag.id,
  }));
}

/**
 * La clé `tag_ids` n'entre dans le payload QUE si la sélection diffère des étiquettes en place.
 *
 * ⚠️ Ce n'est pas une optimisation. Côté SQL, une clé présente REMPLACE l'ensemble à
 * l'approbation ; une clé absente n'y touche pas. Envoyer la sélection à chaque fois ferait donc
 * de toute proposition — même une simple correction de nom — un écrasement des étiquettes qu'un
 * admin aurait posées entre le dépôt et l'approbation.
 */
export function tagIdsIfChanged(current: string[], selected: string[]): { tag_ids?: string[] } {
  const enPlace = new Set(current);
  const inchangee = selected.length === enPlace.size && selected.every((id) => enPlace.has(id));
  return inchangee ? {} : { tag_ids: selected };
}

/** Le tableau proposé, ou `null` quand la proposition ne touche pas aux étiquettes. */
export function proposedTagIds(payload: { tag_ids?: unknown }): string[] | null {
  return Array.isArray(payload.tag_ids)
    ? payload.tag_ids.filter((id): id is string => typeof id === "string")
    : null;
}

export function tagLabels(ids: string[], tags: TagOption[]): string {
  const labels = ids
    .map((id) => tags.find((tag) => tag.id === id)?.label)
    .filter((label): label is string => Boolean(label));
  return labels.length > 0 ? labels.join(", ") : "—";
}
