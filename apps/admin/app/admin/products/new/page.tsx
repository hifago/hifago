import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { ProductForm } from "@/components/product-form";

export default async function NewProductPage({
  searchParams,
}: PageProps<"/admin/products/new">) {
  const supabase = await createClient();

  // RLS (establishments_select) : l'admin voit tous les établissements, nécessaire pour le
  // sélecteur.
  const { data: establishments } = checkedRead(
    await supabase
      .from("establishments")
      .select("id, name, partner_id, lobby_connector_active, lobby_has_token")
      .order("created_at", { ascending: false }),
    "establishments",
  );

  const { data: tagsRaw } = checkedRead(
    await supabase.from("catalog_tags").select("id, label").order("slug"),
    "catalog_tags",
  );
  const allTags = (tagsRaw ?? []).map((tag) => ({
    id: tag.id,
    label: resolveLocalizedField(asLocalizedField(tag.label), "es") ?? tag.id,
  }));

  // Équipements structurés (migration 20260917110000) — staged à la création (ProductForm variant
  // "admin" uniquement, cf. son commentaire showAmenities). Chargé inconditionnellement ici (pas de
  // gating par type possible avant que l'admin choisisse "Alojamiento" dans le formulaire) — même
  // logique que allTags, dont le gating par type est décidé côté client.
  const { data: amenitiesRaw } = checkedRead(
    await supabase
      .from("catalog_amenities")
      .select("id, label, category_key")
      .order("category_key")
      .order("sort_order"),
    "catalog_amenities",
  );
  const allAmenities = (amenitiesRaw ?? []).map((amenity) => ({
    id: amenity.id,
    label: resolveLocalizedField(asLocalizedField(amenity.label), "es") ?? amenity.id,
  }));

  const resolvedSearchParams = await searchParams;
  const establishmentParam = resolvedSearchParams?.establishment;
  // Pré-rempli si venu de la liste établissements (?establishment=<id>), mais toujours modifiable
  // dans le formulaire — cf. plan feature 2.
  const initialEstablishmentId =
    typeof establishmentParam === "string" ? establishmentParam : "";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Nueva actividad</h1>
      <ProductForm
        establishments={establishments ?? []}
        initialEstablishmentId={initialEstablishmentId}
        allTags={allTags}
        allAmenities={allAmenities}
      />
    </div>
  );
}
