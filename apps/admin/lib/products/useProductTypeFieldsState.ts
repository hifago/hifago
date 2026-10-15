"use client";

import { useState } from "react";
import { tiersFromColumn, type PriceTier } from "@/lib/products/priceTiers";
import { groupDiscountFromColumns, type GroupDiscount } from "@/lib/products/groupDiscount";
import { emptyProgram, programFromColumn, type DraftProgram } from "@/lib/products/program";
import { emptyTransportInfo, type TransportInfoFields } from "@/lib/products/transportInfo";
import { emptyStayRates, stayRatesFromColumn, type DraftStayRates } from "@/lib/products/stayRates";
import { slotRulesFromColumn, type DraftSlotRule } from "@/lib/products/slotRules";
import { asLodgingKind, asLodgingUnit, type LodgingKind, type LodgingUnit } from "@hifago/domain";

// Correctif (spec 21, trouvé en vérifiant, sans lien avec elle — cf. productTypeGating.ts) :
// productTypeGating/ProductType/availabilityScreenFor vivent désormais dans un module SANS
// "use client" (ce fichier-ci le porte, pour son hook React) — un Server Component peut les
// importer directement. Réexportés ici pour ne casser aucun import client existant.
export { productTypeGating, availabilityScreenFor, type ProductType } from "@/lib/products/productTypeGating";

export type OccurrenceType = "once" | "recurring";
export type RecurrenceEndKind = "date" | "count" | "none";
export type PriceMode = "simple" | "tiers";

// "HH:MM:SS" (sérialisation Postgres d'une colonne time, ou payload d'une proposition qui la
// reprend telle quelle) → "HH:MM" (valeur attendue par <Input type="time">).
function toTimeInputValue(time: string | null | undefined): string {
  return time ? time.slice(0, 5) : "";
}

