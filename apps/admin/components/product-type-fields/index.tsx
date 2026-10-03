"use client";

import { Input, Label, TextField } from "@hifago/ui";
import { TagsMultiSelect, type TagOption } from "@/components/tags-multiselect";
import { type LobbyRoomOption } from "@/components/lobby-option-picker";
import { SlotRulesEditor } from "@/components/slot-rules-editor";
import { PriceTiersEditor } from "@/components/price-tiers-editor";
import { productTypeGating, type ProductType, type ProductTypeFieldsState } from "@/lib/products/useProductTypeFieldsState";
import { LobbyLinkFields } from "./lobby-link-fields";
import { LocationAndTagsFields } from "./location-and-tags-fields";
import { TransportFields } from "./transport-fields";
import { LodgingFields } from "./lodging-fields";
import { CampFields } from "./camp-fields";
import { EventoFields } from "./evento-fields";
import { VitrineFields } from "./vitrine-fields";

// Découpage des god components (2026-09-17, revue de packaging admin) — ce fichier (1156 lignes à
// l'origine) est désormais le point d'entrée qui compose les blocs par type, extraits chacun dans
// leur propre fichier de ce dossier (LobbyLinkFields, LocationAndTagsFields, TransportFields,
// LodgingFields, CampFields, EventoFields, VitrineFields). AUCUN changement d'API : les 3 écrans
// consommateurs (ProductForm, ModerateProposalForm, EditProposalForm côté partenaire) importent
// toujours `ProductTypeFields` depuis "@/components/product-type-fields", mêmes props, même
// comportement — pure extraction, zéro logique déplacée ou réécrite. Les blocs restés courts et
// génériques (tags, équipements, prix, cupo par défaut, horaires d'activité) restent inline
// ci-dessous plutôt que fragmentés davantage (aucun n'atteint ~100 lignes).
//
// ⚠️ Bug préexistant repéré en extrayant (PAS introduit ni corrigé ici, comportement préservé à
// l'identique) : pour `type === "transport"`, le champ « Precio (COP) » ci-dessous (gardé par
// `!isEvento && !hasLocationAndTags`) ET celui de `PriceTiersEditor` (gardé par
// `hasPriceQtyFields`, juste en dessous) se rendent TOUS LES DEUX — même `state.priceCop`, deux
// champs visuellement dupliqués. Réintroduit le 2026-09-16 quand `hasLocationAndTags` a perdu
// `isTransport` (productTypeGating.ts) sans que cette condition-ci soit corrigée en retour. Signalé
// au rapport de fin de session plutôt que corrigé en silence (hifago/CLAUDE.md, avant-la-spec.md
// §7) — hors périmètre de ce chantier (extraction pure, zéro changement de comportement).
export function ProductTypeFields({
  type,
  state,
  section,
  showTags,
  showSlotRulesEditor,
  allowCreateTags,
  availableTags,
  showAmenities,
  availableAmenities,
  establishmentId,
  establishmentLobbyConnected,
  allowManualLobbyEntry,
  onApplyLobbyRoomData,
  lobbyLinkReadOnly = false,
  allowOnlineBookableConfig = false,
  campDurationDays = null,
}: {
  type: ProductType;
  state: ProductTypeFieldsState;
  // Assistant par étapes (docs/specs/40) — absent = comportement identique à avant (les 3 autres
  // consommateurs, `ModerateProductCreationProposalForm`/`ModerateProposalForm`/`EditProposalForm`,
  // n'y touchent pas), sinon ne rend que le sous-ensemble de blocs de l'étape correspondante.
  section?: "details" | "pricing";
  // showTags/showSlotRulesEditor : réplique exacte du gating "création
  // seulement" déjà en place dans ProductForm (spec 11 : "délégués en édition à des blocs
  // séparés") — décidé par l'appelant (ProductForm passe `!isEditing`), pas recalculé ici.
  // address/lat/lon/prix/tramos/min-max/check-in-out/capacité/stay_rates restent, eux, affichés
  // dans les deux modes, donc jamais gatés par ces props.
  showTags?: boolean;
  showSlotRulesEditor?: boolean;
  allowCreateTags?: boolean;
  availableTags?: TagOption[];
  // Équipements structurés (migration 20260917110000) — MÊME gating "création seulement" que
  // showTags, mais admin-only en plus (jamais passé `true` par le variant socio-proposal ni par
  // ModerateProductCreationProposalForm) : ces deux consommateurs omettent la prop, qui reste
  // `undefined`/falsy, le bloc ne se rend donc jamais pour eux — les équipements restent un geste
  // admin post-création par défaut (ProductAmenitiesBlock en édition), staged ici seulement pour la
  // création ADMIN directe (cf. product-form.tsx).
  showAmenities?: boolean;
  availableAmenities?: TagOption[];
  // Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — remplace l'ancien showLobbyFields
  // (booléen unique, admin-only). establishmentLobbyConnected (dérivé de
  // lobby_connector_active && lobby_has_token côté appelant) contrôle si le bloc s'affiche DU TOUT
  // (admin ET socio, dès que l'établissement est connecté) ; allowManualLobbyEntry
  // (`variant === "admin"`) contrôle si l'option "Entrada manual" (ID tapé à la main) est proposée
  // — jamais au socio, pour préserver l'invariant qui empêche d'injecter un ID Lobby arbitraire.
  campDurationDays?: number | null;
  establishmentId?: string;
  establishmentLobbyConnected?: boolean;
  allowManualLobbyEntry?: boolean;
  onApplyLobbyRoomData?: (data: LobbyRoomOption) => void | Promise<void>;
  lobbyLinkReadOnly?: boolean;
  allowOnlineBookableConfig?: boolean;
}) {
  const {
    isEvento, isCamp, isActivity, isLodging, isTransport,
    hasLocationAndTags, hasTags, hasAmenities, hasPriceQtyFields, hasCheckInOut, hasDefaultCapacity, hasGroupDiscount,
    hasProgram,
  } = productTypeGating(type);

  const showDetails = !section || section === "details";
  const showPricing = !section || section === "pricing";

  return (
    <>
      {showDetails ? (
        <LobbyLinkFields
          type={type}
          state={state}
          isLodging={isLodging}
          isActivity={isActivity}
          isTransport={isTransport}
          establishmentId={establishmentId}
          establishmentLobbyConnected={establishmentLobbyConnected}
          allowManualLobbyEntry={allowManualLobbyEntry}
          onApplyLobbyRoomData={onApplyLobbyRoomData}
          lobbyLinkReadOnly={lobbyLinkReadOnly}
        />
      ) : null}

      {showDetails && hasLocationAndTags ? <LocationAndTagsFields state={state} /> : null}

      {showDetails && isTransport ? <TransportFields state={state} /> : null}

      {showDetails && showTags && hasTags ? (
        <TagsMultiSelect
          availableTags={availableTags ?? []}
          selectedTagIds={state.selectedTagIds}
          onChange={state.setSelectedTagIds}
          allowCreate={allowCreateTags}
          testId="tags-multiselect"
        />
      ) : null}

      {showDetails && showAmenities && hasAmenities ? (
        <TagsMultiSelect
          availableTags={availableAmenities ?? []}
          selectedTagIds={state.selectedAmenityIds}
          onChange={state.setSelectedAmenityIds}
          allowCreate={false}
          label="Equipamiento"
          placeholder="Buscar equipamiento…"
          emptyMessage="Ningún equipamiento disponible."
          testId="amenities-multiselect"
        />
      ) : null}

      {showPricing && !isEvento && !hasLocationAndTags ? (
        // `isRequired` suit EXACTEMENT la contrainte SQL `products_price_cop_required_unless_vitrine` :
        // un evento OU une URL externe dispensent du prix chiffré. Sans ça, le champ resterait
        // obligatoire à l'écran alors que la base l'accepte vide — l'admin ne pourrait pas créer la
        // vitrine que la migration du 2026-09-08 autorise (spec 30 §6a).
        <TextField
          fullWidth
          name="price"
          value={state.priceCop}
          onChange={state.setPriceCop}
          isRequired={!state.externalBookingUrl.trim()}
        >
          <Label>Precio (COP)</Label>
          <Input id="price" type="number" min={1} />
        </TextField>
      ) : null}

      {showPricing && hasPriceQtyFields ? (
        <div className="flex flex-col gap-2">
          <PriceTiersEditor
            priceMode={state.priceMode}
            onPriceModeChange={state.setPriceMode}
            priceCop={state.priceCop}
            onPriceCopChange={state.setPriceCop}
            priceTiers={state.priceTiers}
            onPriceTiersChange={state.setPriceTiers}
            testId={(part, tierIndex) => {
              switch (part) {
                case "toggle":
                  return "price-mode-toggle";
                case "simple-input":
                  return "price-input";
                case "tiers-editor":
                  return "price-tiers-editor";
                case "add-tier":
                  return "add-price-tier-button";
                case "tier-min":
                  return `price-tier-min-${tierIndex}`;
                case "tier-max":
                  return `price-tier-max-${tierIndex}`;
                case "tier-price":
                  return `price-tier-price-${tierIndex}`;
                case "remove-tier":
                  return `remove-price-tier-${tierIndex}`;
              }
            }}
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextField value={state.minQty} onChange={state.setMinQty}>
              <Label>{isLodging ? "Huéspedes mínimos — opcional" : "Cantidad mínima — opcional"}</Label>
              <Input type="number" min={1} data-testid="min-qty-input" />
            </TextField>
            <TextField value={state.maxQty} onChange={state.setMaxQty}>
              <Label>{isLodging ? "Huéspedes máximos — opcional" : "Cantidad máxima — opcional"}</Label>
              <Input type="number" min={1} data-testid="max-qty-input" />
            </TextField>
          </div>
        </div>
      ) : null}

      {showPricing && hasDefaultCapacity ? (
        <div className="flex flex-col gap-1.5">
          <TextField fullWidth name="default-capacity" value={state.defaultCapacity} onChange={state.setDefaultCapacity}>
            <Label>Cupo diario por defecto — opcional</Label>
            <Input type="number" min={1} data-testid="default-capacity-input" />
          </TextField>
          <p className="text-xs text-muted" data-testid="default-capacity-help">
            Cuántas unidades hay disponibles cada día por defecto (antes de excepciones en el
            calendario). No es lo mismo que Cantidad mínima/máxima, que solo limita cuánto puede
            pedir un cliente en una sola reserva.
          </p>
        </div>
      ) : null}

      <CampFields
        state={state}
        section={section}
        hasGroupDiscount={hasGroupDiscount}
        isCamp={isCamp}
        hasProgram={hasProgram}
        campDurationDays={campDurationDays}
      />

      {isLodging ? (
        <LodgingFields
          state={state}
          section={section}
          hasCheckInOut={hasCheckInOut}
          establishmentLobbyConnected={establishmentLobbyConnected}
        />
      ) : null}

      {isEvento ? (
        <EventoFields state={state} section={section} allowOnlineBookableConfig={allowOnlineBookableConfig} />
      ) : null}

      {showPricing && !isEvento ? <VitrineFields state={state} /> : null}

      {showPricing && showSlotRulesEditor && isActivity ? (
        <div className="flex flex-col gap-1.5">
          <Label>Horarios — opcional</Label>
          <SlotRulesEditor rules={state.slotRules} onChange={state.setSlotRules} />
        </div>
      ) : null}
    </>
  );
}
