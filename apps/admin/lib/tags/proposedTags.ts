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
 *
 * ⚠️ L'ORDRE compte (migration 20261025100000) : la première étiquette est la principale, celle
 * qui classe la carte dans la vitrine. Le même ensemble dans un autre ordre est donc un
 * changement. `current` doit être lu dans l'ordre de `position`.
 */
export function tagIdsIfChanged(current: string[], selected: string[]): { tag_ids?: string[] } {
  const inchangee = selected.length === current.length && selected.every((id, i) => id === current[i]);
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