// Hydrate l'état depuis l'une de deux sources possibles, jamais les deux à la fois : un
// EditableProduct (colonnes réelles, ProductForm en mode édition) ou un payload de proposition de
// création (product_proposals.payload, ModerateProductCreationProposalForm) — même forme dans les
// deux cas puisque le payload est justement construit pour correspondre aux colonnes.
export type ProductTypeFieldsInit = {
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
  tagIds?: string[];
  // Équipements structurés d'un logement (migration 20260917110000) — même patron que tagIds :
  // liste d'ids, rattachée après l'insert en création admin directe (product-form.tsx), portée par
  // le payload (`amenity_ids`) dans une proposition socio depuis la migration 20261013151206.
  amenityIds?: string[];
  priceCop?: number | null;
  priceTiers?: unknown;
  minQty?: number | null;
  maxQty?: number | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  capacity?: number | null;
  // Nombre d'unités de ce type (3 cabañas, 8 lits) — descriptif, jamais un quota de réservation.
  // À ne pas confondre avec defaultCapacity, qui amorce product_availability (cf. migration
  // 20260827100000_products_unit_count.sql, qui détaille les trois colonnes voisines).
  unitCount?: number | null;
  // Nature du couchage (migration 20260827120000). Prérempli depuis LobbyPMS pour dorm/private ;
  // whole_house est toujours un choix manuel — Lobby n'a pas ce terme.
  lodgingKind?: LodgingKind | null;
  // Unité de PRIX (products.unit). Écrivable par l'application depuis 20260827140000 — elle ne
  // l'était par RIEN jusque-là, seul seed.sql la renseignait (défaut C4).
  unit?: LodgingUnit | null;
  defaultCapacity?: number | null;
  stayRates?: unknown;
  durationDays?: number | null;
  // Remise par seuil de remplissage cumulé (migration 20260914130000) — camp uniquement, colonne
  // group_discount_pct en fraction (0.20), converti en pourcentage lisible côté formulaire par
  // groupDiscountFromColumns (cf. groupDiscount.ts).
  groupDiscountThresholdQty?: number | null;
  groupDiscountPct?: number | null;
  // Programme jour par jour (migration 20260916130000) — camp uniquement. Forme de COLONNE
  // (liste plate [{day, text}]), regroupée par journée pour le formulaire par programFromColumn.
  program?: unknown;
  slotRules?: unknown;
  priceLabel?: string | null;
  occurrenceType?: OccurrenceType;
  occurrenceDate?: string | null;
  recurrenceFrequencyDays?: number | null;
  recurrenceEndDate?: string | null;
  recurrenceEndCount?: number | null;
  startTime?: string | null;
  durationMinutes?: number | null;
  externalBookingUrl?: string | null;
  // Spec 21 + refonte parcours partenaire ↔ Lobby (2026-08-25) — désormais dans
  // RawProductFieldsPayload/payloadToFieldsInit aussi : un socio peut proposer ces champs quand
  // l'établissement est connecté (choisis via LobbyOptionPicker, jamais une saisie libre), donc
  // l'écran de modération doit pouvoir les prérremplir pour la revue admin.
  lobbyCategoryId?: number | null;
  lobbyProductId?: number | null;
  // Evento réservable en ligne (2026-09-15) — chargés ET réécrits en édition (cf. product-form.tsx).
  // Les champs d'occurrence ci-dessus le sont aussi depuis le 2026-10-13 (eventoOccurrence.ts) :
  // il ne reste aucun champ evento « création seulement », hors l'URL de vitrine.
  onlineBookable?: boolean;
  eventoCapacityMode?: "unlimited" | "metered" | "rsvp" | null;
  isFree?: boolean;
  eventoPaymentMode?: "online" | "on_site" | null;
  eventoOccupiesResource?: boolean;
  // Transport informatif (migration 20260916150000, demande Jérôme du 2026-09-16). Regroupés dans
  // un seul objet d'état `transportInfo` (patron de `groupDiscount`/`stayRates`), mais déclarés
  // ici à plat parce que cet init reflète les COLONNES, pas la forme de l'état.
  // ⚠️ Le lieu de départ est `transportDepartureAddress`, PAS `address` : le trio générique n'est
  // plus utilisé pour ce type (cf. productTypeGating.ts).
  transportFirstDepartureTime?: string | null;
  transportLastDepartureTime?: string | null;
  transportSeatsPerDeparture?: number | null;
  transportDepartureAddress?: string | null;
  transportDepartureLat?: number | null;
  transportDepartureLon?: number | null;
  transportArrivalAddress?: string | null;
  transportArrivalLat?: number | null;
  transportArrivalLon?: number | null;
  transportContactPhone?: string | null;
};

