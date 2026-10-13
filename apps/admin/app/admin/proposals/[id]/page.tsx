import type { ProductType } from "@/lib/products/productTypeGating";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { requireUuidParam } from "@/lib/routing/requireUuidParam";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { toTagOptions } from "@/lib/tags/proposedTags";
import { ModerateProposalForm } from "./ModerateProposalForm";
import { PhotoModerationForm } from "./PhotoModerationForm";
import { ModerateProductCreationProposalForm } from "./ModerateProductCreationProposalForm";
import { ModerateEstablishmentProposalForm } from "./ModerateEstablishmentProposalForm";

export default async function AdminProposalDetailPage({
  params,
  searchParams,
}: PageProps<"/admin/proposals/[id]">) {
  const id = requireUuidParam((await params).id);
  const resolvedSearchParams = await searchParams;
  const isEstablishment = resolvedSearchParams?.entity === "establishment";
  const supabase = await createClient();

  if (isEstablishment) {
    return <AdminEstablishmentProposalDetail id={id} />;
  }

  // product_proposals_select_admin (feature 15) : l'admin voit n'importe quelle proposition,
  // quel que soit le partenaire ou le statut. kind ajouté par la spec 04 (gestion des images) —
  // distingue une proposition de contenu (ce composant) d'une proposition "photos seules"
  // (PhotoModerationForm), jamais mélangées dans le même écran. establishment_id/type
  // ajoutés par la spec 15 (product_id NULL tant qu'une proposition kind='create' n'est pas
  // approuvée — product:products(...) ressort alors null, cf. garde ci-dessous).
  // Colonnes de products étendues (spec 15 bis, 2026-08-17) : parité de champs avec
  // ProductForm/ProductTypeFields côté "Valor actual" de ModerateProposalForm (branche content).
  const { data: proposal } = checkedRead(
    await supabase
      .from("product_proposals")
      .select(
        "id, status, version, payload, kind, type, establishment_id, rejection_reason, product:products(id, type, name, description, address, lat, lon, price_cop, price_tiers, min_qty, max_qty, check_in_time, check_out_time, capacity, unit_count, lodging_kind, unit, default_capacity, stay_rates, transport_first_departure_time, transport_last_departure_time, transport_seats_per_departure, transport_departure_address, transport_departure_lat, transport_departure_lon, transport_arrival_address, transport_arrival_lat, transport_arrival_lon, transport_contact_phone, program, duration_days), establishment:establishments(id, name, lobby_connector_active, lobby_has_token), partner:partners(display_name)"
      )
      .eq("id", id)
      .maybeSingle(),
    "product_proposals",
  );

  // Contrairement à avant la spec 15 : `!proposal.product` n'est plus un cas d'erreur, c'est
  // l'état normal d'une proposition kind='create' encore pending — seule l'absence de la
  // proposition elle-même est un vrai 404 (même garde que la branche établissement ci-dessous,
  // où establishment_id est nullable pour la même raison depuis 20260815170000).
  if (!proposal) {
    notFound();
  }

  const isPhotos = proposal.kind === "photos";
  const isCreate = proposal.kind === "create";

  if (isCreate) {
    const proposedName = resolveLocalizedField(
      asLocalizedField((proposal.payload as { name?: unknown } | null)?.name),
      "es",
    );
    const establishmentName = proposal.establishment
      ? (resolveLocalizedField(asLocalizedField(proposal.establishment.name), "es") ?? proposal.establishment.id)
      : "—";

    const { data: tagsRaw } = checkedRead(
      await supabase.from("catalog_tags").select("id, label").order("slug"),
      "catalog_tags",
    );
    const availableTags = (tagsRaw ?? []).map((tag) => ({
      id: tag.id,
      label: resolveLocalizedField(asLocalizedField(tag.label), "es") ?? tag.id,
    }));
    // Équipements proposés avec un logement (migration 20261013151206).
    const { data: amenitiesRaw } = checkedRead(
      await supabase.from("catalog_amenities").select("id, label").order("category_key").order("sort_order"),
      "catalog_amenities",
    );

    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">
          Revisar propuesta de creación — {proposedName ?? "nueva ficha"}
        </h1>
        <p className="text-sm text-muted">
          Partner: {proposal.partner?.display_name ?? "—"} · Establecimiento: {establishmentName}
        </p>

        {proposal.status !== "pending" ? (
          <p role="status" data-testid="proposal-not-pending" className="text-sm text-muted">
            Esta propuesta ya no está pendiente (estado: {proposal.status}).
          </p>
        ) : (
          <ModerateProductCreationProposalForm
            proposalId={proposal.id}
            expectedVersion={proposal.version}
            type={proposal.type as ProductType}
            payload={proposal.payload}
            availableTags={availableTags}
            availableAmenities={toTagOptions(amenitiesRaw)}
            establishmentId={proposal.establishment_id ?? ""}
            establishmentLobbyConnected={Boolean(
              proposal.establishment?.lobby_connector_active && proposal.establishment?.lobby_has_token
            )}
          />
        )}
      </div>
    );
  }

  // À partir d'ici (kind='content'/'photos'), product_id est toujours renseigné (contrainte
  // product_proposals_scope) : proposal.product ne peut être null que si le produit a été
  // supprimé entre-temps (delete_product) — cas résiduel déjà géré ainsi avant la spec 15.
  if (!proposal.product) {
    notFound();
  }

  // Étiquettes (migration 20261013144848) — une proposition de contenu peut désormais en changer :
  // le modérateur compare celles en place à celles proposées, comme pour tout autre champ.
  const { data: tagsRaw } = checkedRead(
    await supabase.from("catalog_tags").select("id, label").order("slug"),
    "catalog_tags",
  );
  const { data: tagAssignments } = checkedRead(
    await supabase.from("product_tag_assignments").select("tag_id").eq("product_id", proposal.product.id),
    "product_tag_assignments",
  );
  // Équipements d'un logement (migration 20261013151206) — même comparaison en place / proposé.
  const { data: amenitiesRaw } = checkedRead(
    await supabase.from("catalog_amenities").select("id, label").order("category_key").order("sort_order"),
    "catalog_amenities",
  );
  const { data: amenityAssignments } = checkedRead(
    await supabase
      .from("product_amenity_assignments")
      .select("amenity_id")
      .eq("product_id", proposal.product.id),
    "product_amenity_assignments",
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Revisar propuesta{isPhotos ? " de fotos" : ""} —{" "}
        {resolveLocalizedField(asLocalizedField(proposal.product.name), "es") ?? proposal.product.id}
      </h1>
      <p className="text-sm text-muted">
        Partner: {proposal.partner?.display_name ?? "—"}
      </p>

      {proposal.status !== "pending" ? (
        <p role="status" data-testid="proposal-not-pending" className="text-sm text-muted">
          Esta propuesta ya no está pendiente (estado: {proposal.status}).
        </p>
      ) : isPhotos ? (
        <PhotoModerationForm
          proposalId={proposal.id}
          expectedVersion={proposal.version}
          rpcName="moderate_product_proposal"
          proposedPhotoPaths={
            ((proposal.payload as { photos?: { storage_path: string }[] })?.photos ?? []).map(
              (p) => p.storage_path
            )
          }
        />
      ) : (
        <ModerateProposalForm
          proposalId={proposal.id}
          expectedVersion={proposal.version}
          type={proposal.product.type as ProductType}
          currentPayload={proposal.product}
          proposedPayload={proposal.payload as Record<string, unknown>}
          availableTags={toTagOptions(tagsRaw)}
          currentTagIds={(tagAssignments ?? []).map((row) => row.tag_id)}
          availableAmenities={toTagOptions(amenitiesRaw)}
          currentAmenityIds={(amenityAssignments ?? []).map((row) => row.amenity_id)}
        />
      )}
    </div>
  );
}

