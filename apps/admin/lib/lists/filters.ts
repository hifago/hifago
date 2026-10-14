import type { FilterDefinition } from "@hifago/domain";
import type { DataListFilter } from "@hifago/ui";
import type { ChipStyle } from "@/components/status-chip";
import { STATUS_LABELS, STATUS_CHIP_COLOR } from "@/app/admin/orders/statusLabels";
import { AUDIENCE_LABELS, CAMPAIGN_STATUS_LABELS, CHANNEL_LABELS } from "@/app/admin/campaigns/campaignLabels";
import { INVITATION_STATUS_LABELS, ONBOARDING_PATH_LABELS } from "@/app/admin/invitations/invitationLabels";
import { COMMISSION_STATE_LABELS } from "@/app/partner/(app)/commissions/commissionStateLabels";
import { LEDGER_STATUS_LABELS } from "@/app/admin/ledger/ledgerStatusLabels";

// docs/specs/10-listes-standardisees-admin-socio.md §5.3 — deux jeux de définitions par liste,
// volontairement séparés : `*_FILTER_DEFINITIONS` (packages/domain, kind text|enum|date) sert
// resolveFilterParams côté serveur (validation) ; `*_FILTERS` (packages/ui, kind text|select|date)
// sert ServerFilters côté rendu (label, options affichées). Les valeurs enum/options sont dérivées
// de la même source (STATUS_LABELS) pour ne jamais diverger entre validation et affichage.

export const ORDERS_FILTER_DEFINITIONS: FilterDefinition[] = [
  { kind: "enum", name: "status", allowed: Object.keys(STATUS_LABELS) },
  { kind: "date", name: "date_from" },
  { kind: "date", name: "date_to" },
  { kind: "text", name: "q" },
  // Spec 17 §0 Tranche 1 — jamais exposé dans ORDERS_FILTERS (pas de select dédié) : arrive
  // uniquement via le lien "voir les réservations de ce jour" posé sur une case du calendrier
  // produit (AvailabilityCalendar), pas un filtre que l'admin choisit dans l'UI de la liste.
  { kind: "text", name: "product_id" },
];

export const ORDERS_FILTERS: DataListFilter[] = [
  {
    kind: "select",
    name: "status",
    label: "Estado",
    allLabel: "Todos los estados",
    options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
  },
  { kind: "date", name: "date_from", label: "Desde" },
  { kind: "date", name: "date_to", label: "Hasta" },
  { kind: "text", name: "q", label: "Titular", placeholder: "Nombre del titular" },
];

// products.type — check constraint réel (products_type_check, dernière version
// supabase/migrations/20260817160000_calendar_tranche0_fixes.sql, qui retire 'tour' — vestige
// jamais créable depuis product-form.tsx, cf. docs/specs/17-calendrier-disponibilite-refonte.md
// §0 Tranche 0). Pas de traduction ES établie dans le projet pour ces 6 valeurs (la colonne "Tipo"
// de la liste affiche déjà la valeur brute telle quelle, cf. ProductsList.tsx) — le filtre reprend
// la même convention plutôt que d'inventer une traduction non tranchée.
export const PRODUCT_TYPES = ["lodging", "activity", "transport", "camp", "evento"] as const;

// Édition en ligne (2026-10-13) — libellé d'un type, partagé par la cellule éditable « Tipo » de
// la liste ET par son filtre : jusque-là la colonne et le filtre affichaient la valeur brute de la
// base (« activity »), que le formulaire de fiche, lui, traduisait déjà.
export const PRODUCT_TYPE_LABELS: Record<(typeof PRODUCT_TYPES)[number], string> = {
  lodging: "Alojamiento",
  activity: "Actividad",
  transport: "Transporte",
  camp: "Campamento",
  evento: "Evento",
};