// Extrait de ProductForm (spec 15) pour être consommé par deux rendus distincts du même gating par
// type — le formulaire (admin-direct ET socio-proposal) et l'écran de modération admin d'une
// proposition de création — sans jamais dupliquer la logique de champs par type à deux endroits
// (cf. journal 2026-08-17, décision Jérôme "extraire plutôt que dupliquer").
export function useProductTypeFieldsState(init: ProductTypeFieldsInit = {}) {
  const [address, setAddress] = useState(init.address ?? "");
  const [lat, setLat] = useState(init.lat != null ? String(init.lat) : "");
  const [lon, setLon] = useState(init.lon != null ? String(init.lon) : "");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(init.tagIds ?? []);
  const [selectedAmenityIds, setSelectedAmenityIds] = useState<string[]>(init.amenityIds ?? []);

  const hasInitialTiers = Array.isArray(init.priceTiers) && (init.priceTiers as unknown[]).length > 0;
  const [priceMode, setPriceMode] = useState<PriceMode>(hasInitialTiers ? "tiers" : "simple");
  const [priceCop, setPriceCop] = useState(init.priceCop != null ? String(init.priceCop) : "");
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>(() => tiersFromColumn(init.priceTiers));
  const [minQty, setMinQty] = useState(init.minQty != null ? String(init.minQty) : "");
  const [maxQty, setMaxQty] = useState(init.maxQty != null ? String(init.maxQty) : "");

  const [checkInTime, setCheckInTime] = useState(toTimeInputValue(init.checkInTime));
  const [checkOutTime, setCheckOutTime] = useState(toTimeInputValue(init.checkOutTime));
  const [capacity, setCapacity] = useState(init.capacity != null ? String(init.capacity) : "");
  const [unitCount, setUnitCount] = useState(init.unitCount != null ? String(init.unitCount) : "");
  // "" = « sin especificar ». La colonne est facultative : ne rien choisir est un état légitime,
  // pas un formulaire incomplet.
  const [lodgingKind, setLodgingKind] = useState<LodgingKind | "">(init.lodgingKind ?? "");
  const [unit, setUnit] = useState<LodgingUnit | "">(init.unit ?? "");
  const [defaultCapacity, setDefaultCapacity] = useState(
    init.defaultCapacity != null ? String(init.defaultCapacity) : "",
  );
  const [stayRates, setStayRates] = useState<DraftStayRates>(() =>
    init.stayRates ? stayRatesFromColumn(init.stayRates) : emptyStayRates(),
  );
  const [durationDays, setDurationDays] = useState(init.durationDays != null ? String(init.durationDays) : "");
  // Lazy initializer (comme groupDiscount juste en dessous) : programFromColumn parcourt le jsonb,
  // inutile de le refaire à chaque rendu.
  const [program, setProgram] = useState<DraftProgram>(() =>
    init.program === undefined ? emptyProgram() : programFromColumn(init.program),
  );
  const [groupDiscount, setGroupDiscount] = useState<GroupDiscount>(() =>
    groupDiscountFromColumns(init.groupDiscountThresholdQty, init.groupDiscountPct),
  );
  const [slotRules, setSlotRules] = useState<DraftSlotRule[]>(() => slotRulesFromColumn(init.slotRules));

  const [priceLabel, setPriceLabel] = useState(init.priceLabel ?? "");
  const [occurrenceType, setOccurrenceType] = useState<OccurrenceType>(init.occurrenceType ?? "once");
  const [occurrenceDate, setOccurrenceDate] = useState(init.occurrenceDate ?? "");
  const [recurrenceFrequencyDays, setRecurrenceFrequencyDays] = useState(
    init.recurrenceFrequencyDays != null ? String(init.recurrenceFrequencyDays) : "",
  );
  const [recurrenceEndKind, setRecurrenceEndKind] = useState<RecurrenceEndKind>(
    init.recurrenceEndDate ? "date" : init.recurrenceEndCount != null ? "count" : "none",
  );
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(init.recurrenceEndDate ?? "");
  const [recurrenceEndCount, setRecurrenceEndCount] = useState(
    init.recurrenceEndCount != null ? String(init.recurrenceEndCount) : "",
  );
  const [startTime, setStartTime] = useState(toTimeInputValue(init.startTime));
  const [durationMinutes, setDurationMinutes] = useState(
    init.durationMinutes != null ? String(init.durationMinutes) : "",
  );
  const [externalBookingUrl, setExternalBookingUrl] = useState(init.externalBookingUrl ?? "");
  const [lobbyCategoryId, setLobbyCategoryId] = useState(
    init.lobbyCategoryId != null ? String(init.lobbyCategoryId) : "",
  );
  const [lobbyProductId, setLobbyProductId] = useState(
    init.lobbyProductId != null ? String(init.lobbyProductId) : "",
  );
  // "none" tant que rien n'est choisi ; "picker" dès qu'une valeur existe (édition d'un produit
  // déjà lié) — jamais recalculé après le montage.
  //
  // Corrigé le 2026-08-26 : le défaut était "manual", ce qui faisait afficher un ID NUMÉRIQUE BRUT
  // à la place du nom de la catégorie dès qu'on rouvrait un produit lié — la seule information
  // vraiment utile (« à quoi suis-je lié ? ») était la seule qu'on ne montrait pas. En "picker",
  // LobbyOptionPicker résout l'id contre la liste réelle et affiche le nom, la capacité, la
  // description et les photos. "manual" reste accessible à l'admin via le sélecteur, comme
  // échappatoire pour saisir un id que la liste ne contiendrait pas.
  const [lobbyLinkMode, setLobbyLinkMode] = useState<"none" | "picker" | "manual">(() =>
    init.lobbyCategoryId != null || init.lobbyProductId != null ? "picker" : "none",
  );

  const [onlineBookable, setOnlineBookable] = useState(init.onlineBookable ?? false);
  const [eventoCapacityMode, setEventoCapacityMode] = useState<"unlimited" | "metered" | "rsvp" | "">(
    init.eventoCapacityMode ?? "",
  );
  const [isFree, setIsFree] = useState(init.isFree ?? false);
  const [eventoPaymentMode, setEventoPaymentMode] = useState<"online" | "on_site" | "">(
    init.eventoPaymentMode ?? "",
  );
  // Défaut à true, cohérent avec la colonne DB (not null default true) : un evento réservable
  // bloque par défaut le calendrier partagé du prestataire, désactivable au cas par cas.
  const [eventoOccupiesResource, setEventoOccupiesResource] = useState(init.eventoOccupiesResource ?? true);

  // Transport informatif (2026-09-16). Hydraté ICI plutôt que par une fonction `fromColumns` dans
  // transportInfo.ts : les deux heures arrivent en "HH:MM:SS" (sérialisation Postgres) et
  // `toTimeInputValue` vit déjà dans ce fichier — une 4e copie du `slice(0, 5)` n'aurait rien
  // apporté. Les heures restent des chaînes opaques de bout en bout, jamais un objet Date
  // (spec 18 §0).
  const [transportInfo, setTransportInfo] = useState<TransportInfoFields>(() => ({
    ...emptyTransportInfo(),
    firstDepartureTime: toTimeInputValue(init.transportFirstDepartureTime),
    lastDepartureTime: toTimeInputValue(init.transportLastDepartureTime),
    seatsPerDeparture:
      init.transportSeatsPerDeparture != null ? String(init.transportSeatsPerDeparture) : "",
    departureAddress: init.transportDepartureAddress ?? "",
    departureLat: init.transportDepartureLat != null ? String(init.transportDepartureLat) : "",
    departureLon: init.transportDepartureLon != null ? String(init.transportDepartureLon) : "",
    arrivalAddress: init.transportArrivalAddress ?? "",
    arrivalLat: init.transportArrivalLat != null ? String(init.transportArrivalLat) : "",
    arrivalLon: init.transportArrivalLon != null ? String(init.transportArrivalLon) : "",
    contactPhone: init.transportContactPhone ?? "",
  }));

  return {
    address, setAddress, lat, setLat, lon, setLon,
    selectedTagIds, setSelectedTagIds,
    selectedAmenityIds, setSelectedAmenityIds,
    priceMode, setPriceMode, priceCop, setPriceCop, priceTiers, setPriceTiers,
    minQty, setMinQty, maxQty, setMaxQty,
    checkInTime, setCheckInTime, checkOutTime, setCheckOutTime,
    capacity, setCapacity, unitCount, setUnitCount,
    lodgingKind, setLodgingKind, unit, setUnit,
    defaultCapacity, setDefaultCapacity, stayRates, setStayRates,
    durationDays, setDurationDays,
    groupDiscount, setGroupDiscount,
    program, setProgram,
    slotRules, setSlotRules,
    priceLabel, setPriceLabel,
    occurrenceType, setOccurrenceType,
    occurrenceDate, setOccurrenceDate,
    recurrenceFrequencyDays, setRecurrenceFrequencyDays,
    recurrenceEndKind, setRecurrenceEndKind,
    recurrenceEndDate, setRecurrenceEndDate,
    recurrenceEndCount, setRecurrenceEndCount,
    startTime, setStartTime,
    durationMinutes, setDurationMinutes,
    externalBookingUrl, setExternalBookingUrl,
    lobbyCategoryId, setLobbyCategoryId, lobbyProductId, setLobbyProductId,
    lobbyLinkMode, setLobbyLinkMode,
    onlineBookable, setOnlineBookable,
    eventoCapacityMode, setEventoCapacityMode,
    isFree, setIsFree,
    eventoPaymentMode, setEventoPaymentMode,
    eventoOccupiesResource, setEventoOccupiesResource,
    transportInfo, setTransportInfo,
  };
}

