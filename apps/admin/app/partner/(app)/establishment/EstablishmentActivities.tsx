"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@hifago/supabase/client";
import { asLocalizedField, resolveLocalizedField, formatCop } from "@hifago/domain";
import { Button, buttonVariants, toast } from "@hifago/ui";
import { CatalogCard, CatalogCardGrid, type CatalogCardStatus } from "@/components/catalog-card";
import { EmptyStateCta } from "@/components/EmptyStateCta";
import { availabilityScreenFor, type ProductType } from "@/lib/products/useProductTypeFieldsState";

export type ProductCardRow = {
  id: string;
  type: string;
  name: string;
  priceCop: number | null;
  sellable: boolean;
  tags: string[];
  photos: { id: string; url: string; alt: string }[];
  pendingEdit: boolean;
  hasSlotRules: boolean;
  // Ajouté le 2026-08-26 avec availabilityScreenFor(…, isPmsBacked) : le portail socio doit savoir
  // qu'un logement est adossé à LobbyPMS, sinon il continue de proposer un calendrier de cupos
  // structurellement vide (create_order ne décrémente jamais product_availability pour ces lignes).
  isPmsBacked: boolean;
  // Ajouté le 2026-09-15 avec availabilityScreenFor(…, eventoCapacityMode) : sans lui, un evento
  // 'metered' n'affichait aucun lien « Calendario & cupos » côté socio alors que l'admin en
  // affichait un, pour le même produit.
  eventoCapacityMode: "unlimited" | "metered" | "rsvp" | null;
};

export type PendingProductCreationRow = {
  id: string;
  type: string | null;
  payload: unknown;
  created_at: string;
};

const WITHDRAW_ERRORS: Record<string, string> = {
  proposal_not_found: "No se encontró la propuesta.",
  not_pending: "Esta propuesta ya fue procesada.",
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
};

const TYPE_LABELS: Record<string, string> = {
  activity: "Actividad",
  evento: "Evento",
  camp: "Campamento",
  lodging: "Alojamiento",
  transport: "Transporte",
};

// Ordre d'affichage des sections sous un établissement. Un type absent de cette liste (ou une
// proposition sans type) tombe dans OTHER_SECTION plutôt que de disparaître de l'écran.
const TYPE_SECTIONS: { type: string; label: string }[] = [
  { type: "activity", label: "Actividades" },
  { type: "lodging", label: "Alojamientos" },
  { type: "evento", label: "Eventos" },
  { type: "camp", label: "Campamentos" },
  { type: "transport", label: "Transporte" },
];
const OTHER_SECTION = { type: "other", label: "Otros" };
const KNOWN_TYPES = new Set(TYPE_SECTIONS.map((section) => section.type));

function sectionTypeOf(type: string | null): string {
  return type && KNOWN_TYPES.has(type) ? type : OTHER_SECTION.type;
}

