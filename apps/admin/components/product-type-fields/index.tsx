"use client";

import { Input, Label, ListBox, Select, TextField } from "@hifago/ui";
import { asPricingUnit } from "@hifago/domain";
import { TagsMultiSelect, type TagOption } from "@/components/tags-multiselect";
import { type LobbyRoomOption } from "@/components/lobby-option-picker";
import { SlotRulesEditor } from "@/components/slot-rules-editor";
import { PriceTiersEditor } from "@/components/price-tiers-editor";
import {
  PRICING_UNIT_OPTIONS,
  dailyCapacityLabel,
  minQtyLabel,
  priceLabel,
  pricingAllowsQty,
  pricingShowsDailyCapacity,
  pricingShowsPersons,
} from "@/lib/products/activityPricing";
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
  showAdminLodgingOptions = true,
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
  // Équipements structurés d'un logement (migration 20260917110000) — décidé par l'appelant, comme
  // showTags. Montés à la création (admin directe ET proposition socio) et dans les écrans de
  // proposition, où ils voyagent dans le payload (`amenity_ids`, migration 20261013151206) ; jamais
  // par ProductForm en édition admin, où ProductAmenitiesBlock les sauvegarde à part.
  showAmenities?: boolean;
  availableAmenities?: TagOption[];
  // Options d'un logement réservées à l'admin (demande Jérôme du 2026-10-13) : le dépôt et le lien
  // de réservation externe, avec son prix en texte libre. L'espace socio passe `false` ; les
  // valeurs déjà posées restent dans l'état et repartent telles quelles dans la proposition.
  showAdminLodgingOptions?: boolean;
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
    hasProgram, hasMinQty, hasMaxQty,
  } = productTypeGating(type);

  const showDetails = !section || section === "details";
  const showPricing = !section || section === "pricing";

  // Spec 43 — le mode de prix d'une activité décide de ce que l'écran montre : tout autre type
  // garde exactement l'écran d'avant (« por persona » sans le dire).
  const pricingUnit = isActivity ? state.pricingUnit : "per_person";
  const allowsQty = pricingAllowsQty(pricingUnit);
  const pricingOption = PRICING_UNIT_OPTIONS.find((option) => option.value === pricingUnit);

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
          // Sans création possible (socio), le texte par défaut « Buscar o crear un tag… »
          // promettrait un geste que la liste ne propose pas.
          placeholder={allowCreateTags === false ? "Buscar una etiqueta…" : undefined}
          testId="tags-multiselect"
          markPrimary
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

      {showPricing && isActivity ? (
        // Spec 43 (demande Jérôme du 2026-10-25) : par personne, par heure ou l'activité entière.
        <div className="flex flex-col gap-1">
          <Select
            fullWidth
            value={state.pricingUnit}
            onChange={(value) => state.setPricingUnit(asPricingUnit(value))}
          >
            <Label>Modo de precio</Label>
            <Select.Trigger data-testid="pricing-unit-select">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {PRICING_UNIT_OPTIONS.map((option) => (
                  <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                    {option.label}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          {pricingOption ? (
            <p className="text-xs text-muted" data-testid="pricing-unit-help">
              {pricingOption.description}
            </p>
          ) : null}
        </div>
      ) : null}

      {showPricing && hasPriceQtyFields ? (
        <div className="flex flex-col gap-2">
          <PriceTiersEditor
            label={isActivity ? priceLabel(pricingUnit) : undefined}
            allowTiers={allowsQty}
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
          {/* Bornes PAR RÉSERVATION (décision Jérôme du 2026-10-25) : plus de maximum pour un produit
              à cupo — seul le transport le garde —, plus de minimum pour un logement. Les anciens
              libellés « Huéspedes » d'un logement étaient faux : sa quantité compte des lits, des
              chambres ou des maisons, jamais des personnes. */}
          {(hasMinQty && allowsQty) || hasMaxQty ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {hasMinQty && allowsQty ? (
                <TextField value={state.minQty} onChange={state.setMinQty}>
                  <Label>{isActivity ? minQtyLabel(pricingUnit) : "Cantidad mínima por reserva — opcional"}</Label>
                  <Input type="number" min={1} data-testid="min-qty-input" />
                </TextField>
              ) : null}
              {hasMaxQty ? (
                <TextField value={state.maxQty} onChange={state.setMaxQty}>
                  <Label>Cantidad máxima por reserva — opcional</Label>
                  <Input type="number" min={1} data-testid="max-qty-input" />
                </TextField>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {showPricing && isActivity && pricingShowsPersons(pricingUnit) ? (
        // Spec 43 : simple mention sur la fiche (« De 1 a 10 personas ») — le client ne la saisit pas.
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField value={state.minPersons} onChange={state.setMinPersons}>
            <Label>Personas mínimas — opcional</Label>
            <Input type="number" min={1} data-testid="min-persons-input" />
          </TextField>
          <TextField value={state.maxPersons} onChange={state.setMaxPersons}>
            <Label>Personas máximas — opcional</Label>
            <Input type="number" min={1} data-testid="max-persons-input" />
          </TextField>
        </div>
      ) : null}

      {showPricing && isActivity && !pricingShowsDailyCapacity(pricingUnit) ? (
        <p className="text-xs text-muted" data-testid="per-hour-capacity-help">
          Por hora, las horas que se pueden reservar cada día son las de los horarios (franjas de 60
          minutos). La capacidad de cada franja es el número de embarcaciones o equipos: con 1, dos
          reservas nunca se cruzan.
        </p>
      ) : null}

      {showPricing && hasDefaultCapacity && (!isActivity || pricingShowsDailyCapacity(pricingUnit)) ? (
        <div className="flex flex-col gap-1.5">
          <TextField fullWidth name="default-capacity" value={state.defaultCapacity} onChange={state.setDefaultCapacity}>
            <Label>{isActivity ? dailyCapacityLabel(pricingUnit) : "Cupo diario por defecto — opcional"}</Label>
            <Input type="number" min={1} data-testid="default-capacity-input" />
          </TextField>
          <p className="text-xs text-muted" data-testid="default-capacity-help">
            Cuántas unidades hay disponibles cada día por defecto (antes de excepciones en el
            calendario). Un cliente puede reservar todo lo que queda en una sola reserva: no hay
            máximo por reserva.
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
          showDeposit={showAdminLodgingOptions}
        />
      ) : null}

      {isEvento ? (
        <EventoFields state={state} section={section} allowOnlineBookableConfig={allowOnlineBookableConfig} />
      ) : null}

      {showPricing && !isEvento && (showAdminLodgingOptions || !isLodging) ? (
        <VitrineFields state={state} />
      ) : null}

      {showPricing && showSlotRulesEditor && isActivity ? (
        <div className="flex flex-col gap-1.5">
          <Label>{pricingUnit === "per_hour" ? "Horarios — obligatorio, franjas de 60 minutos" : "Horarios — opcional"}</Label>
          <SlotRulesEditor rules={state.slotRules} onChange={state.setSlotRules} />
        </div>
      ) : null}
    </>
  );
}
