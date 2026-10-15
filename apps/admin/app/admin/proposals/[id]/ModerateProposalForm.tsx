"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import type { Json } from "@hifago/supabase/database.types";
import { asLocalizedField, resolveLocalizedField, formatCop } from "@hifago/domain";
import { Button, Label, TextArea, TextField, toast } from "@hifago/ui";
import { LocalizedTextField, type LocalizedValue } from "@/components/localized-text-field";
import { ProductTypeFields } from "@/components/product-type-fields";
import type { TagOption } from "@/components/tags-multiselect";
import { buildProductEditPayload } from "@/lib/products/productEditPayload";
import { eventoOccurrenceError } from "@/lib/products/eventoOccurrence";
import { eventoChangeRefusal } from "@/lib/products/eventoChangeRefusal";
import { withCurrentValuesForAbsentKeys } from "@/lib/products/proposalFallback";
import { proposedTagIds, tagLabels } from "@/lib/tags/proposedTags";
import { proposedAmenityIds } from "@/lib/amenities/proposedAmenities";
import { formatSlotPreviewSummary, slotRulesFromColumn, toSlotRuleRows, validateSlotRules } from "@/lib/products/slotRules";
import { lodgingKindLabel } from "@/lib/products/lodgingKindLabels";
import { lodgingUnitLabel } from "@/lib/products/lodgingUnitLabels";
import {
  payloadToFieldsInit,
  productTypeGating,
  useProductTypeFieldsState,
  type ProductType,
  type RawProductFieldsPayload,
} from "@/lib/products/useProductTypeFieldsState";

const MODERATE_ERRORS: Record<string, string> = {
  proposal_not_found: "No se encontró la propuesta.",
  version_conflict: "Esta propuesta fue modificada por otra persona. Recarga la página.",
};

type ModerateResult = { ok: boolean; reason?: string; status?: string; reviewed_by_email?: string };

type ProductFieldsPayload = RawProductFieldsPayload & { name?: unknown; description?: unknown };

