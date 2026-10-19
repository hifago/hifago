"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { Button, buttonVariants, toast } from "@hifago/ui";
import { CatalogCard } from "@/components/catalog-card";

const WITHDRAW_ERRORS: Record<string, string> = {
  proposal_not_found: "No se encontró la propuesta.",
  not_pending: "Esta propuesta ya fue procesada.",
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
};

type PendingCreation = { id: string; payload: unknown; created_at: string };

// Rendu en CatalogCard comme le reste de /partner/establishment (retour Jérôme : une proposition
// en attente reste une carte normale, seul le tag de statut la distingue) — jamais deux tags
// empilés, "Pendiente de revisión" REMPLACE le tag activo/archivado qui n'existe pas encore ici.
// layout="horizontal", rendue seule (jamais dans CatalogCardGrid) : même traitement pleine largeur
// qu'un établissement déjà approuvé (EstablishmentStack.tsx) — un établissement en attente ne doit
// jamais retomber sur l'ancienne mise en page en grille (retour Jérôme, 2026-08-19).
export function PendingCreationBanner({ proposal: initialProposal }: { proposal: PendingCreation }) {
  const [proposal, setProposal] = useState<PendingCreation | null>(initialProposal);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const router = useRouter();

  async function handleWithdraw() {
    if (!proposal) return;
    setIsWithdrawing(true);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("withdraw_establishment_proposal", {
      p_proposal_id: proposal.id,
    });

    setIsWithdrawing(false);

    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      toast.danger(
        WITHDRAW_ERRORS[result?.reason ?? ""] ?? "No se pudo retirar la propuesta. Inténtalo de nuevo.",
      );
      return;
    }

    setProposal(null);
    toast.success("Propuesta retirada.");
    // Le retrait emporte les activités proposées avec cet établissement (20261019120000) : la page
    // les rend sous cette carte, elle doit être relue.
    router.refresh();
  }

  if (!proposal) return null;

  const payload = proposal.payload as { name?: unknown; photos?: { storage_path: string }[] };
  const proposedName = resolveLocalizedField(asLocalizedField(payload?.name), "es");
  const supabase = createClient();
  const photos = (payload?.photos ?? []).map((photo, index) => ({
    id: `${proposal.id}-${index}`,
    url: supabase.storage.from("catalog-media").getPublicUrl(photo.storage_path).data.publicUrl,
    alt: proposedName ?? proposal.id,
  }));

  return (
    <CatalogCard
      testId="pending-creation-banner"
      layout="horizontal"
      photos={photos}
      title={proposedName ?? proposal.id}
      statusChips={[{ label: "Pendiente de revisión", color: "warning" }]}
      footer={
        <>
          <Link
            href={`/partner/products/new?establecimiento=${proposal.id}`}
            className={buttonVariants({ size: "sm" })}
            data-testid={`add-activity-to-pending-${proposal.id}`}
          >
            Añadir servicio
          </Link>
          <Button
            type="button"
            variant="outline"
            size="sm"
            isDisabled={isWithdrawing}
            onPress={handleWithdraw}
            data-testid="withdraw-creation-proposal-button"
          >
            {isWithdrawing ? "Retirando…" : "Retirar"}
          </Button>
        </>
      }
    />
  );
}