export type ProductTypeFieldsState = ReturnType<typeof useProductTypeFieldsState>;

// Forme brute (snake_case, miroir des colonnes réelles de `products`/du payload d'une proposition
// — les deux partagent les mêmes noms de clé) — DISTINCTE de ProductTypeFieldsInit (camelCase,
// forme attendue par useProductTypeFieldsState). Un mapping explicite est requis, jamais un cast :
// un oubli ici a déjà cassé silencieusement la pré-remplissage de ModerateProductCreationProposalForm
// (spec 15, journal 2026-08-17). Consommé par les écrans de modération (création ET édition), par
// l'édition socio (EditProposalForm) et, depuis le 2026-10-14, par ProductForm en mode édition : sa
// copie à la main de ce mapping avait oublié external_booking_url et group_discount_*, que
// l'enregistrement admin effaçait.
export type RawProductFieldsPayload = {
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
  tag_ids?: string[];
  // Équipements d'un logement dans une proposition (migration 20261013151206).
  amenity_ids?: string[];
  price_cop?: number | null;
  price_tiers?: unknown;
  min_qty?: number | null;
  max_qty?: number | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  capacity?: number | null;
  unit_count?: number | null;
  lodging_kind?: string | null;
  unit?: string | null;
  default_capacity?: number | null;
  stay_rates?: unknown;
  duration_days?: number | null;
  group_discount_threshold_qty?: number | null;
  group_discount_pct?: number | null;
  program?: unknown;
  slot_rules?: unknown;
  price_label?: string | null;
  // `string`, pas `OccurrenceType` : cette forme reçoit aussi la LIGNE `products` (colonne text),
  // et le payload d'une proposition est du jsonb libre — validé par `asOccurrenceType` plus bas.
  occurrence_type?: string | null;
  occurrence_date?: string | null;
  recurrence_frequency_days?: number | null;
  recurrence_end_date?: string | null;
  recurrence_end_count?: number | null;
  start_time?: string | null;
  duration_minutes?: number | null;
  external_booking_url?: string | null;
  lobby_category_id?: number | null;
  lobby_product_id?: number | null;
  // Evento réservable en ligne (2026-10-13). Jamais portés par une proposition (réglage admin, les
  // RPC les ignorent) : ils arrivent ici depuis la LIGNE `products`, pour que les écrans socio et
  // modération sachent qu'un evento se réserve en ligne — sans quoi ils affichaient un « Precio
  // (texto libre) » vide et reconstruisaient un payload d'evento vitrine par-dessus.
  online_bookable?: boolean | null;
  evento_capacity_mode?: string | null;
  is_free?: boolean | null;
  evento_payment_mode?: string | null;
  evento_occupies_resource?: boolean | null;
  // Transport informatif (2026-09-16). ⚠️ OBLIGATOIRE ici, pas seulement dans les RPC : les 3
  // écrans de modération hydratent l'état par `payloadToFieldsInit` PUIS reconstruisent le payload
  // (ModerateProductCreationProposalForm, ModerateProposalForm, EditProposalForm). Une clé non
  // mappée ci-dessous part donc à `null` dans le payload corrigé — les horaires et lieux proposés
  // par un socio seraient EFFACÉS à l'instant où l'admin approuve, sans erreur nulle part. C'est
  // exactement le défaut que l'en-tête de ce type raconte pour spec 15 / journal 2026-08-17.
  transport_first_departure_time?: string | null;
  transport_last_departure_time?: string | null;
  transport_seats_per_departure?: number | null;
  transport_departure_address?: string | null;
  transport_departure_lat?: number | null;
  transport_departure_lon?: number | null;
  transport_arrival_address?: string | null;
  transport_arrival_lat?: number | null;
  transport_arrival_lon?: number | null;
  transport_contact_phone?: string | null;
};