// Revue admin catalogo (Jérôme, 2026-08-19) — labels/couleur extraits en constantes partagées
// (déjà utilisés en texte brut dans ProductsList.tsx: product.sellable ? "Publicado" : "Borrador")
// pour StatusChip, même convention que ESTABLISHMENT_STATUS_CHIP_STYLE/CLIENT_STAGE_CHIP_STYLE.
export const PRODUCT_SELLABLE_LABELS: Record<string, string> = {
  true: "Publicado",
  false: "Borrador",
};

export const PRODUCT_SELLABLE_CHIP_STYLE: Record<string, ChipStyle> = {
  true: { color: "success", variant: "soft" },
  false: { color: "default", variant: "soft" },
};

export const PRODUCTS_FILTER_DEFINITIONS: FilterDefinition[] = [
  { kind: "text", name: "q" },
  { kind: "enum", name: "type", allowed: PRODUCT_TYPES },
  { kind: "enum", name: "sellable", allowed: ["true", "false"] },
  // établissement — jamais une liste fermée à écrire en dur ici (contrairement à type/sellable) :
  // validé comme texte libre (un uuid), les options réelles du <select> sont construites à la
  // volée côté page.tsx (fetch de tous les établissements), pas dans ce fichier de constantes.
  { kind: "text", name: "establishment_id" },
  // Revue admin catalogo (Jérôme, 2026-08-19) — le dropdown ci-dessus reste plafonné à 10
  // établissements (les plus pertinents), donc pas exhaustif dès que le catalogue grandit : ce
  // champ texte est l'échappatoire pour chercher un établissement absent des 10 visibles, jamais
  // combiné avec establishment_id (l'un ou l'autre, jamais les deux — cf. page.tsx).
  { kind: "text", name: "establishment_q" },
  // Revue admin étiquettes (Jérôme, 2026-08-20) — jamais un champ du formulaire de filtres visible
  // (pas dans PRODUCTS_FILTERS ci-dessous, même statut que establishment_id) : posé uniquement par
  // le lien "Ver" de /admin/tags (id exact, jamais de saisie texte donc aucune question de
  // casse ici — cf. page.tsx pour le match par id via product_tag_assignments).
  { kind: "text", name: "tag_id" },
];

export const PRODUCTS_FILTERS: DataListFilter[] = [
  { kind: "text", name: "q", label: "Buscar por nombre", placeholder: "Nombre del producto" },
  {
    kind: "select",
    name: "type",
    label: "Tipo",
    allLabel: "Todos los tipos",
    options: PRODUCT_TYPES.map((type) => ({ value: type, label: PRODUCT_TYPE_LABELS[type] })),
  },
  {
    kind: "select",
    name: "sellable",
    label: "Estado",
    allLabel: "Todos los estados",
    options: Object.entries(PRODUCT_SELLABLE_LABELS).map(([value, label]) => ({ value, label })),
  },
];

export const CAMPAIGNS_FILTER_DEFINITIONS: FilterDefinition[] = [
  { kind: "text", name: "q" },
  { kind: "enum", name: "status", allowed: Object.keys(CAMPAIGN_STATUS_LABELS) },
  { kind: "enum", name: "audience", allowed: Object.keys(AUDIENCE_LABELS) },
  { kind: "enum", name: "channel", allowed: Object.keys(CHANNEL_LABELS) },
];

export const CAMPAIGNS_FILTERS: DataListFilter[] = [
  { kind: "text", name: "q", label: "Buscar por mensaje", placeholder: "Mensaje" },
  {
    kind: "select",
    name: "status",
    label: "Estado",
    allLabel: "Todos los estados",
    options: Object.entries(CAMPAIGN_STATUS_LABELS).map(([value, label]) => ({ value, label })),
  },
  {
    kind: "select",
    name: "audience",
    label: "Audiencia",
    allLabel: "Todas las audiencias",
    options: Object.entries(AUDIENCE_LABELS).map(([value, label]) => ({ value, label })),
  },
  {
    kind: "select",
    name: "channel",
    label: "Canal",
    allLabel: "Todos los canales",
    options: Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label })),
  },
];

