import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { ProductForm } from "@/components/product-form";
import { RejectionNotice } from "@/components/rejection-notice";
import type { TagOption } from "@/components/tags-multiselect";
import type { ProductType } from "@/lib/products/useProductTypeFieldsState";

type RejectedCreationRow = {
  id: string;
  type: string | null;
  payload: unknown;
  rejection_reason: string | null;
  establishment_id: string | null;
  establishment_proposal: { id: string; status: string; payload: unknown; establishment_id: string | null } | null;
};

// Migration 20261104130000 — corriger une proposition de service refusée : le même formulaire
// (ProductForm, variant socio-proposal), rempli de ce que contenait la proposition. Établissement
// et type sont figés ; submit_product_creation_proposal(p_proposal_id) relit la cible elle-même.
export async function CorrectionPage({
  proposalId,
  allTags,
  allAmenities,
}: {
  proposalId: string;
  allTags: TagOption[];
  allAmenities: TagOption[];
}) {
  const supabase = await createClient();

  // RLS : un partenaire ne lit que ses propres propositions — introuvable = pas la sienne.
  const { data: proposal } = checkedRead(
    await supabase
      .from("product_proposals")
      .select(
        "id, type, payload, rejection_reason, establishment_id, establishment_proposal:establishment_proposals(id, status, payload, establishment_id)",
      )
      .eq("id", proposalId)
      .eq("kind", "create")
      .eq("status", "rejected")
      .maybeSingle<RejectedCreationRow>(),
    "product_proposals",
  );
  if (!proposal || !proposal.type) {
    redirect("/partner/establishment");
  }

  const establishmentProposal = proposal.establishment_proposal;
  const establishmentId =
    proposal.establishment_id ??
    (establishmentProposal?.status === "approved" ? establishmentProposal.establishment_id : null);

  const { data: establishment } = checkedRead(
    establishmentId
      ? await supabase
          .from("establishments")
          .select("id, name, partner_id, lobby_connector_active, lobby_has_token")
          .eq("id", establishmentId)
          .maybeSingle()
      : { data: null, error: null },
    "establishments",
  );

  const header = (
    <>
      <h1 className="titre-page">Corregir tu propuesta de servicio</h1>
      <RejectionNotice title="Un administrador rechazó esta propuesta" reason={proposal.rejection_reason}>
        Cambia solo lo que no estaba bien y vuelve a enviarla: todo lo demás ya está guardado.
      </RejectionNotice>
    </>
  );

  // Établissement encore refusé : la RPC refuserait l'envoi (establishment_proposal_not_pending).
  if (!establishment && establishmentProposal?.status !== "pending") {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <p className="text-sm text-muted" data-testid="correction-establishment-rejected">
          Esta propuesta depende de un establecimiento que también fue rechazado. Corrige primero el
          establecimiento: al enviarlo de nuevo, los servicios rechazados con él vuelven a revisión.
        </p>
        <Link href="/partner/establishment" className="text-sm underline">
          Ir a mis establecimientos
        </Link>
      </div>
    );
  }

  const establishmentOption = establishment
    ? establishment
    : {
        id: establishmentProposal!.id,
        // Le champ multilingue brut, comme products/new/page.tsx : ProductForm le résout lui-même.
        name: (establishmentProposal!.payload as { name?: unknown } | null)?.name ?? null,
        partner_id: "",
        pending_proposal: true,
      };

  return (
    <div className="flex flex-col gap-6">
      {header}
      <ProductForm
        establishments={[establishmentOption]}
        initialEstablishmentId={establishmentOption.id}
        allTags={allTags}
        allAmenities={allAmenities}
        variant="socio-proposal"
        correction={{ proposalId: proposal.id, type: proposal.type as ProductType, payload: proposal.payload }}
      />
    </div>
  );
}