// Gardes de domaine, jamais des casts — même raison qu'`asLodgingKind` : une valeur hors domaine
// venue d'un jsonb libre ne sélectionnerait AUCUNE option, sans erreur de type.
function asOccurrenceType(value: unknown): OccurrenceType | undefined {
  return value === "once" || value === "recurring" ? value : undefined;
}

function asEventoCapacityMode(value: unknown): "unlimited" | "metered" | "rsvp" | null {
  return value === "unlimited" || value === "metered" || value === "rsvp" ? value : null;
}

function asEventoPaymentMode(value: unknown): "online" | "on_site" | null {
  return value === "online" || value === "on_site" ? value : null;
}

export function payloadToFieldsInit(payload: RawProductFieldsPayload): ProductTypeFieldsInit {
  return {
    address: payload.address,
    lat: payload.lat,
    lon: payload.lon,
    tagIds: payload.tag_ids,
    amenityIds: payload.amenity_ids,
    priceCop: payload.price_cop,
    priceTiers: payload.price_tiers,
    minQty: payload.min_qty,
    maxQty: payload.max_qty,
    checkInTime: payload.check_in_time,
    checkOutTime: payload.check_out_time,
    capacity: payload.capacity,
    unitCount: payload.unit_count,
    // asLodgingKind et non un cast : le payload d'une proposition est du jsonb libre, une valeur
    // hors domaine y arriverait sans erreur de type et ne sélectionnerait alors AUCUNE option.
    lodgingKind: asLodgingKind(payload.lodging_kind),
    unit: asLodgingUnit(payload.unit),
    defaultCapacity: payload.default_capacity,
    stayRates: payload.stay_rates,
    durationDays: payload.duration_days,
    groupDiscountThresholdQty: payload.group_discount_threshold_qty,
    groupDiscountPct: payload.group_discount_pct,
    program: payload.program,
    slotRules: payload.slot_rules,
    priceLabel: payload.price_label,
    occurrenceType: asOccurrenceType(payload.occurrence_type),
    occurrenceDate: payload.occurrence_date,
    recurrenceFrequencyDays: payload.recurrence_frequency_days,
    recurrenceEndDate: payload.recurrence_end_date,
    recurrenceEndCount: payload.recurrence_end_count,
    startTime: payload.start_time,
    durationMinutes: payload.duration_minutes,
    externalBookingUrl: payload.external_booking_url,
    lobbyCategoryId: payload.lobby_category_id,
    lobbyProductId: payload.lobby_product_id,
    onlineBookable: payload.online_bookable ?? undefined,
    eventoCapacityMode: asEventoCapacityMode(payload.evento_capacity_mode),
    isFree: payload.is_free ?? undefined,
    eventoPaymentMode: asEventoPaymentMode(payload.evento_payment_mode),
    eventoOccupiesResource: payload.evento_occupies_resource ?? undefined,
    transportFirstDepartureTime: payload.transport_first_departure_time,
    transportLastDepartureTime: payload.transport_last_departure_time,
    transportSeatsPerDeparture: payload.transport_seats_per_departure,
    transportDepartureAddress: payload.transport_departure_address,
    transportDepartureLat: payload.transport_departure_lat,
    transportDepartureLon: payload.transport_departure_lon,
    transportArrivalAddress: payload.transport_arrival_address,
    transportArrivalLat: payload.transport_arrival_lat,
    transportArrivalLon: payload.transport_arrival_lon,
    transportContactPhone: payload.transport_contact_phone,
  };
}
