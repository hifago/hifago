"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import type { Json } from "@hifago/supabase/database.types";
import { nowIsoInstant } from "@hifago/domain";
import { Button, Input, Label, TextField, toast } from "@hifago/ui";
import { ActionConfirmation } from "@/components/action-confirmation";
import { TagsMultiSelect, type TagOption } from "@/components/tags-multiselect";
import { FormSection } from "@/components/establishment-fields/form-section";
import { PresentationFields } from "@/components/establishment-fields/presentation-fields";
import { StayFields } from "@/components/establishment-fields/stay-fields";
import { ContactPhoneField } from "@/components/establishment-fields/contact-phone-field";
import { useEstablishmentFieldsState } from "@/lib/establishments/useEstablishmentFieldsState";
import { buildEstablishmentProposalFields } from "@/lib/establishments/establishmentPayload";
import { stayIfChanged, type StayValues } from "@/lib/establishments/stayFields";
import { contactPhoneIfChanged, isContactPhoneInvalid } from "@/lib/establishments/contactPhone";
import { tagIdsIfChanged } from "@/lib/tags/proposedTags";
import { amenityIdsIfChanged } from "@/lib/amenities/proposedAmenities";
import { ESTABLISHMENT_PROPOSAL_ERRORS } from "@/lib/establishments/proposalErrors";

const SUBMIT_ERRORS: Record<string, string> = {
  ...ESTABLISHMENT_PROPOSAL_ERRORS,
  establishment_not_found: "No se encontró el establecimiento.",
  capability_suspended: "Tu capacidad de operador para este establecimiento no está activa.",
};

const WITHDRAW_ERRORS: Record<string, string> = {
  proposal_not_found: "No se encontró la propuesta.",
  not_pending: "Esta propuesta ya fue procesada.",
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
};

type PendingProposal = { id: string; payload: unknown; created_at: string } | null;