// establishments.status ('active'|'archived') — même vocabulaire ES qu'ailleurs dans l'app
// (partner/(app)/page.tsx : Activo/Suspendido pour un autre statut, "Archivado" étendu ici pour
// la valeur propre à establishments/partners, absente de cette vocabulaire-là).
export const ESTABLISHMENT_STATUS_LABELS: Record<string, string> = {
  active: "Activo",
  archived: "Archivado",
};

// Revue admin établissements (Jérôme, 2026-08-19) — couleur du StatusChip principal de la liste,
// cohérent avec le mapping déjà en place côté socio (EstablishmentsGrid.tsx). Les 2 indicateurs
// additionnels (proposition en attente / partenaire non opérationnel) ont leur propre couleur
// fixe (warning/danger) posée directement dans EstablishmentStatusCell — pas de nouvelle valeur
// de statut, ce sont des signaux calculés, pas des états de establishments.status.
export const ESTABLISHMENT_STATUS_CHIP_STYLE: Record<string, ChipStyle> = {
  active: { color: "success", variant: "soft" },
  archived: { color: "default", variant: "soft" },
};

export const ESTABLISHMENTS_FILTER_DEFINITIONS: FilterDefinition[] = [
  { kind: "text", name: "q" },
  { kind: "enum", name: "status", allowed: Object.keys(ESTABLISHMENT_STATUS_LABELS) },
];

