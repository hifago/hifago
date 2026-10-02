import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { requireUuidParam } from "@/lib/routing/requireUuidParam";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { EstablishmentPhotosBlock } from "./EstablishmentPhotosBlock";
import { EstablishmentEditBlock } from "./EstablishmentEditBlock";
import { EstablishmentContactBlock } from "./EstablishmentContactBlock";
import { EstablishmentStayBlock } from "./EstablishmentStayBlock";
import { EstablishmentPmsBlock } from "./EstablishmentPmsBlock";
import { EstablishmentStatusBlock } from "./EstablishmentStatusBlock";
import { EstablishmentTagsBlock } from "./EstablishmentTagsBlock";
import { EstablishmentAmenitiesBlock } from "./EstablishmentAmenitiesBlock";
import { EstablishmentProductsTable } from "./EstablishmentProductsTable";

export default async function AdminEstablishmentDetailPage({
  params,
}: PageProps<"/admin/establishments/[id]">) {
  const id = requireUuidParam((await params).id);
  const supabase = await createClient();

  // Chaque lecture LÈVE sur une panne (lib/supabase/checkedRead.ts) : lue comme une absence, elle
  // répondait « introuvable », ou une fiche sans photos, catégories ni activités.

  // RLS (establishments_select) : l'admin voit n'importe quel établissement. Tous les champs de
  // présentation sont désormais éditables ici (docs/specs/06-gestion-etablissement.md §5.1) —
  // avant cette feature, seul `name` était lu (titre de page, lecture seule).
  // lobby_api_token n'est jamais lu (illisible même pour l'admin via PostgREST, cf. migration
  // 20260819110000_pms_connector_schema.sql) — lobby_has_token (dérivée, non secrète) suffit à
  // piloter l'affichage "token configurado".
  const { data: establishment } = checkedRead(
    await supabase
      .from("establishments")
      .select(
        "id, name, description, address, lat, lon, operated_directly, status, lobby_connector_active, lobby_has_token, lobby_last_synced_at, check_in_time, check_out_time, mode, contact_phone",
      )
      .eq("id", id)
      .maybeSingle(),
    "establishments",
  );

  if (!establishment) {
    notFound();
  }

  // Bandeau d'avertissement (spec 06 §5.1) : une seule requête select, pas de nouvelle RPC — évite
  // que l'admin modifie en aveugle pendant qu'une proposition d'édition du partner attend.
  // `.limit(1)` : seule la présence compte (bandeau), et rien n'interdit deux propositions en
  // attente — `maybeSingle()` sur deux lignes est une erreur, qui ferait maintenant échouer la page.
  const { data: pendingEditProposal } = checkedRead(
    await supabase
      .from("establishment_proposals")
      .select("id")
      .eq("establishment_id", establishment.id)
      .eq("kind", "edit")
      .eq("status", "pending")
      .limit(1)
      .maybeSingle(),
    "establishment_proposals",
  );

  const { data: media } = checkedRead(
    await supabase
      .from("establishment_media")
      .select("id, storage_path")
      .eq("establishment_id", establishment.id)
      .order("sort", { ascending: true }),
    "establishment_media",
  );

  const photos = (media ?? []).map((m) => ({
    id: m.id,
    url: supabase.storage.from("catalog-media").getPublicUrl(m.storage_path).data.publicUrl,
  }));

  // Catégories (chantier "catégories partout", 2026-09-14) — même patron que ProductTagsBlock
  // (products/[id]/edit/page.tsx), aucun gating par type : un établissement est TOUJOURS éligible.
  const [tagsResult, tagAssignmentsResult] = await Promise.all([
    supabase.from("catalog_tags").select("id, label").order("slug"),
    supabase
      .from("establishment_tag_assignments")
      .select("tag_id")
      .eq("establishment_id", establishment.id),
  ]);
  const { data: tagsRaw } = checkedRead(tagsResult, "catalog_tags");
  const { data: tagAssignments } = checkedRead(tagAssignmentsResult, "establishment_tag_assignments");

  const allTags = (tagsRaw ?? []).map((tag) => ({
    id: tag.id,
    label: resolveLocalizedField(asLocalizedField(tag.label), "es") ?? tag.id,
  }));
  const initialTagIds = (tagAssignments ?? []).map((a) => a.tag_id);

  // Équipements structurés (migration 20260917110000, décision Jérôme du 2026-09-17) — même patron
  // que les tags ci-dessus, table dédiée `catalog_amenities` (jamais `catalog_tags`, réservée aux
  // catégories éditoriales), aucun gating par type côté établissement.
  const [amenitiesResult, amenityAssignmentsResult] = await Promise.all([
    supabase.from("catalog_amenities").select("id, label, category_key").order("category_key").order("sort_order"),
    supabase
      .from("establishment_amenity_assignments")
      .select("amenity_id")
      .eq("establishment_id", establishment.id),
  ]);
  const { data: amenitiesRaw } = checkedRead(amenitiesResult, "catalog_amenities");
  const { data: amenityAssignments } = checkedRead(amenityAssignmentsResult, "establishment_amenity_assignments");

  const allAmenities = (amenitiesRaw ?? []).map((amenity) => ({
    id: amenity.id,
    label: resolveLocalizedField(asLocalizedField(amenity.label), "es") ?? amenity.id,
  }));
  const initialAmenityIds = (amenityAssignments ?? []).map((a) => a.amenity_id);

  // RLS (products_select_public) : l'admin voit aussi les activités non publiées (sellable=false).
  const { data: products } = checkedRead(
    await supabase
      .from("products")
      .select("id, name, price_cop, sellable")
      .eq("establishment_id", id)
      .order("created_at", { ascending: false }),
    "products",
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/admin/establishments"
          className="text-sm text-muted hover:underline"
        >
          ← Establecimientos
        </Link>
        <h1 className="text-2xl font-semibold">
          {resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id}
        </h1>
      </div>

      <EstablishmentStatusBlock establishmentId={establishment.id} initialStatus={establishment.status} />

      <EstablishmentEditBlock
        establishmentId={establishment.id}
        initialNameEs={asLocalizedField(establishment.name)?.es ?? ""}
        initialDescriptionEs={asLocalizedField(establishment.description)?.es ?? ""}
        initialDescriptionEn={asLocalizedField(establishment.description)?.en ?? ""}
        initialAddress={establishment.address ?? ""}
        initialLat={establishment.lat !== null ? String(establishment.lat) : ""}
        initialLon={establishment.lon !== null ? String(establishment.lon) : ""}
        initialOperatedDirectly={establishment.operated_directly}
        pendingEditProposalId={pendingEditProposal?.id ?? null}
      />

      <EstablishmentStayBlock
        establishmentId={establishment.id}
        initialCheckInTime={establishment.check_in_time}
        initialCheckOutTime={establishment.check_out_time}
        initialMode={establishment.mode}
      />

      <EstablishmentContactBlock
        establishmentId={establishment.id}
        initialContactPhone={establishment.contact_phone}
      />

      <EstablishmentPmsBlock
        establishmentId={establishment.id}
        initialConnectorActive={establishment.lobby_connector_active}
        initialHasToken={establishment.lobby_has_token ?? false}
        initialLastSyncedAt={establishment.lobby_last_synced_at}
      />

      <EstablishmentPhotosBlock establishmentId={establishment.id} initialPhotos={photos} />

      <EstablishmentTagsBlock
        establishmentId={establishment.id}
        allTags={allTags}
        initialTagIds={initialTagIds}
      />

      <EstablishmentAmenitiesBlock
        establishmentId={establishment.id}
        allAmenities={allAmenities}
        initialAmenityIds={initialAmenityIds}
      />

      <EstablishmentProductsTable products={products ?? []} />
    </div>
  );
}
