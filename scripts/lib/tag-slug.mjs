// Slug d'une gamme de prix, calculé comme l'admin (apps/admin/lib/tags/tagSlug.ts) : un libellé
// fait seulement de « $ » devient `precio-N`, N = nombre de « $ ». Tout autre libellé rend null :
// l'appelant prend alors le slugify ordinaire.
//
// ⚠️ Copie de la règle de l'admin, pas une source partagée : `supabase/scripts/seed-mock-data.mjs`
// tourne sous `node` sans TypeScript et ne peut pas importer `tagSlug.ts`. Les deux tests figent
// les mêmes sorties (`precio-1` à `precio-4`), et la base refuse un slug vide
// (`catalog_tags_slug_no_vacio`, 20261014210927).
export function slugGammePrix(label) {
  const trimmed = label.trim();
  return /^\$+$/.test(trimmed) ? `precio-${trimmed.length}` : null;
}