// Fusion de ProductsGrid.tsx + PendingProductCreationsList.tsx (refonte vue prestataire,
// 2026-08-19) — propositions de création ET produits publiés mélangés dans la même grille, chacun
// avec son propre tag de statut ("Pendiente de revisión" pour une proposition, "Publicada"/"No
// publicada" sinon) : demande explicite de Jérôme, jamais deux listes séparées par STATUT ("ça doit
// être dans la vue juste avec un tag bien évident de l'état de l'activité").
// Depuis le 2026-10-12 (demande Jérôme : « séparés, et non pas tout mélanger »), une section
// titrée par TYPE — activités, logements, événements, camps, transport — au lieu d'une seule grille
// « Actividades » qui mélangeait tout. Une section sans rien à montrer n'est pas rendue.
export function EstablishmentActivities({
  establishmentId,
  products,
  pendingCreations: initialPendingCreations,
}: {
  establishmentId: string;
  products: ProductCardRow[];
  pendingCreations: PendingProductCreationRow[];
}) {
  const [pendingCreations, setPendingCreations] = useState(initialPendingCreations);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  // Un seul client, réutilisé pour la soumission et pour résoudre l'URL publique de chaque photo
  // proposée — même optimisation que PendingProductCreationsList.tsx (évite un createClient() par
  // photo à chaque rendu).
  const supabase = createClient();

  async function handleWithdraw(proposalId: string) {
    setWithdrawingId(proposalId);

    const { data, error: rpcError } = await supabase.rpc("withdraw_product_proposal", {
      p_proposal_id: proposalId,
    });

    setWithdrawingId(null);

    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      toast.danger(
        WITHDRAW_ERRORS[result?.reason ?? ""] ?? "No se pudo retirar la propuesta. Inténtalo de nuevo."
      );
      return;
    }

    setPendingCreations((prev) => prev.filter((p) => p.id !== proposalId));
    toast.success("Propuesta retirada.");
  }

  if (products.length === 0 && pendingCreations.length === 0) {
    return (
      <EmptyStateCta
        title="Aún no tienes servicios en este establecimiento"
        description="Añade tu primer servicio para empezar a recibir reservas."
        // `establishmentId` est celui d'une PROPOSITION d'établissement quand la pile en revue
        // réutilise ce composant (20261019120000) : la page /new accepte les deux.
        actionHref={`/partner/products/new?establecimiento=${establishmentId}`}
        actionLabel="Añadir servicio"
        testId={`empty-activities-${establishmentId}`}
      />
    );
  }

  const sections = [...TYPE_SECTIONS, OTHER_SECTION]
    .map((section) => ({
      ...section,
      pendingCreations: pendingCreations.filter((p) => sectionTypeOf(p.type) === section.type),
      products: products.filter((p) => sectionTypeOf(p.type) === section.type),
    }))
    .filter((section) => section.pendingCreations.length > 0 || section.products.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => (
        <section
          key={section.type}
          className="flex flex-col gap-3"
          data-testid={`product-section-${establishmentId}-${section.type}`}
        >
          <h2 className="text-base font-semibold text-muted">{section.label}</h2>
          <CatalogCardGrid>
            {section.pendingCreations.map((proposal) => {
              const payload = (proposal.payload ?? {}) as {
                name?: unknown;
                photos?: { storage_path: string }[];
              };
              const proposedName = resolveLocalizedField(asLocalizedField(payload.name), "es");
              const photos = (Array.isArray(payload.photos) ? payload.photos : []).map((photo, index) => ({
                id: `${proposal.id}-${index}`,
                url: supabase.storage.from("catalog-media").getPublicUrl(photo.storage_path).data.publicUrl,
                alt: proposedName ?? proposal.id,
              }));

              return (
                <CatalogCard
                  key={proposal.id}
                  testId={`pending-product-creation-${proposal.id}`}
                  photos={photos}
                  title={proposedName ?? proposal.id}
                  meta={TYPE_LABELS[proposal.type ?? ""] ?? proposal.type ?? undefined}
                  statusChips={[{ label: "Pendiente de revisión", color: "warning" }]}
                  footer={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      isDisabled={withdrawingId === proposal.id}
                      onPress={() => handleWithdraw(proposal.id)}
                      data-testid={`withdraw-product-creation-${proposal.id}`}
                    >
                      {withdrawingId === proposal.id ? "Retirando…" : "Retirar"}
                    </Button>
                  }
                />
              );
            })}

            {section.products.map((product) => {
              // Un tag de statut à la fois, jamais deux empilés : "en révision" prend le pas sur
              // publié/brouillon plutôt que s'y ajouter — pattern déjà en place (ProductsGrid.tsx),
              // repris tel quel.
              const statusChips: CatalogCardStatus[] = product.pendingEdit
                ? [{ label: "Edición pendiente de revisión", color: "warning" }]
                : [
                    product.sellable
                      ? { label: "Publicada", color: "success" }
                      : { label: "No publicada", color: "default" },
                  ];

              // Repérer d'un coup d'œil ce qui est adossé au PMS : rien ne le signalait nulle part, alors
              // que ça change le comportement réel du produit (disponibilité lue chez Lobby, cupos
              // internes inertes). Posé dans les chips déjà existants plutôt qu'en modifiant CatalogCard.
              const chips: CatalogCardStatus[] = product.isPmsBacked
                ? [...statusChips, { label: "LobbyPMS", color: "default" }]
                : statusChips;

              const availabilityScreen = availabilityScreenFor(
                product.type as ProductType,
                product.hasSlotRules,
                product.isPmsBacked,
                product.eventoCapacityMode,
              );

              return (
                <CatalogCard
                  key={product.id}
                  testId={`product-row-${product.id}`}
                  photos={product.photos}
                  title={product.name}
                  tags={product.tags}
                  statusChips={chips}
                  meta={product.priceCop === null ? undefined : formatCop(product.priceCop)}
                  footer={
                    <>
                      <Link
                        href={`/partner/products/${product.id}/edit`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                        data-testid={`edit-link-${product.id}`}
                      >
                        Proponer edición
                      </Link>
                      {availabilityScreen === "generic" || availabilityScreen === "slot" ? (
                        <Link
                          href={`/partner/products/${product.id}/availability`}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                          data-testid={`availability-link-${product.id}`}
                        >
                          Calendario
                        </Link>
                      ) : null}
                      {availabilityScreen === "slot" ? (
                        <Link
                          href={`/partner/products/${product.id}/slot-availability`}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                          data-testid={`slot-availability-link-${product.id}`}
                        >
                          Cupos por horario
                        </Link>
                      ) : null}
                    </>
                  }
                />
              );
            })}
          </CatalogCardGrid>
        </section>
      ))}
    </div>
  );
}
