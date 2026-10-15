import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { requireUuidParam } from "@/lib/routing/requireUuidParam";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { buttonVariants } from "@hifago/ui";
import { ProductForm } from "@/components/product-form";
import { PRODUCT_EDIT_COLUMNS } from "@/lib/products/productEditColumns";
// Correctif (spec 21, bug pré-existant sans lien avec elle) : jamais importer productTypeGating/
// availabilityScreenFor depuis useProductTypeFieldsState.ts ("use client") depuis un Server
// Component — cf. apps/admin/lib/products/productTypeGating.ts pour l'explication complète.
import {
  productTypeGating,
  availabilityScreenFor,
  type ProductType,
} from "@/lib/products/productTypeGating";
import type { DraftSlotRule } from "@/lib/products/slotRules";
import { ProductStatusBlock } from "./ProductStatusBlock";
import { ProductPhotosBlock } from "./ProductPhotosBlock";
import { ImportLobbyPhotosBlock } from "./ImportLobbyPhotosBlock";
import { ProductTagsBlock } from "./ProductTagsBlock";
import { ProductAmenitiesBlock } from "./ProductAmenitiesBlock";
import { ProductSlotRulesBlock } from "./ProductSlotRulesBlock";

// "HH:MM:SS" (sérialisation Postgres d'une colonne time) → "HH:MM" (valeur attendue par
// <Input type="time">, cf. slot-rules-editor.tsx).
function toTimeInputValue(time: string): string {
  return time.slice(0, 5);
}