// "Operado directamente" retiré (Jérôme, 2026-08-19) — jamais un filtre existant en V1 non plus,
// aucune fonctionnalité perdue. Recherche élargie au nom du partenaire (list_establishments_admin
// RPC, cf. page.tsx) : un or=() PostgREST ne peut pas combiner une colonne de la table de base
// avec une colonne d'une relation embarquée, d'où la RPC dédiée plutôt qu'un simple .ilike().
export const ESTABLISHMENTS_FILTERS: DataListFilter[] = [
  {
    kind: "text",
    name: "q",
    label: "Buscar por nombre o partner",
    placeholder: "Nombre del establecimiento o del partner",
  },
  {
    kind: "select",
    name: "status",
    label: "Estado",
    allLabel: "Todos los estados",
    options: Object.entries(ESTABLISHMENT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
  },
];

export const INVITATIONS_FILTER_DEFINITIONS: FilterDefinition[] = [
  { kind: "text", name: "q" },
  { kind: "enum", name: "status", allowed: Object.keys(INVITATION_STATUS_LABELS) },
  { kind: "enum", name: "path", allowed: Object.keys(ONBOARDING_PATH_LABELS) },
];

export const INVITATIONS_FILTERS: DataListFilter[] = [
  { kind: "text", name: "q", label: "Código", placeholder: "Código promocional" },
  {
    kind: "select",
    name: "status",
    label: "Estado",
    allLabel: "Todos los estados",
    options: Object.entries(INVITATION_STATUS_LABELS).map(([value, label]) => ({ value, label })),
  },
  {
    kind: "select",
    name: "path",
    label: "Tipo",
    allLabel: "Todos los tipos",
    options: Object.entries(ONBOARDING_PATH_LABELS).map(([value, label]) => ({ value, label })),
  },
];

// partner_capabilities.role ('referrer'|'operator'|'admin') — mêmes libellés Referente/Prestador
// déjà en place sur le dashboard socio (partner/(app)/page.tsx, ROLE_LABELS) ; "admin" n'y figure
// pas (rôle jamais affiché côté socio), ajouté ici pour ce filtre admin uniquement.
const PARTNER_ROLE_LABELS: Record<string, string> = {
  referrer: "Referente",
  operator: "Prestador",
  admin: "Admin",
};

// lat/lon/radius_km/location_label : jamais rendus par ServerFilters générique (packages/ui) —
// gérés à la main par PartnersFilterBar.tsx, qui géocode côté client avant de naviguer. Présents
// ici uniquement pour que resolveFilterParams les valide/les laisse traverser vers la RPC.
// location_label ne va jamais à la RPC (lat/lon suffisent) : sert seulement à réafficher le texte
// tapé dans "Buscar ubicación" après un aller-retour serveur, que lat/lon seuls ne permettent pas
// de reconstruire.
export const PARTNERS_FILTER_DEFINITIONS: FilterDefinition[] = [
  { kind: "text", name: "q" },
  { kind: "enum", name: "role", allowed: Object.keys(PARTNER_ROLE_LABELS) },
  { kind: "text", name: "city" },
  { kind: "text", name: "lat" },
  { kind: "text", name: "lon" },
  { kind: "enum", name: "radius_km", allowed: ["5", "10", "20", "50"] },
  { kind: "text", name: "location_label" },
];

export const PARTNERS_FILTERS: DataListFilter[] = [
  { kind: "text", name: "q", label: "Buscar por nombre o email", placeholder: "Nombre o email" },
  {
    kind: "select",
    name: "role",
    label: "Rol activo",
    allLabel: "Todos los roles",
    options: Object.entries(PARTNER_ROLE_LABELS).map(([value, label]) => ({ value, label })),
  },
  { kind: "text", name: "city", label: "Ciudad", placeholder: "Ciudad" },
];

// Paliers de rayon proposés pour "Buscar ubicación" (PartnersFilterBar.tsx) — 20km par défaut.
export const PARTNER_RADIUS_KM_OPTIONS = ["5", "10", "20", "50"] as const;
export const PARTNER_DEFAULT_RADIUS_KM = "20";

// order_lines (vue "Mis reservas" prestataire, refonte 2026-08-19) — date_from/date_to reçoivent un
// défaut "semaine à venir" côté page.tsx quand absents de l'URL (pas ici : resolveFilterParams ne
// connaît que la validation de forme, jamais une valeur par défaut métier). holder_email n'existe
// comme filtre que depuis la migration 20260819180000 (order_lines.holder_email désormais exposée
// au prestataire sur ses propres établissements).
// Retour Jérôme (2026-08-20) — "Actividad" devient une sélection exacte (combobox avec recherche,
// cf. ReservationsFilterBar.tsx) au lieu d'un texte libre : product_name (ilike) remplacé par
// product_id (égalité). "Cliente"/"Email del cliente" fusionnés en un seul champ holder_q (l'un OU
// l'autre, cf. page.tsx). Nouveau filtre status (mêmes valeurs qu'admin/orders, order_lines.status
// est la même colonne). Toolbar entièrement custom (pas ServerFilters générique, comme
// PartnersFilterBar) : RESERVATIONS_FILTERS n'a plus de raison d'exister, seule
// RESERVATIONS_FILTER_DEFINITIONS reste (validation server-side des query params par
// resolveListParams).
export const RESERVATIONS_FILTER_DEFINITIONS: FilterDefinition[] = [
  { kind: "date", name: "date_from" },
  { kind: "date", name: "date_to" },
  { kind: "text", name: "product_id" },
  { kind: "text", name: "holder_q" },
  { kind: "enum", name: "status", allowed: Object.keys(STATUS_LABELS) },
];

// Filtres date/état demandés par Jérôme (2026-08-20) sur /partner/commissions — seule liste
// socio dont les filtres tiennent entièrement dans les 3 kinds natifs de ServerFilters (date/date/
// select), contrairement à RESERVATIONS_FILTERS ci-dessus (combobox activité => toolbar custom
// obligatoire) : COMMISSIONS_FILTERS suffit donc ici, pas de barre custom à écrire.
export const COMMISSIONS_FILTER_DEFINITIONS: FilterDefinition[] = [
  { kind: "date", name: "date_from" },
  { kind: "date", name: "date_to" },
  { kind: "enum", name: "status", allowed: Object.keys(COMMISSION_STATE_LABELS) },
];

export const COMMISSIONS_FILTERS: DataListFilter[] = [
  { kind: "date", name: "date_from", label: "Desde" },
  { kind: "date", name: "date_to", label: "Hasta" },
  {
    kind: "select",
    name: "status",
    label: "Estado",
    allLabel: "Todos los estados",
    options: Object.entries(COMMISSION_STATE_LABELS).map(([value, label]) => ({ value, label })),
  },
];

export const TAGS_FILTER_DEFINITIONS: FilterDefinition[] = [{ kind: "text", name: "q" }];

export const TAGS_FILTERS: DataListFilter[] = [
  { kind: "text", name: "q", label: "Buscar por nombre", placeholder: "Nombre de la etiqueta" },
];

// Revue admin clientes (Jérôme, 2026-08-19) — order_lines.status en ChipStyle, dérivé de
// STATUS_CHIP_COLOR (orders/statusLabels.ts) plutôt que redéfini à la main : toute évolution de la
// couleur de référence se propage automatiquement, zéro valeur dupliquée.
export const ORDER_LINE_STATUS_CHIP_STYLE: Record<string, ChipStyle> = Object.fromEntries(
  Object.entries(STATUS_CHIP_COLOR).map(([status, color]) => [status, { color, variant: "soft" as const }])
);

// client_stage — état DÉRIVÉ par client (pas order_lines.status brut), calculé par la RPC
// list_clients : un client agrège plusieurs commandes à statuts potentiellement différents, filtrer
// sur "au moins une ligne dans cet état" n'aurait pas de sens intuitif à ce niveau (même travers que
// le filtre date/activité déjà écarté par Jérôme pour cette liste). Le stade le plus "actif" présent
// l'emporte — même concept que le `stageOf` du back-office V1 (jamais exposé comme un vrai filtre
// là-bas, juste un badge d'affichage).
export const CLIENT_STAGE_LABELS: Record<string, string> = {
  proxima: "Próxima",
  en_casa: "En casa",
  pasada: "Pasada",
  cancelada: "Cancelada",
};

export const CLIENT_STAGE_CHIP_STYLE: Record<string, ChipStyle> = {
  proxima: { color: "accent", variant: "soft" },
  en_casa: { color: "success", variant: "soft" },
  pasada: { color: "default", variant: "soft" },
  cancelada: { color: "danger", variant: "soft" },
};

export const CLIENTS_FILTER_DEFINITIONS: FilterDefinition[] = [
  { kind: "text", name: "q" },
  { kind: "enum", name: "status", allowed: Object.keys(CLIENT_STAGE_LABELS) },
];

// Champ "email" séparé retiré (Jérôme, 2026-08-19) : q cherche déjà nom ET email (list_clients),
// la demande explicite était un seul champ combiné — le second champ était redondant.
// Refonte /admin/ledger (DataList) — pas de LEDGER_FILTERS déclaratif (ServerFilters générique) :
// toolbar entièrement custom (LedgerFilterBar.tsx), même raison que RESERVATIONS_FILTER_DEFINITIONS
// ci-dessus (Referente/Establecimiento sont des combobox recherchables, état React, jamais un
// <select> natif). referrer_partner_id/establishment_id restent en `text` (un uuid, pas une liste
// fermée) — même convention que establishment_id sur PRODUCTS_FILTER_DEFINITIONS.
export const LEDGER_FILTER_DEFINITIONS: FilterDefinition[] = [
  { kind: "date", name: "date_from" },
  { kind: "date", name: "date_to" },
  { kind: "enum", name: "status", allowed: Object.keys(LEDGER_STATUS_LABELS) },
  { kind: "enum", name: "type", allowed: PRODUCT_TYPES },
  { kind: "text", name: "referrer_partner_id" },
  { kind: "text", name: "establishment_id" },
];

export const CLIENTS_FILTERS: DataListFilter[] = [
  { kind: "text", name: "q", label: "Buscar por nombre o email", placeholder: "Nombre o email" },
  {
    kind: "select",
    name: "status",
    label: "Estado",
    allLabel: "Todos los estados",
    options: Object.entries(CLIENT_STAGE_LABELS).map(([value, label]) => ({ value, label })),
  },
];