// docs/specs/06-gestion-etablissement.md §5.3 — branche établissement de l'écran de modération,
// routée par ?entity=establishment (ProposalsTable) plutôt qu'une seconde route dédiée : même
// pattern déjà en place pour kind='photos' vs 'content', une simple branche de rendu, pas un
// second écran à maintenir en parallèle.
async function AdminEstablishmentProposalDetail({ id }: { id: string }) {
  const supabase = await createClient();

  const { data: proposal } = checkedRead(
    await supabase
      .from("establishment_proposals")
      .select(
        "id, status, version, payload, kind, rejection_reason, establishment:establishments(id, name, description, address, lat, lon), partner:partners(display_name)"
      )
      .eq("id", id)
      .maybeSingle(),
    "establishment_proposals",
  );

  if (!proposal) {
    notFound();
  }

  const proposedPayload = proposal.payload as {
    name?: unknown;
    description?: unknown;
    address?: string | null;
    lat?: number | null;
    lon?: number | null;
    photos?: { storage_path: string }[];
    tag_ids?: unknown;
  };

  // Étiquettes (migration 20261013144848) — édition seulement : une proposition de création n'en
  // porte pas, et l'établissement n'existe pas encore.
  const { data: tagsRaw } = checkedRead(
    await supabase.from("catalog_tags").select("id, label").order("slug"),
    "catalog_tags",
  );
  const establishmentId = proposal.establishment?.id;
  const { data: tagAssignments } = establishmentId
    ? checkedRead(
        await supabase
          .from("establishment_tag_assignments")
          .select("tag_id")
          .eq("establishment_id", establishmentId),
        "establishment_tag_assignments",
      )
    : { data: [] as { tag_id: string }[] };

  const currentName = proposal.establishment
    ? (resolveLocalizedField(asLocalizedField(proposal.establishment.name), "es") ?? proposal.establishment.id)
    : null;
  const proposedName = resolveLocalizedField(asLocalizedField(proposedPayload.name), "es");
  const isPhotos = proposal.kind === "photos";
  const kindLabel = isPhotos ? "fotos" : proposal.kind === "create" ? "creación" : "edición";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Revisar propuesta de {kindLabel} — {currentName ?? proposedName ?? proposal.id}
      </h1>
      <p className="text-sm text-muted">Partner: {proposal.partner?.display_name ?? "—"}</p>

      {proposal.status !== "pending" ? (
        <p role="status" data-testid="proposal-not-pending" className="text-sm text-muted">
          Esta propuesta ya no está pendiente (estado: {proposal.status}).
        </p>
      ) : isPhotos ? (
        <PhotoModerationForm
          proposalId={proposal.id}
          expectedVersion={proposal.version}
          rpcName="moderate_establishment_proposal"
          proposedPhotoPaths={
            ((proposal.payload as { photos?: { storage_path: string }[] })?.photos ?? []).map(
              (p) => p.storage_path
            )
          }
        />
      ) : (
        <ModerateEstablishmentProposalForm
          proposalId={proposal.id}
          expectedVersion={proposal.version}
          kind={proposal.kind as "create" | "edit"}
          currentPayload={proposal.establishment}
          proposedPayload={proposedPayload}
          availableTags={toTagOptions(tagsRaw)}
          currentTagIds={(tagAssignments ?? []).map((row) => row.tag_id)}
        />
      )}
    </div>
  );
}
