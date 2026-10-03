"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import type { Json } from "@hifago/supabase/database.types";
import { Button, Label, TextArea, TextField, toast } from "@hifago/ui";
import { LocalizedTextField, type LocalizedValue } from "@/components/localized-text-field";
import { ProductTypeFields } from "@/components/product-type-fields";
import type { TagOption } from "@/components/tags-multiselect";
import { asLocalizedField } from "@hifago/domain";
import { buildProductCreationPayload } from "@/lib/products/productCreationPayload";
import {
  payloadToFieldsInit,
  useProductTypeFieldsState,
  type ProductType,
  type RawProductFieldsPayload,
} from "@/lib/products/useProductTypeFieldsState";

const MODERATE_ERRORS: Record<string, string> = {
  proposal_not_found: "No se encontró la propuesta.",
  version_conflict: "Esta propuesta fue modificada por otra persona. Recarga la página.",
};

type ModerateResult = {
  ok: boolean;
  reason?: string;
  status?: string;
  reviewed_by_email?: string;
};

// name/description/photos : jamais couverts par RawProductFieldsPayload/payloadToFieldsInit
// (partagés avec ModerateProposalForm, spec 15 bis) — gérés à part dans ce composant, comme
// ProductForm le fait déjà pour les mêmes raisons (name/description en LocalizedValue, photos hors
// de ProductTypeFieldsState).
type RawProductCreationPayload = RawProductFieldsPayload & {
  name?: unknown;
  description?: unknown;
  photos?: { storage_path: string }[];
};

// Spec 15 — pendant de ModerateEstablishmentProposalForm (branche kind='create') pour une
// proposition de PRODUIT : contrairement à établissement (aucune "valeur actuelle" possible, la
// fiche n'existe pas encore), le type/établissement sont déjà fixés par le socio à la soumission
// (immuables, même invariant que ProductForm admin-direct) — affichés en lecture seule par la page
// parente, jamais corrigibles ici. Réutilise ProductTypeFields (même composant que ProductForm)
// pour le reste : aucune divergence de gating possible entre le formulaire de proposition et
// l'écran de modération (décision Jérôme 2026-08-17, "extraire plutôt que dupliquer").
export function ModerateProductCreationProposalForm({
  proposalId,
  expectedVersion,
  type,
  payload,
  availableTags,
  establishmentId,
  establishmentLobbyConnected,
}: {
  proposalId: string;
  expectedVersion: number;
  type: ProductType;
  payload: unknown;
  availableTags: TagOption[];
  // Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — l'établissement est déjà fixé à la
  // soumission (immuable ici, contrairement à ProductForm), donc toujours connu de la page parente.
  establishmentId: string;
  establishmentLobbyConnected: boolean;
}) {
  const proposedPayload = (payload ?? {}) as RawProductCreationPayload;
  const proposedPhotos = Array.isArray(proposedPayload.photos) ? proposedPayload.photos : [];
  // getPublicUrl construit une URL sans appel réseau (bucket "catalog-media" public en lecture) —
  // instance jetable, même convention que handleDecision plus bas.
  const photoUrls = proposedPhotos.map(
    (photo) => createClient().storage.from("catalog-media").getPublicUrl(photo.storage_path).data.publicUrl,
  );

  const [name, setName] = useState<LocalizedValue>(() => ({ ...(asLocalizedField(proposedPayload.name) ?? {}) }));
  const [description, setDescription] = useState<LocalizedValue>(() => ({
    ...(asLocalizedField(proposedPayload.description) ?? {}),
  }));
  const fields = useProductTypeFieldsState(payloadToFieldsInit(proposedPayload));
  const [rejectionReason, setRejectionReason] = useState("");

  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  function goToProposalsList() {
    router.push("/admin/proposals");
    router.refresh();
  }

  async function handleDecision(decision: "approve" | "reject") {
    if (decision === "approve" && !(name.es ?? "").trim()) {
      toast.danger("El nombre (es) es obligatorio.");
      return;
    }
    if (decision === "reject" && !rejectionReason.trim()) {
      toast.danger("El motivo es obligatorio para rechazar.");
      return;
    }

    setIsSubmitting(true);

    const supabase = createClient();
    const correctedPayload =
      decision === "approve" ? buildProductCreationPayload(type, name, description, fields) : null;
    const { data, error: rpcError } = await supabase.rpc("moderate_product_proposal", {
      p_proposal_id: proposalId,
      p_decision: decision,
      p_expected_version: expectedVersion,
      p_corrected_payload: correctedPayload as Json | null,
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
          `Esta propuesta ya fue procesada${result.reviewed_by_email ? ` por ${result.reviewed_by_email}` : ""} (estado: ${result.status}).`,
        );
        return;
      }
      toast.danger(
        MODERATE_ERRORS[result?.reason ?? ""] ?? "No se pudo procesar la propuesta. Inténtalo de nuevo.",
      );
      return;
    }

    // Retour Jérôme (2026-08-20) : create_product_from_proposal publie désormais directement
    // (sellable=true) à l'approbation — revirement du geste de publication séparée du 2026-08-18,
    // plus besoin de proposer "¿Publicar ahora?" ici. set_product_sellable reste disponible depuis
    // la fiche produit pour dépublier après coup.
    toast.success(decision === "approve" ? "Propuesta aprobada y publicada." : "Propuesta rechazada.");
    goToProposalsList();
  }

  return (
    <div className="flex max-w-md flex-col gap-4">
      <LocalizedTextField
        label="Nombre"
        value={name}
        onChange={setName}
        isRequired
        inputName="nombre"
        testIdPrefix="name"
      />
      {/* Démasqué le 2026-08-26 (arbitrage « import à la liaison », cf. product-form.tsx). Cacher
          ce champ ici avait un effet particulièrement fâcheux : l'admin modérait une proposition de
          chambre liée à Lobby sans voir AUCUNE description — ni celle proposée par le socio, ni
          celle de Lobby. Il validait à l'aveugle. */}
      <LocalizedTextField
        label="Descripción — opcional"
        value={description}
        onChange={setDescription}
        multiline
        testIdPrefix="description"
        fieldTestId="description-textarea"
      />

      {/* Lecture seule : ce formulaire n'édite jamais les photos (cf. commentaire de tête de la
          migration 20260817140000) — elles sont toujours rattachées telles que proposées par le
          socio, jamais via p_corrected_payload. */}
      {proposedPhotos.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Label>Fotos propuestas</Label>
          <div className="flex flex-wrap gap-2" data-testid="proposed-photos">
            {photoUrls.map((url, index) => (
              // eslint-disable-next-line @next/next/no-img-element -- aperçu de modération, pas une image de contenu (next/image inutile ici)
              <img
                key={url}
                src={url}
                alt=""
                data-testid={`proposed-photo-${index}`}
                className="h-20 w-20 rounded object-cover"
              />
            ))}
          </div>
        </div>
      ) : null}

      <ProductTypeFields
        type={type}
        state={fields}
        showTags
        showSlotRulesEditor
        allowCreateTags
        availableTags={availableTags}
        establishmentId={establishmentId}
        establishmentLobbyConnected={establishmentLobbyConnected}
        allowManualLobbyEntry
      />

      <TextField value={rejectionReason} onChange={setRejectionReason}>
        <Label>Motivo de rechazo — obligatorio para rechazar</Label>
        <TextArea id="rejection-reason" name="rejection-reason" />
      </TextField>

      <div className="flex gap-2">
        <Button
          type="button"
          isDisabled={isSubmitting}
          onPress={() => handleDecision("approve")}
          data-testid="approve-button"
        >
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
  );
}
