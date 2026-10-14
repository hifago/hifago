import { createClient } from "@hifago/supabase/client";
import type { CatalogItemEditor } from "@/components/manage-tags-dialog";

// Renommer et supprimer un équipement (`catalog_amenities`, liste FERMÉE : jamais de création ici)
// — pendant de lib/tags/editCatalogTag.ts, mais par deux RPC admin auditées
// (20261014204041_catalog_amenities_admin_edit) : la table est RPC-only en écriture.
//
// Chaque fonction rend `null`, ou le texte à afficher — l'appelant choisit son toast.

const RENAME_FAILURES: Record<string, string> = {
  label_es_required: "El nombre en español es obligatorio.",
  label_en_required: "El nombre en inglés es obligatorio.",
  amenity_not_found: "Este equipamiento ya no existe.",
  duplicate_name: "Ya existe un equipamiento con ese nombre.",
};

// Le slug ne bouge pas (clé stable de mockData) : seuls les libellés es et en changent, les autres
// langues sont gardées par la RPC.
export async function renameCatalogAmenity(
  amenityId: string,
  labels: { es: string; en: string }
): Promise<string | null> {
  const { data, error } = await createClient().rpc("admin_rename_catalog_amenity", {
    p_amenity_id: amenityId,
    p_label_es: labels.es,
    p_label_en: labels.en,
  });
  if (error) return "No se pudo renombrar el equipamiento.";
  const result = data as { ok: boolean; reason?: string } | null;
  if (result?.ok) return null;
  return RENAME_FAILURES[result?.reason ?? ""] ?? "No se pudo renombrar el equipamiento.";
}

// Supprime l'équipement ET ses assignations (établissements, fiches), comme une étiquette : les
// deux tables de jointure sont en `on delete cascade`.
export async function deleteCatalogAmenity(amenityId: string): Promise<string | null> {
  const { data, error } = await createClient().rpc("admin_delete_catalog_amenity", {
    p_amenity_id: amenityId,
  });
  if (error) return "No se pudo eliminar el equipamiento.";
  const result = data as { ok: boolean; reason?: string } | null;
  if (result?.ok) return null;
  return result?.reason === "amenity_not_found"
    ? "Este equipamiento ya no existe."
    : "No se pudo eliminar el equipamiento.";
}

// Ce que la suppression retirerait — pour le texte de confirmation. `null` : comptage impossible,
// l'appelant avertit sans chiffre plutôt que d'afficher un zéro rassurant.
export async function countCatalogAmenityUsage(
  amenityId: string
): Promise<{ products: number; establishments: number } | null> {
  const supabase = createClient();
  const [products, establishments] = await Promise.all([
    supabase.from("product_amenity_assignments").select("amenity_id", { count: "exact", head: true }).eq("amenity_id", amenityId),
    supabase
      .from("establishment_amenity_assignments")
      .select("amenity_id", { count: "exact", head: true })
      .eq("amenity_id", amenityId),
  ]);
  if (products.error || establishments.error) return null;
  return { products: products.count ?? 0, establishments: establishments.count ?? 0 };
}

// Les libellés actuels, pour pré-remplir les deux champs du renommage (le sélecteur ne porte que
// l'espagnol). `null` : lecture impossible — le dialogue le dit, il ne pré-remplit pas de vide.
export async function loadCatalogAmenityLabels(amenityId: string): Promise<Record<string, string> | null> {
  const { data, error } = await createClient()
    .from("catalog_amenities")
    .select("label")
    .eq("id", amenityId)
    .maybeSingle();
  if (error || !data) return null;
  return Object.fromEntries(
    Object.entries((data.label ?? {}) as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const AMENITY_EDITOR: CatalogItemEditor = {
  texts: {
    manage: "Editar o eliminar equipamiento",
    title: "Editar o eliminar equipamiento",
    search: "Buscar un equipamiento",
    empty: "Ningún equipamiento.",
    renamed: "Equipamiento renombrado.",
    deleted: "Equipamiento eliminado.",
  },
  languages: [
    { key: "es", label: "Nombre (español)" },
    { key: "en", label: "Nombre (inglés)" },
  ],
  loadLabels: loadCatalogAmenityLabels,
  rename: (id, labels) => renameCatalogAmenity(id, { es: labels.es ?? "", en: labels.en ?? "" }),
  remove: deleteCatalogAmenity,
  countUsage: countCatalogAmenityUsage,
  usageWarning(usage) {
    if (usage === undefined) return "Comprobando dónde se usa…";
    if (usage === null) return "Se quitará de todas las fichas que lo usan. Esta acción no se puede deshacer.";
    const parts = [
      usage.establishments > 0 ? plural(usage.establishments, "establecimiento", "establecimientos") : null,
      usage.products > 0 ? plural(usage.products, "alojamiento", "alojamientos") : null,
    ].filter(Boolean);
    return parts.length > 0
      ? `Se quitará de ${parts.join(" y ")}. Esta acción no se puede deshacer.`
      : "Ninguna ficha lo usa. Esta acción no se puede deshacer.";
  },
};
