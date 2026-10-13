import { slugify } from "@/lib/utils";

// Le slug d'une étiquette : sa clé d'unicité dans `catalog_tags` ET l'adresse publique de sa
// catégorie sur la vitrine (`/alojamientos/<slug>`). Jamais saisi, toujours dérivé du nom.
//
// ⚠️ `slugify` ne garde que lettres et chiffres : « $ », « $$ » et « $$$ » donnaient tous le slug
// VIDE. La première se créait (adresse publique vide), les suivantes passaient pour son doublon et
// le sélecteur ne proposait même plus de les créer (constaté par Jérôme, 2026-10-13). Les gammes de
// prix sont le seul nom tout en symboles qu'on accepte : `$$` → `precio-2`. Tout autre nom sans
// lettre ni chiffre rend "" — l'appelant le refuse (`TAG_NAME_WITHOUT_SLUG`), il ne l'écrit jamais.
export function tagSlug(label: string): string {
  const trimmed = label.trim();
  return /^\$+$/.test(trimmed) ? `precio-${trimmed.length}` : slugify(trimmed);
}

export const TAG_NAME_WITHOUT_SLUG = "El nombre necesita al menos una letra o un número.";

/** Vrai quand créer `label` heurterait une étiquette existante (même slug). */
export function isExistingTagName(label: string, existingLabels: string[]): boolean {
  const slug = tagSlug(label);
  return slug !== "" && existingLabels.some((existing) => tagSlug(existing) === slug);
}

// Recherche dans un sélecteur d'étiquettes : sans accents ni casse, comme partout dans l'admin.
// Une requête tout en symboles (« $$ ») n'a pas de forme slugifiée : elle se compare au nom tel
// quel, sinon elle ne filtrerait rien et la liste entière resterait affichée.
export function tagMatchesQuery(label: string, query: string): boolean {
  const needle = slugify(query);
  if (needle) return slugify(label).includes(needle);
  return label.toLowerCase().includes(query.trim().toLowerCase());
}
