import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { EditEstablishmentProposalForm } from "./EditEstablishmentProposalForm";
import { PhotosSocioBlock } from "@/components/photos-socio-block";
import { ownerScope } from "@/lib/partnerOwnership";

export default async function EditEstablishmentProposalPage({
  params,
}: PageProps<"/partner/establishment/[id]/edit">) {
  const { id } = await params;
  const supabase = await createClient();

  // Propriété (2026-10-01, lib/partnerOwnership.ts) : la RLS seule laissait passer tout
  // établissement ACTIF d'un autre partenaire (establishments_select_public). Le filtre
  // `partner_id` reprend le prédicat d'establishments_select ; un établissement hors de
  // l'organisation ressort « introuvable », jamais un refus explicite qui en révèlerait
  // l'existence. L'admin n'est pas restreint.
  const scope = await ownerScope(supabase);
  let establishmentQuery = supabase
    .from("establishments")
    .select("id, name, description, address, lat, lon")
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

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
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
        pendingProposal={pendingProposal}
      />
    </div>
  );
}
