"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import type { Json } from "@hifago/supabase/database.types";
import { asLocalizedField, nowIsoInstant, resolveLocalizedField } from "@hifago/domain";
import { Button, toast } from "@hifago/ui";
import { LocalizedTextField, type LocalizedValue } from "@/components/localized-text-field";
import { ProductTypeFields } from "@/components/product-type-fields";
import type { TagOption } from "@/components/tags-multiselect";
import { buildProductEditPayload } from "@/lib/products/productEditPayload";
import { eventoOccurrenceError } from "@/lib/products/eventoOccurrence";
import { tagIdsIfChanged } from "@/lib/tags/proposedTags";
import { amenityIdsIfChanged } from "@/lib/amenities/proposedAmenities";
import { activityPricingError } from "@/lib/products/activityPricing";
import {
  requiredSlotRulesError,
  slotRulesFromColumn,
  slotRulesIfChanged,
} from "@/lib/products/slotRules";
import {
  payloadToFieldsInit,
  useProductTypeFieldsState,
  type ProductType,
  type RawProductFieldsPayload,
} from "@/lib/products/useProductTypeFieldsState";

const SUBMIT_ERRORS: Record<string, string> = {
  product_not_found: "No se encontró la actividad.",
  capability_suspended: "Tu capacidad de operador para este establecimiento no está activa.",
  pending_cap_exceeded:
    "Ya tienes 10 propuestas pendientes. Espera a que se revisen antes de enviar más.",
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
  // Migration 20261104120000 : horaires proposés vides ou illisibles.
  slot_rules_required: "Una actividad necesita al menos un horario.",
  invalid_slot_rules: "Revisa los horarios: uno de ellos no es válido.",
};

const WITHDRAW_ERRORS: Record<string, string> = {
  proposal_not_found: "No se encontró la propuesta.",
  not_pending: "Esta propuesta ya fue procesada.",
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
};

type PendingProposal = { id: string; payload: unknown; created_at: string } | null;

