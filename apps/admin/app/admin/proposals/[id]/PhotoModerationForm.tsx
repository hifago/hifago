"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Label, TextArea, cn, toast } from "@hifago/ui";

const MODERATE_ERRORS: Record<string, string> = {
  proposal_not_found: "No se encontró la propuesta.",
  version_conflict: "Esta propuesta fue modificada por otra persona. Recarga la página.",
};

// Contrôle flottant posé sur la vignette elle-même : jamais le Button HeroUI "outline" du thème
// admin (--border-width: 0, il devient invisible posé sur une photo dont le contenu est
// imprévisible — photo proposée par un partenaire, non maîtrisée) — un scrim sombre fixe reste
// lisible quelle que soit la photo derrière. Même constante que packages/ui/src/components/
// media-gallery.tsx.
const overlayButtonClass =
  "flex h-7 w-7 items-center justify-center bg-black/55 text-sm leading-none text-white transition-colors hover:bg-black/70 disabled:pointer-events-none disabled:opacity-40";

type ModerateResult = { ok: boolean; reason?: string; status?: string; reviewed_by_email?: string };

// Factorise ModeratePhotosProposalForm.tsx (produits) / ModerateEstablishmentPhotosProposalForm.tsx
// (établissements) — byte-for-byte identiques hormis le nom de la RPC appelée, dont la signature
// (p_proposal_id/p_decision/p_expected_version/p_corrected_payload/p_rejection_reason) est
// partagée par moderate_product_proposal ET moderate_establishment_proposal. Aperçu isolé (décision
// explicite avec Jérôme, 2026-08-14, docs/specs/04-gestion-images.md §3) — pas une vraie page client
// en mode preview : ce composant rejoue juste les photos proposées, confiné à apps/admin.
// L'approbation n'ajoute QUE les images (branche kind='photos'), jamais un champ de contenu, même
// si l'admin retire une photo de la sélection avant d'approuver.
export function PhotoModerationForm({
  proposalId,
  expectedVersion,
  rpcName,
  proposedPhotoPaths,
}: {
  proposalId: string;
  expectedVersion: number;
  rpcName: "moderate_product_proposal" | "moderate_establishment_proposal";
  proposedPhotoPaths: string[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [selectedPaths, setSelectedPaths] = useState(proposedPhotoPaths);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function removeFromSelection(path: string) {
    setSelectedPaths((prev) => prev.filter((p) => p !== path));
  }

  async function handleDecision(decision: "approve" | "reject") {
    if (decision === "approve" && selectedPaths.length === 0) {
      toast.danger("Selecciona al menos una foto, o rechaza la propuesta.");
      return;
    }
    if (decision === "reject" && !rejectionReason.trim()) {
      toast.danger("El motivo es obligatorio para rechazar.");
      return;
    }

    setIsSubmitting(true);
    const { data, error: rpcError } = await supabase.rpc(rpcName, {
      p_proposal_id: proposalId,
      p_decision: decision,
      p_expected_version: expectedVersion,
      p_corrected_payload:
        decision === "approve" ? { photos: selectedPaths.map((storage_path) => ({ storage_path })) } : null,
      p_rejection_reason: decision === "reject" ? rejectionReason.trim() : undefined,
    });
    const result = data as ModerateResult | null;
    if (rpcError || !result?.ok) {
      // Échec seulement : sur un succès, le bouton reste inactif jusqu'à la navigation, qui
      // démonte ce formulaire — le réactiver avant permettait un second envoi pendant le
      // rechargement (2026-10-01).
      setIsSubmitting(false);
      if (result?.reason === "already_handled") {
        toast.danger(
          `Esta propuesta ya fue procesada${result.reviewed_by_email ? ` por ${result.reviewed_by_email}` : ""} (estado: ${result.status}).`
        );
        return;
      }
      toast.danger(MODERATE_ERRORS[result?.reason ?? ""] ?? "No se pudo procesar la propuesta. Inténtalo de nuevo.");
      return;
    }

    toast.success(decision === "approve" ? "Fotos aprobadas." : "Propuesta rechazada.");
    router.push("/admin/proposals");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mb-2 text-sm font-medium">Fotos propuestas — quita las que no quieras publicar</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="proposed-photos">
          {proposedPhotoPaths.map((path) => {
            const { data: publicUrl } = supabase.storage.from("catalog-media").getPublicUrl(path);
            const isSelected = selectedPaths.includes(path);
            return (
              <div key={path} className="relative" data-testid="proposed-photo-item">
                {/* eslint-disable-next-line @next/next/no-img-element -- aperçu isolé admin, cf. commentaire de tête */}
                <img
                  src={publicUrl.publicUrl}
                  alt=""
                  className={`aspect-square w-full rounded-md object-cover ${isSelected ? "" : "opacity-30"}`}
                />
                {isSelected ? (
                  <button
                    type="button"
                    onClick={() => removeFromSelection(path)}
                    aria-label="Quitar de la selección"
                    data-testid="proposed-photo-remove"
                    className={cn(overlayButtonClass, "absolute right-1 top-1")}
                  >
                    ✕
                  </button>
                ) : (
                  <span className="absolute right-1 top-1 rounded bg-default px-1.5 py-0.5 text-xs">
                    Excluida
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex max-w-md flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rejection-reason">Motivo de rechazo — obligatorio para rechazar</Label>
          <TextArea
            id="rejection-reason"
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <Button type="button" isDisabled={isSubmitting} onPress={() => handleDecision("approve")} data-testid="approve-button">
            {isSubmitting ? "Procesando…" : "Aprobar"}
          </Button>
          <Button
            type="button"
            variant="outline"
            isDisabled={isSubmitting}
            onPress={() => handleDecision("reject")}
            data-testid="reject-button"
          >
            {isSubmitting ? "Procesando…" : "Rechazar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
