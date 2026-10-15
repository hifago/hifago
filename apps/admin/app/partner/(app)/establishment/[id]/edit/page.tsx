import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { EditEstablishmentProposalForm } from "./EditEstablishmentProposalForm";
import { PhotosSocioBlock } from "@/components/photos-socio-block";
import { ownerScope } from "@/lib/partnerOwnership";
import { toTagOptions } from "@/lib/tags/proposedTags";
import { stayFromColumns } from "@/lib/establishments/stayFields";
import { requireUuidParam } from "@/lib/routing/requireUuidParam";

export default async function EditEstablishmentProposalPage({
  params,
}: PageProps<"/partner/establishment/[id]/edit">) {
  // Pas un UUID → 404 avant toute lecture : la lecture, qui lève sur erreur, afficherait sinon
  // l'écran d'erreur pour une faute de frappe dans l'URL.
  const id = requireUuidParam((await params).id);
  const supabase = await createClient();

  // Propriété (2026-10-01, lib/partnerOwnership.ts) : la RLS seule laissait passer tout
  // établissement ACTIF d'un autre partenaire (establishments_select_public). Le filtre
  // `partner_id` reprend le prédicat d'establishments_select ; un établissement hors de
  // l'organisation ressort « introuvable », jamais un refus explicite qui en révèlerait
  // l'existence. L'admin n'est pas restreint.
  const scope = await ownerScope(supabase);
  let establishmentQuery = supabase
    .from("establishments")
    // Séjour, contact public et is_place (2026-10-14, migration 20261015004421) : le partenaire
    // propose désormais toute la fiche que l'admin édite. Chacun est accordé en lecture colonne par
    // colonne à `authenticated` (establishments n'a pas de grant SELECT global).
    .select("id, name, description, address, lat, lon, check_in_time, check_out_time, mode, contact_phone, is_place")
    .eq("id", id);
  if (scope.kind === "partner") {
    establishmentQuery = establishmentQuery.eq("partner_id", scope.partnerId);
  }
  // Une panne LÈVE (app/error.tsx) : lue comme une absence, elle répondait « introuvable ».
  const { data: establishment, error: establishmentError } = await establishmentQuery.maybeSingle();
  if (establishmentError) {
    throw new Error(`Lecture de l'établissement impossible (establishments) : ${establishmentError.message}`);
  }
  if (!establishment) {
    notFound();
  }

  // `.limit(1)` sur les propositions : rien en base n'empêche deux propositions en attente pour le
  // même établissement, et `maybeSingle()` sur deux lignes est une ERREUR — qui, lue maintenant,
  // ferait échouer la page. On affiche la plus récente, ce que le tri voulait déjà dire.
  const { data: pendingProposal, error: pendingError } = await supabase
    .from("establishment_proposals")
    .select("id, payload, created_at")
    .eq("establishment_id", id)
    .eq("kind", "edit")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingError) {
    throw new Error(`Lecture de la fiche impossible (establishment_proposals) : ${pendingError.message}`);
  }

  const { data: media, error: mediaError } = await supabase
    .from("establishment_media")
    .select("id, storage_path")
    .eq("establishment_id", id)
    .order("sort", { ascending: true });
  if (mediaError) {
    throw new Error(`Lecture de la fiche impossible (establishment_media) : ${mediaError.message}`);
  }

  const photos = (media ?? []).map((m) => ({
    id: m.id,
    url: supabase.storage.from("catalog-media").getPublicUrl(m.storage_path).data.publicUrl,
  }));

  const { data: pendingPhotosProposal, error: pendingPhotosError } = await supabase
    .from("establishment_proposals")
    .select("payload")
    .eq("establishment_id", id)
    .eq("status", "pending")
    .eq("kind", "photos")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingPhotosError) {
    throw new Error(`Lecture de la fiche impossible (establishment_proposals) : ${pendingPhotosError.message}`);
  }

  // Aperçu réel des photos proposées, pas seulement leur nombre — symétrique au fix produit
  // (retour Jérôme 2026-08-17, apps/admin/app/partner/(app)/products/[id]/edit/page.tsx).
  const pendingPhotos = (
    (pendingPhotosProposal?.payload as { photos?: { storage_path?: string }[] } | null)?.photos ?? []
  )
    .map((p) => p?.storage_path)
    .filter((path): path is string => Boolean(path))
    .map((path) => supabase.storage.from("catalog-media").getPublicUrl(path).data.publicUrl);

  // Étiquettes (migration 20261013144848) : le catalogue et celles déjà posées sur
  // l'établissement. Le socio en propose le changement avec le reste ; il ne les écrit jamais
  // lui-même (RLS admin-only sur establishment_tag_assignments).
  const { data: tags, error: tagsError } = await supabase
    .from("catalog_tags")
    .select("id, label")
    .order("slug");
  if (tagsError) {
    throw new Error(`Lecture de la fiche impossible (catalog_tags) : ${tagsError.message}`);
  }

  const { data: tagAssignments, error: tagAssignmentsError } = await supabase
    .from("establishment_tag_assignments")
    .select("tag_id")
    .eq("establishment_id", id);
  if (tagAssignmentsError) {
    throw new Error(
      `Lecture de la fiche impossible (establishment_tag_assignments) : ${tagAssignmentsError.message}`,
    );
  }

  // Équipements (migration 20261015004421) : même patron que les étiquettes ci-dessus — le
  // référentiel fermé et ceux déjà posés. Le socio en propose le changement, il ne les écrit jamais
  // (RLS admin-only sur establishment_amenity_assignments).
  const { data: amenities, error: amenitiesError } = await supabase
    .from("catalog_amenities")
    .select("id, label")
    .order("category_key")
    .order("sort_order");
  if (amenitiesError) {
    throw new Error(`Lecture de la fiche impossible (catalog_amenities) : ${amenitiesError.message}`);
  }

  const { data: amenityAssignments, error: amenityAssignmentsError } = await supabase
    .from("establishment_amenity_assignments")
    .select("amenity_id")
    .eq("establishment_id", id);
  if (amenityAssignmentsError) {
    throw new Error(
      `Lecture de la fiche impossible (establishment_amenity_assignments) : ${amenityAssignmentsError.message}`,
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="titre-page">
        Proponer edición —{" "}
        {resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id}
      </h1>

      <PhotosSocioBlock
        entityType="establishment"
        entityId={establishment.id}
        submitRpc="submit_establishment_photos_proposal"
        deleteTable="establishment_media"
        notFoundLabel="No se encontró el establecimiento."
        initialPhotos={photos}
        initialPendingPhotos={pendingPhotos}
      />

      <EditEstablishmentProposalForm
        establishmentId={establishment.id}
        initialNameEs={asLocalizedField(establishment.name)?.es ?? ""}
        initialDescriptionEs={asLocalizedField(establishment.description)?.es ?? ""}
        initialDescriptionEn={asLocalizedField(establishment.description)?.en ?? ""}
        initialAddress={establishment.address ?? ""}
        initialLat={establishment.lat !== null ? String(establishment.lat) : ""}
        initialLon={establishment.lon !== null ? String(establishment.lon) : ""}
        initialStay={stayFromColumns(establishment)}
        initialContactPhone={establishment.contact_phone ?? ""}
        isPlace={establishment.is_place}
        pendingProposal={pendingProposal}
        availableTags={toTagOptions(tags)}
        currentTagIds={(tagAssignments ?? []).map((row) => row.tag_id)}
        availableAmenities={toTagOptions(amenities)}
        currentAmenityIds={(amenityAssignments ?? []).map((row) => row.amenity_id)}
      />
    </div>
  );
}
