import { createClient } from "@hifago/supabase/client";
import { TAG_NAME_WITHOUT_SLUG, tagSlug } from "@/lib/tags/tagSlug";

// Renommer et supprimer une étiquette — UNE écriture pour tous les endroits où un admin le fait
// (demande Jérôme, 2026-10-13 : partout où une étiquette se choisit, elle doit pouvoir se modifier
// ou s'effacer) : /admin/tags (cellule, bouton « Editar », fiche détail) et le dialogue ouvert
// depuis chaque sélecteur (manage-tags-dialog.tsx). Pendant de createCatalogTag.ts ; `catalog_tags`
// reste en écriture admin-only (RLS) : ne jamais appeler ceci depuis l'espace socio.
//
// Chaque fonction rend `null`, ou le texte à afficher — l'appelant choisit son toast.

// ⚠️ Renommer RECALCULE le slug (`tagSlug`), comme à la création : l'adresse publique de la
// catégorie (`/actividades/<slug>`) suit le nom.
// Seule la clé `es` change : les autres langues du libellé sont gardées. `knownLabel` évite la
// lecture préalable à l'appelant qui les a déjà (la liste de /admin/tags).
export async function renameCatalogTag(
  tagId: string,
  labelEs: string,
  knownLabel?: Record<string, string>
): Promise<string | null> {
  const label = labelEs.trim();
  if (!label) return "El nombre de la etiqueta es obligatorio.";
  const slug = tagSlug(label);
  if (!slug) return TAG_NAME_WITHOUT_SLUG;

  const supabase = createClient();
  let translations = knownLabel;
  if (!translations) {
    const { data: current, error: readError } = await supabase
      .from("catalog_tags")
      .select("label")
      .eq("id", tagId)
      .maybeSingle();
    if (readError) return "No se pudo renombrar la etiqueta.";
    if (!current) return "Esta etiqueta ya no existe.";
    translations = Object.fromEntries(
      Object.entries((current.label ?? {}) as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    );
  }

  const { error } = await supabase
    .from("catalog_tags")
    .update({ label: { ...translations, es: label }, slug })
    .eq("id", tagId);
  if (!error) return null;
  // 23505 = doublon de slug ; 23514 = `otras`, réservé à la page des activités qu'aucune catégorie
  // ne classe (spec 29 §6a) — atteignable ici comme à la création, puisque le slug est recalculé.
  if (error.code === "23505") return "Ya existe una etiqueta con ese nombre.";
  if (error.code === "23514") {
    return "« Otras » está reservado para la página de actividades sin categoría. Usa otro nombre.";
  }
  return "No se pudo renombrar la etiqueta.";
}

// Supprime l'étiquette ET toutes ses assignations (fiches et établissements) : les deux tables de
// jointure sont en `on delete cascade`.
export async function deleteCatalogTag(tagId: string): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase.from("catalog_tags").delete().eq("id", tagId);
  return error ? "No se pudo eliminar la etiqueta." : null;
}

// Ce que la suppression retirerait — pour le texte de confirmation. `null` : comptage impossible,
// l'appelant avertit sans chiffre plutôt que d'afficher un zéro rassurant.
export async function countCatalogTagUsage(
  tagId: string
): Promise<{ products: number; establishments: number } | null> {
  const supabase = createClient();
  const [products, establishments] = await Promise.all([
    supabase.from("product_tag_assignments").select("tag_id", { count: "exact", head: true }).eq("tag_id", tagId),
    supabase
      .from("establishment_tag_assignments")
      .select("tag_id", { count: "exact", head: true })
      .eq("tag_id", tagId),
  ]);
  if (products.error || establishments.error) return null;
  return { products: products.count ?? 0, establishments: establishments.count ?? 0 };
}
