import { createClient } from "@hifago/supabase/client";
import type { TagOption } from "@/components/tags-multiselect";
import { TAG_NAME_WITHOUT_SLUG, tagSlug } from "@/lib/tags/tagSlug";

// Création d'une étiquette par un admin — UNE écriture pour tous les endroits où l'on en saisit
// (demande Jérôme, 2026-10-13 : partout où une étiquette se choisit, elle doit pouvoir se créer) :
// le formulaire de /admin/tags, le sélecteur des fiches (tags-multiselect.tsx) et la cellule
// « Etiquetas » du catálogo (ProductsList.tsx). `catalog_tags` reste en écriture admin-only (RLS) :
// ne jamais appeler ceci depuis l'espace socio.
//
// Rend l'étiquette créée, ou le texte à afficher — l'appelant choisit son toast.
export async function createCatalogTag(labelEs: string): Promise<{ tag: TagOption } | { error: string }> {
  const label = labelEs.trim();
  if (!label) return { error: "El nombre de la etiqueta es obligatorio." };
  const slug = tagSlug(label);
  if (!slug) return { error: TAG_NAME_WITHOUT_SLUG };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("catalog_tags")
    .insert({ label: { es: label }, slug })
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === "23505") return { error: "Ya existe una etiqueta con ese nombre." };
    if (error?.code === "23514") {
      // ⚠️ Le slug est dérivé du nom (`tagSlug`), jamais saisi : un admin qui écrit « Otras »
      // déclenche la contrainte `catalog_tags_slug_reservado` sans avoir rien fait de visiblement
      // interdit. Sans ce message, il lirait « No se pudo crear » et réessaierait à l'identique.
      // `otras` est réservé à la page des activités qu'aucune catégorie ne classe (spec 29 §6a).
      return {
        error: "« Otras » está reservado para la página de actividades sin categoría. Usa otro nombre.",
      };
    }
    return { error: "No se pudo crear la etiqueta." };
  }

  return { tag: { id: data.id, label } };
}
