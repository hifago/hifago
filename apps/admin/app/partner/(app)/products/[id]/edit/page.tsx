import type { ProductType } from "@/lib/products/productTypeGating";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { EditProposalForm } from "./EditProposalForm";
import { PhotosSocioBlock } from "@/components/photos-socio-block";
import { ownerScope } from "@/lib/partnerOwnership";

export default async function EditProductProposalPage({
  params,
}: PageProps<"/partner/products/[id]/edit">) {
  const { id } = await params;
  const supabase = await createClient();

  // Propriété (2026-10-01, lib/partnerOwnership.ts) : la RLS seule laissait passer toute fiche EN
  // VENTE d'un autre partenaire (products_select_public). Le filtre `partner_id` reprend le
  // prédicat de products_select_own ; une fiche hors de l'organisation ressort « introuvable »,
  // jamais un refus explicite qui en révèlerait l'existence. L'admin n'est pas restreint.
  // Colonnes étendues (spec 15 bis, 2026-08-17) : parité de champs avec ProductForm en mode
  // édition — address/lat/lon/price_tiers/min_qty/max_qty/check_in_time/check_out_time/capacity/
  // stay_rates, plus `type` pour le gating (ProductTypeFields).
  const scope = await ownerScope(supabase);
  let productQuery = supabase
    .from("products")
    .select(
      "id, type, name, description, address, lat, lon, price_cop, price_tiers, min_qty, max_qty, check_in_time, check_out_time, capacity, unit_count, lodging_kind, unit, default_capacity, stay_rates, establishment_id, lobby_category_id, lobby_product_id, transport_first_departure_time, transport_last_departure_time, transport_seats_per_departure, transport_departure_address, transport_departure_lat, transport_departure_lon, transport_arrival_address, transport_arrival_lat, transport_arrival_lon, transport_contact_phone, program, duration_days, establishment:establishments(lobby_connector_active, lobby_has_token)"
    )
    .eq("id", id);
  if (scope.kind === "partner") {
    productQuery = productQuery.eq("partner_id", scope.partnerId);
  }
  // Une panne LÈVE (app/error.tsx) : lue comme une absence, elle répondait « introuvable ».
  const { data: product, error: productError } = await productQuery.maybeSingle();
  if (productError) {
    throw new Error(`Lecture du produit impossible (products) : ${productError.message}`);
  }
  if (!product) {
    notFound();
  }

  // 3 lectures indépendantes (aucune ne dépend du résultat d'une autre, seulement de `id` déjà
  // connu) — lancées en parallèle plutôt qu'en séquence, même raisonnement documenté dans le
  // admin/products/[id]/edit/page.tsx voisin (5 lectures indépendantes, Promise.all).
  //
  // `.limit(1)` sur les propositions : rien en base n'empêche deux propositions en attente pour le
  // même produit, et `maybeSingle()` sur deux lignes est une ERREUR — qui, lue maintenant, ferait
  // échouer la page. On affiche la plus récente, ce que le tri voulait déjà dire.
  const [pendingResult, mediaResult, pendingPhotosResult] =
    await Promise.all([
      supabase
        .from("product_proposals")
        .select("id, payload, created_at")
        .eq("product_id", id)
        .eq("status", "pending")
        .eq("kind", "content")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("product_media")
        .select("id, storage_path")
        .eq("product_id", id)
        .order("sort", { ascending: true }),
      supabase
        .from("product_proposals")
        .select("payload")
        .eq("product_id", id)
        .eq("status", "pending")
        .eq("kind", "photos")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
  for (const [table, result] of [
    ["product_proposals", pendingResult],
    ["product_media", mediaResult],
    ["product_proposals", pendingPhotosResult],
  ] as const) {
    if (result.error) {
      throw new Error(`Lecture de la fiche impossible (${table}) : ${result.error.message}`);
    }
  }
  const pendingProposal = pendingResult.data;
  const media = mediaResult.data;
  const pendingPhotosProposal = pendingPhotosResult.data;

  const photos = (media ?? []).map((m) => ({
    id: m.id,
    url: supabase.storage.from("catalog-media").getPublicUrl(m.storage_path).data.publicUrl,
  }));

  // Aperçu réel des photos proposées, pas seulement leur nombre : le socio doit voir CE qu'il a
  // envoyé, pas juste un compteur (retour Jérôme 2026-08-17 — le module de photos n'affichait rien
  // après l'ajout).
  const pendingPhotos = (
    (pendingPhotosProposal?.payload as { photos?: { storage_path?: string }[] } | null)?.photos ?? []
  )
    .map((p) => p?.storage_path)
    .filter((path): path is string => Boolean(path))
    .map((path) => supabase.storage.from("catalog-media").getPublicUrl(path).data.publicUrl);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Proponer edición — {resolveLocalizedField(asLocalizedField(product.name), "es") ?? product.id}
      </h1>

      <PhotosSocioBlock
        entityType="product"
        entityId={product.id}
        uploadEndpoint="/api/upload/product"
        submitRpc="submit_photos_proposal"
        deleteTable="product_media"
        notFoundLabel="No se encontró la actividad."
        initialPhotos={photos}
        initialPendingPhotos={pendingPhotos}
      />

      <EditProposalForm
        productId={product.id}
        type={product.type as ProductType}
        currentPayload={product}
        pendingProposal={pendingProposal}
        establishmentId={product.establishment_id}
        establishmentLobbyConnected={Boolean(
          product.establishment?.lobby_connector_active && product.establishment?.lobby_has_token
        )}
      />
    </div>
  );
}