// Retour direct de Jérôme (2026-08-17, même jour que la spec 15 ci-dessus) : ce formulaire était
// resté figé à son état d'origine (feature 15 historique, 2026-08-13) — name-es/name-en séparés
// (jamais migré vers LocalizedTextField comme le reste, spec 11) et une `category` fixe abandonnée
// par ProductForm admin-direct depuis la spec 08 (tags). Réécrit pour réutiliser exactement les
// mêmes briques que ProductForm/ProductTypeFields (spec 15) : parité totale avec le parcours
// d'édition admin-direct — mêmes champs, même gating par type, jamais les photos (bloc séparé,
// PhotosSocioBlock, cf. migration 20260817150000).
//
// Les ÉTIQUETTES, elles, y sont depuis le 2026-10-13 (demande Jérôme, migration 20261013144848).
// Côté admin elles vivent dans un bloc à sauvegarde immédiate qu'un socio ne peut pas avoir (RLS
// admin-only) : sans champ ici, il les choisissait à la création puis ne pouvait plus jamais les
// changer. Elles partent donc dans la proposition, modérées comme le reste — et le socio choisit
// parmi les étiquettes existantes, sans en créer (même règle qu'à la création).
//
// Les ÉQUIPEMENTS d'un logement suivent le même chemin (migration 20261013151206). À l'inverse, le
// dépôt et le lien de réservation externe d'un logement sont des options admin : ils ne sont pas
// affichés ici, mais restent dans l'état et repartent tels quels dans la proposition.
//
// Les HORAIRES d'une activité aussi, depuis le 2026-11-04 (demande Jérôme, migration
// 20261104120000) : une fois la fiche partagée, le partenaire ne pouvait plus les changer. Même
// chemin que les étiquettes — `slot_rules` ne part que s'ils ont changé, modéré comme le reste, au
// moins un horaire.
export function EditProposalForm({
  productId,
  type,
  currentPayload,
  pendingProposal,
  availableTags,
  currentTagIds,
  availableAmenities,
  currentAmenityIds,
  currentSlotRules,
  establishmentId,
  establishmentLobbyConnected,
}: {
  productId: string;
  type: ProductType;
  currentPayload: RawProductFieldsPayload & { name?: unknown; description?: unknown };
  pendingProposal: PendingProposal;
  availableTags: TagOption[];
  currentTagIds: string[];
  availableAmenities: TagOption[];
  currentAmenityIds: string[];
  /** Les lignes product_slot_rules de la fiche (vide hors activité). */
  currentSlotRules: unknown[];
  // Corrigé le 2026-08-26 : ce formulaire rendait <ProductTypeFields type state /> SANS ces deux
  // props, donc la garde interne du bloc LobbyPMS (establishmentLobbyConnected) était toujours
  // fausse et le bloc n'était JAMAIS monté côté socio — un prestataire ne pouvait pas voir à quoi
  // son propre logement était lié, ni ce que LobbyPMS en savait. En lecture seule (arbitrage
  // Jérôme du même jour : Desvincular/Actualizar restent admin-only).
  establishmentId: string;
  establishmentLobbyConnected: boolean;
}) {
  const [name, setName] = useState<LocalizedValue>(() => ({ ...(asLocalizedField(currentPayload.name) ?? {}) }));
  const [description, setDescription] = useState<LocalizedValue>(() => ({
    ...(asLocalizedField(currentPayload.description) ?? {}),
  }));
  // `duration_days` est chargé par le select de cette page (spec 37) pour alimenter le nombre de
  // journées de l'éditeur de programme — mais il est retiré ICI de l'hydratation du formulaire.
  // Sans ce retrait, l'input « Duración (días) » s'afficherait rempli alors que
  // buildProductEditPayload ne l'émet pas (le socio n'a pas à changer la durée d'un camp déjà
  // vendu) : le champ semblerait modifiable puis jetterait le changement en silence — précisément
  // ce que le commentaire du select d'admin/products/[id]/edit/page.tsx interdit. Il repart donc
  // par la prop campDurationDays, qui n'alimente que l'éditeur de programme.
  const fields = useProductTypeFieldsState(
    payloadToFieldsInit({
      ...currentPayload,
      duration_days: null,
      tag_ids: currentTagIds,
      amenity_ids: currentAmenityIds,
      slot_rules: currentSlotRules,
    }),
  );
  // Les horaires en place, sous la même forme que l'état : la référence de slotRulesIfChanged.
  const [initialSlotRules] = useState(() => slotRulesFromColumn(currentSlotRules));
  const isActivity = type === "activity";

  const [proposal, setProposal] = useState(pendingProposal);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!(name.es ?? "").trim()) {
      toast.danger("El nombre (es) es obligatorio.");
      return;
    }
    // La date d'un evento part dans chaque proposition depuis le 2026-10-13 : la laisser vide
    // proposerait de la retirer.
    const occurrenceError = type === "evento" ? eventoOccurrenceError(fields) : null;
    if (occurrenceError) {
      toast.danger(occurrenceError);
      return;
    }
    // Horaires (migration 20261104120000) : vérifiés seulement s'ils changent — une fiche ancienne
    // sans horaire peut encore corriger son nom sans en créer un. Le mode « por hora » exige, lui,
    // des horaires d'une heure dans tous les cas : la base refuserait l'approbation sinon.
    const slotRulesChange = isActivity ? slotRulesIfChanged(initialSlotRules, fields.slotRules) : {};
    const activityError = isActivity
      ? ((slotRulesChange.slot_rules ? requiredSlotRulesError(fields.slotRules) : null) ??
        activityPricingError({
          pricingUnit: fields.pricingUnit,
          minPersons: fields.minPersons,
          maxPersons: fields.maxPersons,
          isEditing: false,
          slotRules: fields.slotRules,
        }))
      : null;
    if (activityError) {
      toast.danger(activityError);
      return;
    }

    setIsSubmitting(true);

    const payload = {
      ...buildProductEditPayload(type, name, description, fields),
      ...slotRulesChange,
      ...tagIdsIfChanged(currentTagIds, fields.selectedTagIds),
      ...amenityIdsIfChanged(currentAmenityIds, fields.selectedAmenityIds),
    };
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("submit_product_proposal", {
      p_product_id: productId,
      p_payload: payload as Json,
    });

    setIsSubmitting(false);

    const result = data as { ok: boolean; reason?: string; proposal_id?: string } | null;
    if (rpcError || !result?.ok) {
      toast.danger(
        SUBMIT_ERRORS[result?.reason ?? ""] ?? "No se pudo enviar la propuesta. Inténtalo de nuevo."
      );
      return;
    }

    // Reflète la proposition tout juste créée directement depuis la réponse RPC, sans dépendre
    // d'un aller-retour serveur : un `router.refresh()` ne suffirait pas ici, useState(props) ne
    // se resynchronise pas tout seul sur une nouvelle valeur de prop après le montage initial.
    if (result.proposal_id) {
      setProposal({
        id: result.proposal_id,
        payload,
        created_at: nowIsoInstant(),
      });
    }
    toast.success("Propuesta enviada.");
  }

  async function handleWithdraw() {
    if (!proposal) return;
    setIsWithdrawing(true);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("withdraw_product_proposal", {
      p_proposal_id: proposal.id,
    });

    setIsWithdrawing(false);

    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      toast.danger(
        WITHDRAW_ERRORS[result?.reason ?? ""] ?? "No se pudo retirar la propuesta. Inténtalo de nuevo."
      );
      return;
    }

    setProposal(null);
    toast.success("Propuesta retirada.");
  }

  const proposedName = proposal
    ? resolveLocalizedField(asLocalizedField((proposal.payload as { name?: unknown })?.name), "es")
    : null;

  return (
    <div className="flex max-w-md flex-col gap-6">
      {proposal ? (
        <div
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
          data-testid="pending-proposal"
        >
          <p className="text-sm font-medium">Propuesta pendiente de revisión</p>
          <p className="text-sm text-muted">{proposedName ?? proposal.id}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            isDisabled={isWithdrawing}
            onPress={handleWithdraw}
            data-testid="withdraw-proposal-button"
          >
            {isWithdrawing ? "Retirando…" : "Retirar"}
          </Button>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <LocalizedTextField
          label="Nombre"
          value={name}
          onChange={setName}
          isRequired
          inputName="nombre"
          testIdPrefix="name"
        />
        <LocalizedTextField
          label="Descripción — opcional"
          value={description}
          onChange={setDescription}
          multiline
          testIdPrefix="description"
          fieldTestId="description-textarea"
        />

        <ProductTypeFields
          type={type}
          state={fields}
          showTags
          allowCreateTags={false}
          availableTags={availableTags}
          showAmenities
          availableAmenities={availableAmenities}
          showAdminLodgingOptions={false}
          establishmentId={establishmentId}
          establishmentLobbyConnected={establishmentLobbyConnected}
          lobbyLinkReadOnly
          campDurationDays={currentPayload.duration_days ?? null}
          showSlotRulesEditor={isActivity}
        />

        <Button type="submit" isDisabled={isSubmitting} data-testid="submit-proposal-button">
          {isSubmitting ? "Enviando…" : "Enviar propuesta"}
        </Button>
      </form>
    </div>
  );
}