// Retour direct de Jérôme (2026-08-17, même jour que la spec 15) sur EditProposalForm.tsx (socio)
// — étendu ici en miroir côté modération admin : parité totale des champs avec ProductTypeFields
// (address/tramos/bornes/check-in-out/capacité/tarifs de séjour), plus seulement les 4 champs
// legacy name/description/price_cop/category (category abandonné, cf. migration
// 20260817150000). "Valor actual" reste un résumé texte lecture seule (pas une 2e instance de
// ProductTypeFields : les deux partagent des id DOM statiques — address-input, price-input… — deux
// instances sur la même page produiraient des doublons d'id invalides) ; "Valor propuesto" reste le
// seul formulaire réellement corrigible, comme ModerateProductCreationProposalForm.
export function ModerateProposalForm({
  proposalId,
  expectedVersion,
  type,
  currentPayload,
  proposedPayload,
  availableTags,
  currentTagIds,
  availableAmenities,
  currentAmenityIds,
  currentSlotRules,
}: {
  proposalId: string;
  expectedVersion: number;
  type: ProductType;
  currentPayload: ProductFieldsPayload;
  proposedPayload: ProductFieldsPayload;
  availableTags: TagOption[];
  currentTagIds: string[];
  availableAmenities: TagOption[];
  currentAmenityIds: string[];
  // Lignes product_slot_rules en place — comparées aux horaires proposés (migration 20261015011812).
  currentSlotRules: unknown[];
}) {
  const router = useRouter();
  const [name, setName] = useState<LocalizedValue>(() => ({ ...(asLocalizedField(proposedPayload.name) ?? {}) }));
  const [description, setDescription] = useState<LocalizedValue>(() => ({
    ...(asLocalizedField(proposedPayload.description) ?? {}),
  }));
  // ⚠️ Chaque champ est hydraté depuis la proposition SI ELLE PORTE LA CLÉ, sinon depuis le produit
  // actuel. Sans cette distinction, une clé absente (proposition déposée avant la migration qui l'a
  // whitelistée, ou réglage jamais proposable) partirait d'un champ vide, et comme ce formulaire
  // reconstruit TOUT le payload à l'approbation (buildProductEditPayload), il émettrait `null` et
  // EFFACERAIT la valeur en place. C'est la même distinction absent/null que les gardes
  // `v_final_payload ? '…'` expriment côté SQL — ici il faut la tenir côté client, parce que c'est
  // ce formulaire qui décide du payload final. D'abord écrit pour `program` seul (spec 37),
  // généralisé le 2026-10-13 : lib/products/proposalFallback.ts.
  const fields = useProductTypeFieldsState(
    payloadToFieldsInit(withCurrentValuesForAbsentKeys(proposedPayload, currentPayload)),
  );
  const [rejectionReason, setRejectionReason] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Étiquettes (migration 20261013144848). Une proposition ne porte `tag_ids` QUE si le socio a
  // changé la sélection : le champ n'est monté, et la clé renvoyée, que dans ce cas. La renvoyer
  // toujours ferait de chaque approbation un écrasement des étiquettes en place — même distinction
  // absent/présent que le programme ci-dessus, tenue ici parce que ce formulaire reconstruit le
  // payload final.
  const proposesTags = proposedTagIds(proposedPayload) !== null;
  // Équipements d'un logement (migration 20261013151206) : même distinction absent/présent.
  const proposesAmenities = proposedAmenityIds(proposedPayload) !== null;
  // Horaires d'une activité (migration 20261015011812) : même distinction absent/présent. La
  // correction de l'admin REMPLACE toute la proposition côté SQL — d'où la clé renvoyée ici dès que
  // la proposition la porte, sans quoi l'approbation perdrait les horaires proposés.
  const proposesSlotRules = Array.isArray(proposedPayload.slot_rules);

  const {
    hasLocationAndTags, hasPriceQtyFields, hasCheckInOut, hasDefaultCapacity, isLodging, isEvento, isCamp,
  } = productTypeGating(type);
  const needsOwnPrice = !isEvento;

  async function handleDecision(decision: "approve" | "reject") {
    if (decision === "approve" && !(name.es ?? "").trim()) {
      toast.danger("El nombre (es) es obligatorio.");
      return;
    }
    if (decision === "reject" && !rejectionReason.trim()) {
      toast.danger("El motivo es obligatorio para rechazar.");
      return;
    }
    const occurrenceError = decision === "approve" && isEvento ? eventoOccurrenceError(fields) : null;
    if (occurrenceError) {
      toast.danger(occurrenceError);
      return;
    }
    const slotRulesError = decision === "approve" && proposesSlotRules ? validateSlotRules(fields.slotRules) : null;
    if (slotRulesError) {
      toast.danger(slotRulesError);
      return;
    }

    setIsSubmitting(true);

    const supabase = createClient();
    const correctedPayload =
      decision === "approve"
        ? {
            ...buildProductEditPayload(type, name, description, fields),
            ...(proposesTags ? { tag_ids: fields.selectedTagIds } : {}),
            ...(proposesAmenities ? { amenity_ids: fields.selectedAmenityIds } : {}),
            ...(proposesSlotRules ? { slot_rules: toSlotRuleRows(fields.slotRules) } : {}),
          }
        : null;
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
          `Esta propuesta ya fue procesada${result.reviewed_by_email ? ` por ${result.reviewed_by_email}` : ""} (estado: ${result.status}).`
        );
        return;
      }
      // Un evento qui porte des réservations en cours : nouvelle date qui les laisserait hors de
      // ses dates (HF002, migration 20261014204354), ou drapeau de capacité gelé.
      const refusal = eventoChangeRefusal(rpcError);
      if (refusal) {
        toast.danger(refusal);
        return;
      }
      toast.danger(
        MODERATE_ERRORS[result?.reason ?? ""] ?? "No se pudo procesar la propuesta. Inténtalo de nuevo."
      );
      return;
    }

    toast.success(decision === "approve" ? "Propuesta aprobada." : "Propuesta rechazada.");
    router.push("/admin/proposals");
    router.refresh();
  }

  const currentName = resolveLocalizedField(asLocalizedField(currentPayload.name), "es");
  const currentDescription = resolveLocalizedField(asLocalizedField(currentPayload.description), "es");
  const currentPriceLabel = needsOwnPrice
    ? currentPayload.price_cop != null
      ? formatCop(currentPayload.price_cop)
      : "—"
    : "— (sin precio propio)";
  const currentRecurrence =
    currentPayload.occurrence_type === "recurring"
      ? ` — recurrente, cada ${currentPayload.recurrence_frequency_days ?? "?"} días${
          currentPayload.recurrence_end_date
            ? `, hasta ${currentPayload.recurrence_end_date}`
            : currentPayload.recurrence_end_count != null
              ? `, ${currentPayload.recurrence_end_count} repeticiones`
              : ""
        }`
      : "";

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-border bg-surface p-4" data-testid="current-values">
        <p className="text-sm font-medium">Valor actual</p>
        <dl className="mt-2 flex flex-col gap-1 text-sm text-muted">
          <div>
            <dt className="inline font-medium text-foreground">Nombre: </dt>
            <dd className="inline">{currentName || "—"}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">Descripción: </dt>
            <dd className="inline">{currentDescription || "—"}</dd>
          </div>
          {hasLocationAndTags ? (
            <div>
              <dt className="inline font-medium text-foreground">Dirección: </dt>
              <dd className="inline">{currentPayload.address || "—"}</dd>
            </div>
          ) : null}
          <div>
            <dt className="inline font-medium text-foreground">Precio: </dt>
            <dd className="inline">
              {currentPriceLabel}
              {Array.isArray(currentPayload.price_tiers) && currentPayload.price_tiers.length > 0
                ? ` (${currentPayload.price_tiers.length} tramos)`
                : ""}
            </dd>
          </div>
          {/* Evento (2026-10-13) : la date et l'heure en place, à comparer au formulaire ci-dessous —
              elles voyagent désormais dans la proposition. Chaînes affichées telles quelles, jamais
              un objet Date (pas de fuseau à réinterpréter). */}
          {isEvento ? (
            <>
              <div data-testid="current-price-label">
                <dt className="inline font-medium text-foreground">Precio (texto libre): </dt>
                <dd className="inline">{currentPayload.price_label || "—"}</dd>
              </div>
              <div data-testid="current-occurrence-date">
                <dt className="inline font-medium text-foreground">Fecha: </dt>
                <dd className="inline">
                  {currentPayload.occurrence_date || "—"}
                  {currentRecurrence}
                </dd>
              </div>
              <div data-testid="current-start-time">
                <dt className="inline font-medium text-foreground">Hora de inicio: </dt>
                <dd className="inline">{currentPayload.start_time?.slice(0, 5) || "—"}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Duración (minutos): </dt>
                <dd className="inline">{currentPayload.duration_minutes ?? "—"}</dd>
              </div>
            </>
          ) : null}
          {hasDefaultCapacity ? (
            <div data-testid="current-default-capacity">
              <dt className="inline font-medium text-foreground">Cupo diario por defecto: </dt>
              <dd className="inline">{currentPayload.default_capacity ?? "—"}</dd>
            </div>
          ) : null}
          <div data-testid="current-tags">
            <dt className="inline font-medium text-foreground">Etiquetas: </dt>
            <dd className="inline">
              {tagLabels(currentTagIds, availableTags)}
              {proposesTags ? "" : " (sin cambios propuestos)"}
            </dd>
          </div>
          {isLodging ? (
            <div data-testid="current-amenities">
              <dt className="inline font-medium text-foreground">Equipamiento: </dt>
              <dd className="inline">
                {tagLabels(currentAmenityIds, availableAmenities)}
                {proposesAmenities ? "" : " (sin cambios propuestos)"}
              </dd>
            </div>
          ) : null}
          {type === "activity" ? (
            <div data-testid="current-slot-rules">
              <dt className="inline font-medium text-foreground">Horarios: </dt>
              <dd className="inline">
                {currentSlotRules.length > 0
                  ? slotRulesFromColumn(currentSlotRules).map(formatSlotPreviewSummary).join(" · ")
                  : "—"}
                {proposesSlotRules ? "" : " (sin cambios propuestos)"}
              </dd>
            </div>
          ) : null}
          {hasPriceQtyFields ? (
            <div>
              <dt className="inline font-medium text-foreground">Cantidad mín/máx: </dt>
              <dd className="inline">
                {currentPayload.min_qty ?? "—"} / {currentPayload.max_qty ?? "—"}
              </dd>
            </div>
          ) : null}
          {hasCheckInOut ? (
            <div>
              <dt className="inline font-medium text-foreground">Check-in/Check-out: </dt>
              <dd className="inline">
                {currentPayload.check_in_time?.slice(0, 5) || "—"} / {currentPayload.check_out_time?.slice(0, 5) || "—"}
              </dd>
            </div>
          ) : null}
          {isLodging ? (
            <div>
              <dt className="inline font-medium text-foreground">Capacidad: </dt>
              <dd className="inline">{currentPayload.capacity ?? "—"}</dd>
            </div>
          ) : null}
          {/* Le programme d'un camp (spec 37) : sans cette ligne, le modérateur approuverait une
              refonte complète du déroulé sans jamais voir celui qu'il remplace — exactement le
              « change en silence » que la note ci-dessous décrit. */}
          {isCamp ? (
            <div>
              <dt className="inline font-medium text-foreground">Programa: </dt>
              <dd className="inline">
                {Array.isArray(currentPayload.program) && currentPayload.program.length > 0
                  ? `${currentPayload.program.length} línea(s)`
                  : "—"}
              </dd>
            </div>
          ) : null}
          {/* Affiché à côté de la capacité (2026-08-26) : le modérateur compare l'existant à la
              proposition champ par champ — un champ absent de cette liste change en silence. */}
          {isLodging ? (
            <div>
              <dt className="inline font-medium text-foreground">Cantidad: </dt>
              <dd className="inline">{currentPayload.unit_count ?? "—"}</dd>
            </div>
          ) : null}
          {isLodging ? (
            <div>
              <dt className="inline font-medium text-foreground">Tipo de alojamiento: </dt>
              <dd className="inline">{lodgingKindLabel(currentPayload.lodging_kind) ?? "—"}</dd>
            </div>
          ) : null}
          {isLodging ? (
            <div>
              <dt className="inline font-medium text-foreground">Unidad de precio: </dt>
              <dd className="inline">{lodgingUnitLabel(currentPayload.unit) ?? "—"}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="flex max-w-md flex-col gap-4">
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
          showTags={proposesTags}
          allowCreateTags
          availableTags={availableTags}
          showAmenities={proposesAmenities}
          availableAmenities={availableAmenities}
          showSlotRulesEditor={proposesSlotRules}
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
    </div>
  );
}
