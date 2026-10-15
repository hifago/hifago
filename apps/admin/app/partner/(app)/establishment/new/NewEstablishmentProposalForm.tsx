"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import type { Json } from "@hifago/supabase/database.types";
import { Button, Input, Label, TextField, toast } from "@hifago/ui";
import { StagedEstablishmentPhotos, type StagedPhoto } from "@/components/establishment-photos-staged";
import { ActionConfirmation } from "@/components/action-confirmation";
import { TagsMultiSelect, type TagOption } from "@/components/tags-multiselect";
import { FormSection } from "@/components/establishment-fields/form-section";
import { PresentationFields } from "@/components/establishment-fields/presentation-fields";
import { StayFields } from "@/components/establishment-fields/stay-fields";
import { ContactPhoneField } from "@/components/establishment-fields/contact-phone-field";
import { useEstablishmentFieldsState } from "@/lib/establishments/useEstablishmentFieldsState";
import { buildEstablishmentProposalFields } from "@/lib/establishments/establishmentPayload";
import { stayIfFilled } from "@/lib/establishments/stayFields";
import { contactPhoneIfFilled, isContactPhoneInvalid } from "@/lib/establishments/contactPhone";
import { ESTABLISHMENT_PROPOSAL_ERRORS } from "@/lib/establishments/proposalErrors";

// pending_creation_exists retiré (2026-08-19, migration
// 20260819220000_establishment_creation_no_pending_cap.sql) : la RPC ne renvoie plus jamais cette
// raison, plusieurs propositions de création peuvent désormais coexister en attente.
const SUBMIT_ERRORS: Record<string, string> = {
  ...ESTABLISHMENT_PROPOSAL_ERRORS,
  not_a_partner: "Tu cuenta no está asociada a ningún partner.",
  gallery_cap_exceeded: "Puedes proponer hasta 6 fotos.",
};

// docs/specs/06-gestion-etablissement.md §5.2 — jamais operated_directly (classification métier/
// plateforme, filtrée aussi côté RPC). Les sections sont celles de l'édition
// (EditEstablishmentProposalForm.tsx), photos en plus.
//
// Séjour, contact public, étiquettes et équipements proposables dès la création (2026-10-14,
// migration 20261015004421) : sans eux, le partenaire ne pouvait les ajouter qu'une fois sa
// capacité operator activée par un admin — c'est-à-dire que l'admin finissait par remplir sa fiche.
// Pas d'assistant par étapes comme NewEstablishmentForm.tsx (admin) : sa première étape,
// « Propietario y gestión », ne porte que des champs réservés à l'admin.
export function NewEstablishmentProposalForm({
  availableTags,
  availableAmenities,
}: {
  availableTags: TagOption[];
  availableAmenities: TagOption[];
}) {
  const router = useRouter();

  const [nombre, setNombre] = useState("");
  const fields = useEstablishmentFieldsState();
  const [lobbyApiToken, setLobbyApiToken] = useState("");
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  // Écran de confirmation plein écran (docs/specs/40 §4) — toujours « partenaire/en attente », ce
  // formulaire n'est jamais atteint par un admin.
  const [showConfirmation, setShowConfirmation] = useState(false);

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
      photos: stagedPhotos.map((photo) => ({ storage_path: photo.path })),
      // Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — optionnel, filtré côté RPC si vide ;
      // reste en clair uniquement tant que la proposition est "pending" (l'admin doit le lire pour
      // le tester), rédigé dès qu'elle est tranchée (cf. moderate_establishment_proposal).
      ...(lobbyApiToken.trim() ? { lobby_api_token: lobbyApiToken.trim() } : {}),
      ...stayIfFilled(fields.stay),
      ...contactPhoneIfFilled(fields.contactPhone),
      ...(fields.selectedTagIds.length > 0 ? { tag_ids: fields.selectedTagIds } : {}),
      ...(fields.selectedAmenityIds.length > 0 ? { amenity_ids: fields.selectedAmenityIds } : {}),
    };

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("submit_establishment_creation_proposal", {
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

    setShowConfirmation(true);
  }

  if (showConfirmation) {
    return (
      <ActionConfirmation
        status="pending"
        title="Propuesta enviada"
        body="Un administrador de Hifago revisará tu propuesta antes de publicar el establecimiento. Te avisaremos cuando esté disponible."
        actionLabel="Ir a mis establecimientos"
        onAction={() => {
          router.push("/partner/establishment");
          router.refresh();
        }}
        testId="establishment-proposal-confirmation"
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full max-w-3xl flex-col gap-6 self-center">
      <FormSection title="Información general" testId="proposal-general-section">
        <PresentationFields idPrefix="proposal-" nombre={nombre} onNombreChange={setNombre} fields={fields} />
      </FormSection>

      <FormSection title="Fotos — opcional" testId="proposal-photos-section">
        <StagedEstablishmentPhotos photos={stagedPhotos} onChange={setStagedPhotos} />
      </FormSection>

      <FormSection title="Alojamiento" testId="proposal-stay-section">
        <StayFields value={fields.stay} onChange={fields.setStay} />
      </FormSection>

      <FormSection title="Contacto público" testId="proposal-contact-section">
        <ContactPhoneField value={fields.contactPhone} onChange={fields.setContactPhone} />
      </FormSection>

      <FormSection title="Etiquetas y equipamiento" testId="proposal-catalog-section">
        <TagsMultiSelect
          availableTags={availableTags}
          selectedTagIds={fields.selectedTagIds}
          onChange={fields.setSelectedTagIds}
          allowCreate={false}
          placeholder="Buscar una etiqueta…"
          testId="proposal-tags"
        />
        <TagsMultiSelect
          availableTags={availableAmenities}
          selectedTagIds={fields.selectedAmenityIds}
          onChange={fields.setSelectedAmenityIds}
          allowCreate={false}
          label="Equipamiento"
          placeholder="Buscar equipamiento…"
          emptyMessage="Ningún equipamiento disponible."
          testId="proposal-amenities"
        />
      </FormSection>

      <FormSection title="Conector PMS (LobbyPMS)" testId="proposal-pms-section">
        <TextField fullWidth value={lobbyApiToken} onChange={setLobbyApiToken}>
          <Label>Token LobbyPMS — opcional</Label>
          <Input type="password" autoComplete="off" data-testid="proposal-lobby-token-input" />
        </TextField>
        <p className="text-xs text-muted">
          Si ya usas LobbyPMS, pega aquí tu token de acceso — el equipo lo verificará antes de
          aprobar tu establecimiento. Puedes dejarlo en blanco y añadirlo más adelante.
        </p>
      </FormSection>

      <Button
        type="submit"
        isDisabled={isSubmitting || contactInvalide}
        data-testid="submit-establishment-proposal-button"
      >
        {isSubmitting ? "Enviando…" : "Enviar propuesta"}
      </Button>
    </form>
  );
}