export default async function EditProductPage({
  params,
}: PageProps<"/admin/products/[id]/edit">) {
  const id = requireUuidParam((await params).id);
  const supabase = await createClient();

  // RLS (products_select_public) : l'admin voit aussi les activités non publiées.
  // Chaque lecture LÈVE sur une panne (lib/supabase/checkedRead.ts) : lue comme une absence, elle
  // répondait « introuvable », ou une fiche sans photos, catégories ni créneaux — qu'un
  // enregistrement aurait ensuite écrasés.
  const productResult = await supabase
    .from("products")
    .select(
      // Colonnes du formulaire : une seule liste pour les deux écrans d'édition, et la règle qui la
      // gouverne (lib/products/productEditColumns.ts). `category`/`sellable` ne servent qu'ici.
      `${PRODUCT_EDIT_COLUMNS}, category, sellable, establishment:establishments(lobby_connector_active, lobby_has_token)`,
    )
    .eq("id", id)
    .maybeSingle();
  const { data: productRow } = checkedRead(productResult, "products");

  if (!productRow) {
    notFound();
  }

  // Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — aplati ici (jamais transporté comme un
  // objet imbriqué jusqu'à ProductForm, qui attend ces deux champs directement sur EditableProduct).
  const product = {
    ...productRow,
    lobby_connector_active: productRow.establishment?.lobby_connector_active ?? false,
    lobby_has_token: productRow.establishment?.lobby_has_token ?? false,
  };

  // Spec 08/12/13 — tags : réservés au parcours partagé activité/alojamiento/hôtel (écran partagé
  // conservé, champ conditionnel). productTypeGating : SEULE définition de ces booléens dans tout
  // le projet (cf. apps/admin/lib/products/useProductTypeFieldsState.ts), partagée avec ProductForm
  // et ModerateProductCreationProposalForm.
  const { isActivity, isLodging, isTransport, hasTags, hasAmenities } = productTypeGating(
    product.type as ProductType,
  );
  // Refonte parcours produit ↔ LobbyPMS (2026-08-26) — même condition que product-type-fields.tsx/
  // product-form.tsx (cf. leurs commentaires), calculée ici depuis la valeur PERSISTÉE (Server
  // Component, pas de state React) plutôt que depuis un state client.
  const isRoomLinkedToLobby = isLodging && product.lobby_category_id != null;

  // 5 lectures indépendantes (aucune ne dépend du résultat d'une autre, seulement de product.id/
  // product.type déjà connus) — lancées en parallèle plutôt qu'en séquence, le TTFB de la page tombe
  // au max des 5 allers-retours Supabase au lieu de leur somme.
  const [
    mediaResult,
    tagsResult,
    assignmentsResult,
    amenitiesResult,
    amenityAssignmentsResult,
    slotRulesResult,
  ] = await Promise.all([
    supabase
      .from("product_media")
      .select("id, storage_path")
      .eq("product_id", product.id)
      .order("sort", { ascending: true }),
    hasTags
      ? supabase.from("catalog_tags").select("id, label").order("slug")
      : Promise.resolve({ data: [] as { id: string; label: unknown }[], error: null }),
    hasTags
      ? supabase.from("product_tag_assignments").select("tag_id").eq("product_id", product.id)
      : Promise.resolve({ data: [] as { tag_id: string }[], error: null }),
    // Équipements structurés (migration 20260917110000) — même patron que tags juste au-dessus,
    // table dédiée `catalog_amenities`, gating `hasAmenities` (lodging uniquement).
    hasAmenities
      ? supabase.from("catalog_amenities").select("id, label, category_key").order("category_key").order("sort_order")
      : Promise.resolve({ data: [] as { id: string; label: unknown; category_key: string }[], error: null }),
    hasAmenities
      ? supabase.from("product_amenity_assignments").select("amenity_id").eq("product_id", product.id)
      : Promise.resolve({ data: [] as { amenity_id: string }[], error: null }),
    // Spec 11 — règles de créneaux : réservées à "activity", même gating que tags/tramos.
    isActivity
      ? supabase
          .from("product_slot_rules")
          .select("weekdays, start_time, end_time, slot_duration_minutes, capacity")
          .eq("product_id", product.id)
          .order("start_time")
      : Promise.resolve({ data: [] as never[], error: null }),
  ]);
  const { data: media } = checkedRead(mediaResult, "product_media");
  const { data: tagsRaw } = checkedRead(tagsResult, "catalog_tags");
  const { data: assignments } = checkedRead(assignmentsResult, "product_tag_assignments");
  const { data: amenitiesRaw } = checkedRead(amenitiesResult, "catalog_amenities");
  const { data: amenityAssignments } = checkedRead(amenityAssignmentsResult, "product_amenity_assignments");
  const { data: slotRulesRaw } = checkedRead(slotRulesResult, "product_slot_rules");

  // Spec 17 §0 Tranche 0 (générique) + Spec 18 Tranche 1 (créneaux) — SEULE définition de ce
  // gating avec ProductsGrid.tsx (apps/admin/app/partner/(app)/products/ProductsGrid.tsx), via
  // availabilityScreenFor (apps/admin/lib/products/useProductTypeFieldsState.ts).
  const availabilityScreen = availabilityScreenFor(
    product.type as ProductType,
    (slotRulesRaw ?? []).length > 0,
    isRoomLinkedToLobby,
    product.evento_capacity_mode as "unlimited" | "metered" | "rsvp" | null,
  );

  const photos = (media ?? []).map((m) => ({
    id: m.id,
    url: supabase.storage.from("catalog-media").getPublicUrl(m.storage_path).data.publicUrl,
  }));

  const allTags = (tagsRaw ?? []).map((tag) => ({
    id: tag.id,
    label: resolveLocalizedField(asLocalizedField(tag.label), "es") ?? tag.id,
  }));
  const initialTagIds = (assignments ?? []).map((a) => a.tag_id);

  const allAmenities = (amenitiesRaw ?? []).map((amenity) => ({
    id: amenity.id,
    label: resolveLocalizedField(asLocalizedField(amenity.label), "es") ?? amenity.id,
  }));
  const initialAmenityIds = (amenityAssignments ?? []).map((a) => a.amenity_id);

  const initialSlotRules: DraftSlotRule[] = (slotRulesRaw ?? []).map((rule) => ({
    weekdays: rule.weekdays,
    startTime: toTimeInputValue(rule.start_time),
    endTime: toTimeInputValue(rule.end_time),
    slotDurationMinutes: String(rule.slot_duration_minutes),
    capacity: String(rule.capacity),
  }));


  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="titre-page">
          {isLodging
            ? "Editar alojamiento"
              : isTransport
                ? "Editar transporte"
                : "Editar actividad"}
        </h1>
        {availabilityScreen === "generic" || availabilityScreen === "slot" ? (
          <Link
            href={`/admin/products/${product.id}/availability`}
            className={buttonVariants({ variant: "outline" })}
          >
            Calendario &amp; cupos
          </Link>
        ) : null}
        {/* Dire pourquoi il n'y a pas de calendrier, plutôt que de laisser un vide inexpliqué. */}
        {availabilityScreen === "pms" ? (
          <p className="text-sm text-muted" data-testid="availability-managed-by-pms">
            La disponibilidad se gestiona en LobbyPMS.
          </p>
        ) : null}
        {/* Spec 18 Tranche 1 — même raisonnement : product_availability ne représente pas la
            capacité par créneau horaire d'une activité qui porte des product_slot_rules (ex.
            jetski) ; grille dédiée horaires×dates, affichée seulement si au moins une règle existe.
            Vient TOUJOURS avec le lien générique ci-dessus (availabilityScreenFor 'slot' n'exclut
            pas 'generic', cf. son commentaire), jamais à sa place. */}
        {availabilityScreen === "slot" ? (
          <Link
            href={`/admin/products/${product.id}/slot-availability`}
            className={buttonVariants({ variant: "outline" })}
          >
            Cupos por horario
          </Link>
        ) : null}
      </div>
      {/* Bloc Statut séparé du formulaire d'édition — action distincte (feature 4), pas un champ
          de plus dans le même submit. */}
      <ProductStatusBlock productId={product.id} initialSellable={product.sellable} />
      {hasTags ? (
        <ProductTagsBlock productId={product.id} allTags={allTags} initialTagIds={initialTagIds} />
      ) : null}
      {hasAmenities ? (
        <ProductAmenitiesBlock
          productId={product.id}
          allAmenities={allAmenities}
          initialAmenityIds={initialAmenityIds}
        />
      ) : null}
      {/* Démasqué le 2026-08-26 (arbitrage « import à la liaison »). Ce bloc était retiré pour une
          chambre liée à Lobby : combiné au fait que rien n'importait jamais photos[], une chambre
          PMS-backed ne pouvait structurellement avoir AUCUNE photo, ni locale ni importée — sa
          carte de catalogue public s'affichait donc sans image. L'import depuis Lobby est le bloc
          juste en dessous (admin-only). */}
      <ProductPhotosBlock productId={product.id} initialPhotos={photos} />
      {isRoomLinkedToLobby ? <ImportLobbyPhotosBlock productId={product.id} /> : null}
      {isActivity ? (
        <ProductSlotRulesBlock productId={product.id} initialRules={initialSlotRules} />
      ) : null}
      <ProductForm product={product} />
    </div>
  );
}