// Pré-rempli avec la fiche COMPLÈTE actuelle, pas seulement les champs à modifier (même propriété
// de sûreté que EditProposalForm.tsx, produits) — un champ non retouché porte sa valeur actuelle
// dans le payload envoyé au serveur. operated_directly n'apparaît jamais ici : jamais proposable
// par le socio (docs/specs/06-gestion-etablissement.md §3).
//
// Toute la fiche que l'admin édite, découpée en sections qui portent les titres de ses blocs
// (2026-10-14, migration 20261015004421) : jusqu'ici le socio ne pouvait proposer ni son séjour, ni
// son contact public, ni ses équipements — « ce n'est pas à un admin de remplir la fiche d'un
// partenaire ». Restent à l'admin : publier/dépublier, operated_directly, l'activation du
// connecteur Lobby et is_place.
//
// Séjour, contact, étiquettes et équipements n'entrent dans la proposition QUE s'ils ont changé
// (`…IfChanged`) : une clé présente REMPLACE la valeur à l'approbation, une clé absente n'y touche
// pas. Le socio choisit parmi les étiquettes et équipements existants, sans en créer.
export function EditEstablishmentProposalForm({
  establishmentId,
  initialNameEs,
  initialDescriptionEs,
  initialDescriptionEn,
  initialAddress,
  initialLat,
  initialLon,
  initialStay,
  initialContactPhone,
  isPlace,
  pendingProposal,
  availableTags,
  currentTagIds,
  availableAmenities,
  currentAmenityIds,
}: {
  establishmentId: string;
  initialNameEs: string;
  initialDescriptionEs: string;
  initialDescriptionEn: string;
  initialAddress: string;
  initialLat: string;
  initialLon: string;
  initialStay: StayValues;
  initialContactPhone: string;
  // Un lieu (le village, un événement municipal) n'est jamais un endroit où l'on dort : pas de
  // section Alojamiento (contrainte establishments_place_has_no_stay_mode).
  isPlace: boolean;
  pendingProposal: PendingProposal;
  availableTags: TagOption[];
  currentTagIds: string[];
  availableAmenities: TagOption[];
  currentAmenityIds: string[];
}) {
  const [nombre, setNombre] = useState(initialNameEs);
  const fields = useEstablishmentFieldsState({
    descriptionEs: initialDescriptionEs,
    descriptionEn: initialDescriptionEn,
    address: initialAddress,
    lat: initialLat || null,
    lon: initialLon || null,
    stay: initialStay,
    contactPhone: initialContactPhone,
    tagIds: currentTagIds,
    amenityIds: currentAmenityIds,
  });
  const [lobbyApiToken, setLobbyApiToken] = useState("");

  const [proposal, setProposal] = useState(pendingProposal);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  // docs/specs/40 §4 — remplace l'ancien patron « bannière au-dessus du formulaire toujours
  // éditable » (qui laissait créer une 2e proposition en silence) : une proposition en attente
  // masque désormais le formulaire, « Editar de nuevo » le rouvre explicitement (pré-rempli),
  // « Retirar propuesta » reste l'autre issue. Réinitialisé à `false` après un envoi réussi pour
  // que la confirmation réapparaisse.
  const [showFormAnyway, setShowFormAnyway] = useState(false);

  const contactInvalide = isContactPhoneInvalid(fields.contactPhone);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!nombre.trim()) {
      toast.danger("El nombre es obligatorio.");
      return;
    }
    if (contactInvalide) {
      toast.danger(ESTABLISHMENT_PROPOSAL_ERRORS.invalid_phone);
      return;
    }

    setIsSubmitting(true);

    const payload = {
      ...buildEstablishmentProposalFields(nombre, fields),
      // Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — cf. NewEstablishmentProposalForm.tsx.
      ...(lobbyApiToken.trim() ? { lobby_api_token: lobbyApiToken.trim() } : {}),
      ...(isPlace ? {} : stayIfChanged(initialStay, fields.stay)),
      ...contactPhoneIfChanged(initialContactPhone, fields.contactPhone),
      ...tagIdsIfChanged(currentTagIds, fields.selectedTagIds),
      ...amenityIdsIfChanged(currentAmenityIds, fields.selectedAmenityIds),
    };

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("submit_establishment_edit_proposal", {
      p_establishment_id: establishmentId,
      p_payload: payload as Json,
    });

    setIsSubmitting(false);

    const result = data as { ok: boolean; reason?: string; proposal_id?: string } | null;
    if (rpcError || !result?.ok) {
      toast.danger(
        SUBMIT_ERRORS[result?.reason ?? ""] ?? "No se pudo enviar la propuesta. Inténtalo de nuevo.",
      );
      return;
    }

    if (result.proposal_id) {
      setProposal({ id: result.proposal_id, payload, created_at: nowIsoInstant() });
    }
    setLobbyApiToken("");
    setShowFormAnyway(false);
  }

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
  }

  if (proposal && !showFormAnyway) {
    return (
      <div className="w-full max-w-3xl self-center">
        <ActionConfirmation
          contained
          status="pending"
          title="Cambios enviados para revisión"
          body="Un administrador de Hifago revisará estos cambios antes de aplicarlos en la ficha pública."
          actionLabel="Editar de nuevo"
          onAction={() => setShowFormAnyway(true)}
          secondaryActionLabel={isWithdrawing ? "Retirando…" : "Retirar propuesta"}
          onSecondaryAction={handleWithdraw}
          testId="pending-edit-proposal"
        />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full max-w-3xl flex-col gap-6 self-center">
      <FormSection title="Información general" testId="edit-proposal-general-section">
        <PresentationFields idPrefix="edit-proposal-" nombre={nombre} onNombreChange={setNombre} fields={fields} />
      </FormSection>

      {isPlace ? null : (
        <FormSection title="Alojamiento" testId="edit-proposal-stay-section">
          <StayFields value={fields.stay} onChange={fields.setStay} />
        </FormSection>
      )}

      <FormSection title="Contacto público" testId="edit-proposal-contact-section">
        <ContactPhoneField value={fields.contactPhone} onChange={fields.setContactPhone} />
      </FormSection>

      <FormSection title="Etiquetas y equipamiento" testId="edit-proposal-catalog-section">
        <TagsMultiSelect
          availableTags={availableTags}
          selectedTagIds={fields.selectedTagIds}
          onChange={fields.setSelectedTagIds}
          allowCreate={false}
          placeholder="Buscar una etiqueta…"
          testId="edit-proposal-tags"
        />
        <TagsMultiSelect
          availableTags={availableAmenities}
          selectedTagIds={fields.selectedAmenityIds}
          onChange={fields.setSelectedAmenityIds}
          allowCreate={false}
          label="Equipamiento"
          placeholder="Buscar equipamiento…"
          emptyMessage="Ningún equipamiento disponible."
          testId="edit-proposal-amenities"
        />
      </FormSection>

      <FormSection title="Conector PMS (LobbyPMS)" testId="edit-proposal-pms-section">
        <TextField fullWidth value={lobbyApiToken} onChange={setLobbyApiToken}>
          <Label>Token LobbyPMS — opcional</Label>
          <Input type="password" autoComplete="off" data-testid="edit-proposal-lobby-token-input" />
        </TextField>
        <p className="text-xs text-muted">
          Déjalo en blanco si no quieres cambiar la conexión con LobbyPMS. Si pegas un token aquí,
          el equipo lo verificará antes de aprobar esta edición.
        </p>
      </FormSection>

      <Button type="submit" isDisabled={isSubmitting || contactInvalide} data-testid="submit-edit-proposal-button">
        {isSubmitting ? "Enviando…" : "Enviar propuesta"}
      </Button>
    </form>
  );
}
