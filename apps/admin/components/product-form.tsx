"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { slugify } from "@/lib/utils";
import { asLocalizedField } from "@hifago/domain";
import type { Json, TablesInsert, TablesUpdate } from "@hifago/supabase/database.types";
import { Button, Card, Label, ListBox, Select, toast } from "@hifago/ui";
import { type TagOption } from "@/components/tags-multiselect";
import { LocalizedTextField, type LocalizedValue } from "@/components/localized-text-field";
import { ProductTypeFields } from "@/components/product-type-fields";
import type { LobbyRoomOption } from "@/components/lobby-option-picker";
import { StagedProductPhotos, type StagedPhoto } from "@/components/product-photos-staged";
import { ActionConfirmation } from "@/components/action-confirmation";
import { WizardStepper } from "@/components/wizard-stepper";
import {
  requiredContextStepError,
  requiredDetailsStepError,
  requiredPricingStepError,
} from "@/lib/products/productFormRequiredFields";
import { toSlotRuleRows } from "@/lib/products/slotRules";
import { buildProductCreationPayload } from "@/lib/products/productCreationPayload";
import { buildProductEditPayload } from "@/lib/products/productEditPayload";
import { mergeLobbyRoom } from "@/lib/products/lobbyRoomImport";
import { asLodgingKind, asLodgingUnit } from "@hifago/domain";
import {
  productTypeGating,
  useProductTypeFieldsState,
  type ProductType,
} from "@/lib/products/useProductTypeFieldsState";

type Establishment = {
  id: string;
  name: unknown;
  partner_id: string;
  lobby_connector_active?: boolean | null;
  lobby_has_token?: boolean | null;
};

export type EditableProduct = {
  id: string;
  name: unknown;
  description: unknown;
  address: string | null;
  lat: number | null;
  lon: number | null;
  price_cop: number | null;
  price_tiers: unknown;
  min_qty: number | null;
  max_qty: number | null;
  check_in_time: string | null;
  check_out_time: string | null;
  capacity: number | null;
  unit_count: number | null;
  lodging_kind: string | null;
  unit: string | null;
  default_capacity: number | null;
  stay_rates: unknown;
  // Programme jour par jour d'un camp (spec 37) : lu ici ET réécrit dans l'update() plus bas.
  program: unknown;
  // Durée persistée — lue UNIQUEMENT pour alimenter campDurationDays (nombre de journées ouvertes
  // par l'éditeur de programme), jamais réinjectée dans l'input « Duración (días) » ni réécrite :
  // apps/web/lib/orders/formatLineSchedule.ts la relit pour dater des commandes déjà payées.
  duration_days: number | null;
  type: string;
  establishment_id: string;
  lobby_category_id: number | null;
  lobby_product_id: number | null;
  // Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — statut du connecteur de l'établissement
  // parent, nécessaire en édition pour savoir si le picker (vs saisie manuelle) doit s'afficher.
  lobby_connector_active?: boolean | null;
  lobby_has_token?: boolean | null;
  // Evento réservable en ligne (2026-09-15) — contrairement aux autres champs evento (price_label,
  // occurrence_*…, "gap préexistant, création seulement" ci-dessus), ceux-ci sont réellement
  // éditables : chargés ici ET réécrits dans l'update() plus bas.
  online_bookable: boolean;
  evento_capacity_mode: string | null;
  is_free: boolean;
  evento_payment_mode: string | null;
  evento_occupies_resource: boolean;
  // Transport informatif (migration 20260916150000). Chargés ici ET réécrits dans l'update() plus
  // bas, comme les champs evento réservable — pas le gap « création seulement » de
  // duration_days/group_discount_*. ⚠️ Le lieu de départ est `transport_departure_address`, pas
  // `address` : le trio générique n'est plus exposé pour ce type.
  transport_first_departure_time: string | null;
  transport_last_departure_time: string | null;
  transport_seats_per_departure: number | null;
  transport_departure_address: string | null;
  transport_departure_lat: number | null;
  transport_departure_lon: number | null;
  transport_arrival_address: string | null;
  transport_arrival_lat: number | null;
  transport_arrival_lon: number | null;
  transport_contact_phone: string | null;
};

// Spec 15 — variant "socio-proposal" : un socio ne peut jamais écrire products directement (RLS
// admin-only, jamais étendue), donc handleSubmit appelle submit_product_creation_proposal au lieu
// d'insérer, et attend une modération avant que la fiche existe réellement. Mêmes 3 codes
// "not_found"/"suspended"/"invalid" que les autres RPC de proposition du projet.
const SUBMIT_ERRORS: Record<string, string> = {
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
  establishment_not_found: "No se encontró el establecimiento seleccionado.",
  capability_suspended: "Tu capacidad de operador para este establecimiento no está activa.",
  invalid_type: "Tipo de producto no válido.",
  name_required: "El nombre es obligatorio.",
  // pending_creation_exists retiré côté serveur (2026-08-18) : un socio peut désormais proposer
  // plusieurs créations en attente sur le même establecimiento, cf. 20260818110000_
  // product_creation_review_ux.sql — cette raison n'est plus jamais renvoyée par la RPC.
  pending_cap_exceeded: "Tienes demasiadas propuestas pendientes de revisión.",
};

// Un seul endroit pour le nom du type en espagnol (genre inclus) — le bouton de soumission, le
// toast de création et l'écran de confirmation en dérivent tous, plutôt que 3 ternaires
// indépendantes. Corrige au passage un bug préexistant : aucune des 3 ternaires d'origine n'avait
// de branche « camp », qui retombait silencieusement sur « actividad ».
const PRODUCT_TYPE_NOUN: Record<ProductType, { label: string; withArticle: string; feminine: boolean }> = {
  activity: { label: "actividad", withArticle: "la actividad", feminine: true },
  evento: { label: "evento", withArticle: "el evento", feminine: false },
  camp: { label: "campamento", withArticle: "el campamento", feminine: false },
  lodging: { label: "alojamiento", withArticle: "el alojamiento", feminine: false },
  transport: { label: "transporte", withArticle: "el transporte", feminine: false },
};

function entityNoun(type: ProductType): string {
  return PRODUCT_TYPE_NOUN[type].withArticle;
}

// Spec 11 — un seul composant pour la création ET l'édition d'un produit (fusionne
// NewProductForm.tsx/EditProductForm.tsx, supprimés) : `product` absent = création, présent =
// édition. Établissement/type restent création-only (immuables après création, comportement
// préexistant) ; les champs evento/camp restent création-only (gap préexistant, jamais éditables
// aujourd'hui, hors scope Jérôme — "on va rester encore sur une activité"). Nom/description/lieu/
// prix-tramos/min-max deviennent identiques dans les deux modes — c'est le cœur du fix demandé.
// Photos/tags/créneaux sont "stagés" en création (rattachés au produit dans le MÊME clic de
// soumission que l'insert, cf. handleSubmit) et délégués en édition à des blocs séparés à
// sauvegarde immédiate rendus par la page (ProductPhotosBlock/ProductTagsBlock/
// ProductSlotRulesBlock), jamais par ce composant.
//
// Spec 15 — variant "socio-proposal" (nouveau, création seulement — `product` toujours absent dans
// ce variant) : mêmes champs, même gating par type (délégué à ProductTypeFields, extrait de ce
// fichier pour être aussi consommé par ModerateProductCreationProposalForm côté admin — décision
// Jérôme "extraire plutôt que dupliquer", cf. journal 2026-08-17). Photos du produit incluses dès
// la proposition (StagedProductPhotos, révision Jérôme du même jour — cf. cahier des charges socio
// §3e "jusqu'à 6 photos") : uploadées immédiatement vers Storage (même Route Handler qu'admin-
// direct), seul storage_path traverse la proposition, rattachées à product_media par
// create_product_from_proposal à l'approbation. Seules différences restantes avec le variant
// admin : écriture via RPC (proposition modérée) au lieu d'un insert direct, et TagsMultiSelect
// sans création de tag à la volée (catalog_tags reste en écriture admin-only).
export function ProductForm({
  establishments = [],
  initialEstablishmentId = "",
  allTags = [],
  allAmenities = [],
  product,
  variant = "admin",
}: {
  establishments?: Establishment[];
  initialEstablishmentId?: string;
  allTags?: TagOption[];
  // Équipements structurés (migration 20260917110000) — stagés à la création ADMIN uniquement
  // (jamais pour variant "socio-proposal", cf. le commentaire de showAmenities dans
  // product-type-fields.tsx). En édition, ce prop n'est pas lu : ProductAmenitiesBlock (rendu par
  // la page) reprend la main avec son propre chargement.
  allAmenities?: TagOption[];
  product?: EditableProduct;
  variant?: "admin" | "socio-proposal";
}) {
  const router = useRouter();
  const isEditing = Boolean(product);

  const [establishmentId, setEstablishmentId] = useState(initialEstablishmentId);
  const [type, setType] = useState<ProductType>((product?.type as ProductType) ?? "activity");
  const [name, setName] = useState<LocalizedValue>(() => ({ ...(asLocalizedField(product?.name) ?? {}) }));
  const [description, setDescription] = useState<LocalizedValue>(() => ({
    ...(asLocalizedField(product?.description) ?? {}),
  }));

  const fields = useProductTypeFieldsState(
    product
      ? {
          address: product.address,
          lat: product.lat,
          lon: product.lon,
          priceCop: product.price_cop,
          priceTiers: product.price_tiers,
          minQty: product.min_qty,
          maxQty: product.max_qty,
          checkInTime: product.check_in_time,
          checkOutTime: product.check_out_time,
          capacity: product.capacity,
          unitCount: product.unit_count,
          lodgingKind: asLodgingKind(product.lodging_kind),
          unit: asLodgingUnit(product.unit),
          defaultCapacity: product.default_capacity,
          stayRates: product.stay_rates,
          program: product.program,
          lobbyCategoryId: product.lobby_category_id,
          lobbyProductId: product.lobby_product_id,
          onlineBookable: product.online_bookable,
          eventoCapacityMode: product.evento_capacity_mode as "unlimited" | "metered" | "rsvp" | null,
          isFree: product.is_free,
          eventoPaymentMode: product.evento_payment_mode as "online" | "on_site" | null,
          eventoOccupiesResource: product.evento_occupies_resource,
          transportFirstDepartureTime: product.transport_first_departure_time,
          transportLastDepartureTime: product.transport_last_departure_time,
          transportSeatsPerDeparture: product.transport_seats_per_departure,
          transportDepartureAddress: product.transport_departure_address,
          transportDepartureLat: product.transport_departure_lat,
          transportDepartureLon: product.transport_departure_lon,
          transportArrivalAddress: product.transport_arrival_address,
          transportArrivalLat: product.transport_arrival_lat,
          transportArrivalLon: product.transport_arrival_lon,
          transportContactPhone: product.transport_contact_phone,
        }
      : undefined,
  );
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Assistant par étapes (docs/specs/40) — création seulement (`stepIndex` reste à 0, jamais
  // affiché, en édition). 3 étapes toujours : "Comercialización" existe même pour evento (son
  // propre bloc réservation/tarification dans EventoFields), ce n'est jamais une étape en moins.
  const [stepIndex, setStepIndex] = useState(0);
  const STEP_TITLES = ["Establecimiento y tipo", "Detalles", "Comercialización"];

  // Écran de fin de parcours (§4 du plan) — remplace le wizard/les cartes le temps que
  // l'utilisateur choisit son prochain geste ; `null` = formulaire affiché normalement.
  const [confirmation, setConfirmation] = useState<{
    status: "success" | "pending";
    title: string;
    body: string;
    actionLabel: string;
    onAction: () => void;
  } | null>(null);

  const {
    isEvento, isCamp, isActivity, isLodging, isTransport, hasPriceQtyFields,
  } = productTypeGating(type);

  // Valeurs partagées entre la validation par étape (goNext) et la soumission finale
  // (handleSubmit) — calculées une seule fois, jamais dupliquées entre les deux.
  const nombreEs = name.es?.trim() ?? "";
  const price = Number(fields.priceCop);
  const usesTiers = hasPriceQtyFields && fields.priceMode === "tiers";
  // MIROIR EXACT de la contrainte `products_price_cop_required_unless_vitrine` (2026-09-08) : un
  // evento OU une offre en vitrine (URL externe posée) est dispensé de prix chiffré.
  const enVitrina = Boolean(fields.externalBookingUrl.trim());
  const eventoOnlinePaid = isEvento && fields.onlineBookable && !fields.isFree;
  const needsOwnPrice = (!isEvento && !enVitrina) || eventoOnlinePaid;

  function validateStep(index: number): string | null {
    if (index === 0) {
      return requiredContextStepError({
        isEditing,
        hasEstablishment: Boolean(establishments.find((item) => item.id === establishmentId)),
        nombreEs,
      });
    }
    if (index === 1) {
      return requiredDetailsStepError({
        isEditing,
        isCamp,
        isTransport,
        isEvento,
        isLodging,
        program: fields.program,
        durationDaysInput: fields.durationDays,
        persistedDurationDays: product?.duration_days ?? null,
        transportInfo: fields.transportInfo,
        occurrenceType: fields.occurrenceType,
        occurrenceDate: fields.occurrenceDate,
        recurrenceFrequencyDays: fields.recurrenceFrequencyDays,
        capacity: fields.capacity,
        unitCount: fields.unitCount,
      });
    }
    return requiredPricingStepError({
      isEditing,
      isEvento,
      isCamp,
      isActivity,
      isLodging,
      hasPriceQtyFields,
      needsOwnPrice,
      usesTiers,
      price,
      priceLabel: fields.priceLabel,
      onlineBookable: fields.onlineBookable,
      eventoCapacityMode: fields.eventoCapacityMode,
      defaultCapacity: fields.defaultCapacity,
      isFree: fields.isFree,
      eventoPaymentMode: fields.eventoPaymentMode,
      groupDiscount: fields.groupDiscount,
      slotRules: fields.slotRules,
      priceTiers: fields.priceTiers,
      minQty: fields.minQty,
      maxQty: fields.maxQty,
      stayRates: fields.stayRates,
      externalBookingUrl: fields.externalBookingUrl,
    });
  }

  function goNext() {
    const error = validateStep(stepIndex);
    if (error) {
      toast.danger(error);
      return;
    }
    setStepIndex((current) => Math.min(current + 1, STEP_TITLES.length - 1));
  }

  function goPrev() {
    setStepIndex((current) => Math.max(current - 1, 0));
  }

  // Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — en édition, le statut vient directement
  // du produit (join établissement fait par la page appelante) ; en création, de l'établissement
  // actuellement sélectionné dans le combobox ci-dessous.
  const selectedEstablishment = establishments.find((item) => item.id === establishmentId);
  const establishmentLobbyConnected = isEditing
    ? Boolean(product?.lobby_connector_active && product?.lobby_has_token)
    : Boolean(selectedEstablishment?.lobby_connector_active && selectedEstablishment?.lobby_has_token);
  const activeEstablishmentId = isEditing ? product?.establishment_id : establishmentId;
  // Arbitrage Jérôme du 2026-08-26 — « import à la liaison ». Lobby PROPOSE, hifago fait foi.
  //
  // La POLITIQUE (quel champ Lobby a le droit d'écraser, et lequel jamais) vit dans
  // lib/products/lobbyRoomImport.ts, pure et testée — c'est une règle métier, pas du câblage de
  // formulaire, et elle était intestable tant qu'elle restait enfermée ici. Ce qui reste dans ce
  // composant est ce qu'une fonction pure ne peut pas faire : appeler le serveur pour les photos.
  //
  // Les setters sont appliqués SANS condition : mergeLobbyRoom renvoie les valeurs inchangées par
  // référence, donc React ne re-rend rien pour les champs que Lobby ne renseigne pas (comportement
  // couvert par lobbyRoomImport.test.ts, pour qu'on ne remette pas ici les `if` qu'on en a sortis).
  async function applyLobbyRoomData(data: LobbyRoomOption) {
    const next = mergeLobbyRoom(
      {
        name,
        description,
        capacity: fields.capacity,
        unitCount: fields.unitCount,
        lodgingKind: fields.lodgingKind,
        unit: fields.unit,
      },
      data,
    );
    setName(next.name);
    setDescription(next.description);
    fields.setCapacity(next.capacity);
    fields.setUnitCount(next.unitCount);
    fields.setLodgingKind(next.lodgingKind);
    fields.setUnit(next.unit);

    // Les photos ne peuvent pas être « recopiées » comme un texte : il faut aller les chercher chez
    // Lobby côté serveur (téléchargement, décodage, réécriture dans Storage), ce qu'un formulaire
    // navigateur ne sait pas faire. Retour Jérôme du 2026-08-26 — « à la proposition il faut les
    // lier les images » : en création/proposition le produit n'existe pas encore, la route renvoie
    // donc des storage_path qu'on range dans les photos EN ATTENTE. Elles voyagent alors dans
    // payload.photos[] et sont rattachées à l'approbation par create_product_from_proposal, comme
    // n'importe quelle photo uploadée à la main. En édition, c'est ImportLobbyPhotosBlock (admin,
    // produit existant) qui s'en charge — jamais ce chemin, d'où la sortie anticipée.
    if (isEditing || !activeEstablishmentId || data.photoUrls.length === 0) return;

    try {
      const response = await fetch("/api/pms/import-room-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          establishmentId: activeEstablishmentId,
          categoryId: data.id,
          alreadyStaged: stagedPhotos.length,
        }),
      });
      const result = (await response.json()) as
        | { ok: true; photos: StagedPhoto[]; reason?: string }
        | { ok: false; reason: string };

      if (!result.ok) {
        toast.danger("No se pudieron importar las fotos de LobbyPMS.");
        return;
      }
      if (result.photos.length === 0) {
        // Lobby n'a pas de photo : la carte de prévisualisation le dit déjà, inutile d'en remettre
        // une couche. Une galerie pleine, en revanche, est une raison qu'il faut nommer.
        if (result.reason === "gallery_full") toast.danger("La galería ya tiene 6 fotos.");
        return;
      }
      setStagedPhotos((current) => [...current, ...result.photos]);
      toast.success(`${result.photos.length} foto(s) importada(s) de LobbyPMS.`);
    } catch {
      toast.danger("No se pudieron importar las fotos de LobbyPMS.");
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    // Les 3 étapes sont revalidées ici dans l'ordre (pas seulement au moment de « Siguiente ») :
    // même garantie qu'avant l'assistant, zéro règle dupliquée entre navigation par étape et
    // soumission finale (cf. productFormRequiredFields.ts).
    for (let index = 0; index < STEP_TITLES.length; index += 1) {
      const error = validateStep(index);
      if (error) {
        toast.danger(error);
        if (!isEditing) setStepIndex(index);
        return;
      }
    }

    setIsSubmitting(true);
    const supabase = createClient();

    if (isEditing && product) {
      // Dédoublonnage payload d'édition (chantier 2026-09-17) : cet update() construisait son
      // propre objet à la main, en dérive lente mais réelle de productEditPayload.ts (seul autre
      // écrivain du même payload jsonb, côté proposition) — deux bugs vivants trouvés en les
      // comparant (lobby_category_id/lobby_product_id absents là-bas, group_discount_* absents
      // ici). Une seule fonction désormais, testée par payloadParity.test.ts.
      const editPayload = buildProductEditPayload(type, name, description, fields);
      const { error: updateError } = await supabase
        .from("products")
        .update(editPayload as TablesUpdate<"products">)
        .eq("id", product.id);

      if (updateError) {
        toast.danger("No se pudo guardar la actividad.");
        setIsSubmitting(false);
        return;
      }

      // Evento réservable en ligne, mode 'metered' (2026-09-15) — même discipline non bloquante
      // qu'à la création : un échec ne remet jamais en cause la sauvegarde déjà confirmée ci-dessus.
      // on conflict do nothing côté RPC : rappeler ici à chaque édition (même si déjà provisionné)
      // reste idempotent, jamais une double écriture.
      if (isEvento && fields.onlineBookable && fields.eventoCapacityMode === "metered") {
        const { error: provisionError } = await supabase.rpc("provision_evento_availability", {
          p_product_id: product.id,
        });
        if (provisionError) {
          toast.danger("Los cambios se guardaron, pero el calendario de cupos no se pudo actualizar.");
        }
      }

      setConfirmation({
        status: "success",
        title: "Cambios guardados",
        body: "Los cambios ya están visibles públicamente — no necesitan revisión adicional.",
        actionLabel: "Volver al establecimiento",
        onAction: () => {
          router.push(`/admin/establishments/${product.establishment_id}`);
          router.refresh();
        },
      });
      return;
    }

    const establishment = establishments.find((item) => item.id === establishmentId)!;

    if (variant === "socio-proposal") {
      const payload = buildProductCreationPayload(type, name, description, fields, stagedPhotos);
      const { data, error: rpcError } = await supabase.rpc("submit_product_creation_proposal", {
        p_establishment_id: establishment.id,
        p_type: type,
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

      setConfirmation({
        status: "pending",
        title: "Propuesta enviada",
        body: `Un administrador de Hifago revisará tu propuesta antes de publicar ${entityNoun(type)}. Te avisaremos cuando esté disponible.`,
        actionLabel: "Ir a mis establecimientos",
        // Refonte vue prestataire (2026-08-19) : "Mis actividades" fusionnée dans
        // "/partner/establishment" — cible directe plutôt que "/partner/products" (qui redirige
        // désormais ici, un hop de moins).
        onAction: () => {
          router.push("/partner/establishment");
          router.refresh();
        },
      });
      return;
    }

    // Colonnes de `products` construites par buildProductCreationPayload, JAMAIS réécrites à la
    // main ici : ce chemin admin-direct et le chemin socio/modération doivent produire exactement
    // les mêmes colonnes, et la duplication précédente avait déjà divergé — le bloc « vitrine »
    // (external_booking_url/price_label sur un NON-evento, spec 30 §3.1) n'existait que dans le
    // builder et dans l'édition, jamais dans cette création. Conséquence réelle, silencieuse :
    // l'URL externe saisie par l'admin sur un non-evento n'entrait pas dans l'insert, le produit
    // se créait SANS elle et sans la moindre erreur. C'est ce cas-là que ce passage referme.
    //
    // ⚠️ CE QU'IL NE REFERME PAS, vérifié le 2026-09-09 : une vitrine dont le prix est laissé VIDE
    // échoue toujours. `fields.priceCop` vaut "" et le builder écrit Number("") = 0, refusé par
    // `products_price_cop_positive` (check price_cop > 0) — l'écran ne montre qu'un toast
    // générique. Le défaut est PRÉ-EXISTANT et vit dans les trois chemins à la fois (ce builder,
    // donc création admin ET proposition socio, plus l'update d'édition ligne ~350). Le corriger
    // demande de porter `price_cop: null` quand aucun prix n'est saisi, ce qui change le chemin
    // socio du même geste : hors du périmètre de ce correctif-ci, ouvert dans docs/backlog.md.
    //
    // `photos`/`tag_ids`/`slot_rules` ne sont pas des colonnes de `products` : la RPC de
    // proposition les transpose côté SQL, ce chemin-ci les rattache lui-même APRÈS l'insert
    // (Promise.all ci-dessous). Leur retrait est délibéré, jamais un oubli.
    const productColumns = buildProductCreationPayload(type, name, description, fields);
    delete productColumns.photos; // rattachées par add_catalog_media, ci-dessous
    delete productColumns.tag_ids; // rattachés par product_tag_assignments, ci-dessous
    delete productColumns.slot_rules; // rattachées par product_slot_rules, ci-dessous

    const { data: newProduct, error: insertError } = await supabase
      .from("products")
      .insert({
        // Le spread vient EN PREMIER : les quatre clés d'identité ci-dessous ne sont jamais
        // écrasables par le payload (elles ne s'y trouvent pas — la RPC SQL les pose de son côté).
        ...(productColumns as TablesInsert<"products">),
        partner_id: establishment.partner_id,
        establishment_id: establishment.id,
        type,
        slug: slugify(nombreEs),
        // sellable non précisé, hérite du défaut colonne (true) : un produit créé directement par
        // l'admin est publié tout de suite, même principe que create_establishment/
        // create_product_from_proposal (retour Jérôme, 2026-08-20) — l'ancien geste de publication
        // séparée (feature 4) est abandonné pour toute création déjà initiée par un admin.
      })
      .select("id")
      .single();

    if (insertError || !newProduct) {
      toast.danger(
        isEvento
          ? "No se pudo crear el evento."
          : isLodging
            ? "No se pudo crear el alojamiento."
              : isTransport
                ? "No se pudo crear el transporte."
                : "No se pudo crear la actividad.",
      );
      setIsSubmitting(false);
      return;
    }

    // Tags/photos/créneaux/chambres : optionnels, jamais bloquants — un échec ici laisse le produit
    // créé sans cette annexe, corrigible depuis l'édition (même discipline que spec 08 §9/spec 04).
    // Les 4 rattachements ne dépendent que de newProduct.id, jamais les uns des autres : lancés en
    // parallèle plutôt qu'en séquence, le temps total tombe au max des 4 au lieu de leur somme.
    await Promise.all([
      (async () => {
        if (fields.selectedTagIds.length === 0) return;
        const { error: tagsError } = await supabase
          .from("product_tag_assignments")
          .insert(fields.selectedTagIds.map((tagId) => ({ product_id: newProduct.id, tag_id: tagId })));
        if (tagsError) {
          toast.danger("El producto se creó, pero los tags no se pudieron asociar.");
        }
      })(),
      (async () => {
        // Équipements structurés (migration 20260917110000) — même discipline que les tags
        // juste au-dessus : `fields.selectedAmenityIds` reste `[]` pour variant "socio-proposal"
        // (showAmenities y vaut toujours false, rien à saisir), donc cette insertion est un no-op
        // silencieux et sûr dans ce cas.
        if (fields.selectedAmenityIds.length === 0) return;
        const { error: amenitiesError } = await supabase
          .from("product_amenity_assignments")
          .insert(fields.selectedAmenityIds.map((amenityId) => ({ product_id: newProduct.id, amenity_id: amenityId })));
        if (amenitiesError) {
          toast.danger("El producto se creó, pero el equipamiento no se pudo asociar.");
        }
      })(),
      (async () => {
        for (const [index, photo] of stagedPhotos.entries()) {
          const { error: mediaError } = await supabase.rpc("add_catalog_media", {
            p_entity_type: "product",
            p_entity_id: newProduct.id,
            p_storage_path: photo.path,
            p_sort: index,
          });
          if (mediaError) {
            toast.danger("El producto se creó, pero una foto no se pudo asociar.");
          }
        }
      })(),
      (async () => {
        if (!isActivity || fields.slotRules.length === 0) return;
        // Même RPC que l'édition (ProductSlotRulesBlock) : jamais d'écriture directe dans
        // product_slot_rules depuis le navigateur.
        const { data: slotRulesResult, error: slotRulesError } = await supabase.rpc("replace_product_slot_rules", {
          p_product_id: newProduct.id,
          p_rules: toSlotRuleRows(fields.slotRules),
        });
        if (slotRulesError || !(slotRulesResult as { ok?: boolean } | null)?.ok) {
          toast.danger("El producto se creó, pero los horarios no se pudieron guardar.");
        }
      })(),
      (async () => {
        // Evento réservable en ligne, mode 'metered' (2026-09-15) — matérialise product_availability
        // pour les occurrences des 12 prochains mois (défaut de la RPC). Non bloquant, même
        // discipline que tags/photos/horarios ci-dessus : un échec laisse le produit créé sans
        // calendrier de cupos, corrigible depuis l'édition en rouvrant/resauvegardant la fiche.
        if (!isEvento || !fields.onlineBookable || fields.eventoCapacityMode !== "metered") return;
        const { error: provisionError } = await supabase.rpc("provision_evento_availability", {
          p_product_id: newProduct.id,
        });
        if (provisionError) {
          toast.danger("El evento se creó, pero el calendario de cupos no se pudo generar.");
        }
      })(),
    ]);

    const { label, feminine } = PRODUCT_TYPE_NOUN[type];
    setConfirmation({
      status: "success",
      title: `¡${label.charAt(0).toUpperCase()}${label.slice(1)} cread${feminine ? "a" : "o"}!`,
      body: "Ya está publicado y visible en el catálogo — no necesita revisión adicional.",
      actionLabel: "Volver al catálogo",
      onAction: () => {
        router.push("/admin/establishments");
        router.refresh();
      },
    });
  }

  if (confirmation) {
    return (
      <ActionConfirmation
        status={confirmation.status}
        title={confirmation.title}
        body={confirmation.body}
        actionLabel={confirmation.actionLabel}
        onAction={confirmation.onAction}
        testId="product-form-confirmation"
      />
    );
  }

  // Props identiques quelle que soit la section demandée — factorisées pour ne pas les répéter
  // aux 2 (édition) ou 3 (création) appels de `ProductTypeFields`.
  const productTypeFieldsCommonProps = {
    type,
    state: fields,
    showTags: !isEditing,
    showSlotRulesEditor: !isEditing,
    allowCreateTags: variant === "admin",
    establishmentId: activeEstablishmentId,
    establishmentLobbyConnected,
    allowManualLobbyEntry: variant === "admin",
    allowOnlineBookableConfig: variant === "admin",
    campDurationDays: product?.duration_days ?? null,
    onApplyLobbyRoomData: applyLobbyRoomData,
    availableTags: allTags,
    showAmenities: !isEditing && variant === "admin",
    availableAmenities: allAmenities,
  };

  if (isEditing) {
    return (
      <form onSubmit={handleSubmit} noValidate className="flex w-full max-w-3xl flex-col gap-6 self-center">
        <Card>
          <Card.Header>
            <Card.Title>Detalles</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            <LocalizedTextField
              label="Nombre"
              value={name}
              onChange={setName}
              isRequired
              inputName="nombre"
              testIdPrefix="name"
            />
            {/* Démasqué le 2026-08-26 (arbitrage Jérôme « import à la liaison »). Ce champ avait
                été masqué pour une chambre liée à Lobby, au motif que descriptions[] faisait
                doublon — mais rien ne lisait jamais ce champ chez Lobby : il était donc masqué ET
                vide, et la fiche publique d'une chambre PMS-backed apparaissait dans le catalogue
                comme un nom nu, sans photo ni description. Il est désormais PRÉREMPLI depuis
                Lobby via « Usar estos datos », puis éditable. */}
            <LocalizedTextField
              label="Descripción — opcional"
              value={description}
              onChange={setDescription}
              multiline
              testIdPrefix="description"
              fieldTestId="description-textarea"
            />
            <ProductTypeFields {...productTypeFieldsCommonProps} section="details" />
          </Card.Content>
        </Card>
        <Card>
          <Card.Header>
            <Card.Title>Comercialización</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            <ProductTypeFields {...productTypeFieldsCommonProps} section="pricing" />
          </Card.Content>
        </Card>
        <Button type="submit" isDisabled={isSubmitting} data-testid="save-product-button">
          {isSubmitting ? "Guardando…" : "Guardar cambios"}
        </Button>
      </form>
    );
  }

  const submitLabel =
    variant === "socio-proposal"
      ? isSubmitting
        ? "Enviando…"
        : "Enviar propuesta"
      : isSubmitting
        ? "Creando…"
        : `Crear ${PRODUCT_TYPE_NOUN[type].label}`;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full max-w-3xl flex-col gap-6 self-center">
      <WizardStepper titles={STEP_TITLES} currentIndex={stepIndex} onStepClick={setStepIndex} />

      {stepIndex === 0 ? (
        <div className="flex flex-col gap-4">
          <Select
            fullWidth
            placeholder="Selecciona un establecimiento"
            value={establishmentId}
            onChange={(value) => value && setEstablishmentId(value as string)}
          >
            <Label>Establecimiento</Label>
            <Select.Trigger data-testid="establishment-select">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {establishments.map((establishment) => {
                  const resolvedName = asLocalizedField(establishment.name);
                  const label = (resolvedName?.es ?? resolvedName?.en) || establishment.id;
                  return (
                    <ListBox.Item key={establishment.id} id={establishment.id} textValue={label}>
                      {label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  );
                })}
              </ListBox>
            </Select.Popover>
          </Select>
          <Select fullWidth value={type} onChange={(value) => value && setType(value as ProductType)}>
            <Label>Tipo</Label>
            <Select.Trigger data-testid="type-select">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="activity" textValue="Actividad">
                  Actividad
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="transport" textValue="Transporte">
                  Transporte
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="evento" textValue="Evento (vitrina)">
                  Evento (vitrina)
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="camp" textValue="Campamento">
                  Campamento
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="lodging" textValue="Alojamiento">
                  Alojamiento
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                {/* « Hotel » retiré de la CRÉATION le 2026-08-26 (décision Jérôme sur le modèle
                    hébergement, cf. docs/specs/24-modele-hebergement-et-surface-lobbypms.md §4).
                    Un hôtel n'est pas une activité : c'est l'ÉTABLISSEMENT. Ses chambres —
                    dortoirs et privées — sont des Alojamientos vendables, un par unité, exactement
                    comme la v1 en production (src/config/properties.js : les products lodging sont
                    « des TYPES DE COUCHAGE à l'intérieur d'une propriété ») et comme LobbyPMS
                    lui-même, qui n'a aucun objet « hôtel » — un jeton = une propriété, puis
                    directement des catégories de chambres.
                    Conséquence pratique immédiate : seul un Alojamiento peut être adossé à
                    LobbyPMS (isPmsBacked = lodging + lobby_category_id), donc proposer « Hotel »
                    ici menait à un produit qu'on ne pouvait ensuite pas connecter.
                    Le retrait est allé au bout depuis : T3 étape 1 (38c1b55) a retiré le type
                    de l'application, T3 étape 2 (20260827220000) a supprimé product_room_types, la
                    branche room_type de create_order et la valeur 'hotel' elle-même. Ce
                    commentaire reste ici parce qu'il dit POURQUOI, et que la question se reposera. */}
              </ListBox>
            </Select.Popover>
          </Select>
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
        </div>
      ) : null}

      {stepIndex === 1 ? (
        <div className="flex flex-col gap-4">
          <ProductTypeFields {...productTypeFieldsCommonProps} section="details" />
          {/* Démasqué avec la description ci-dessus, même raison : une chambre liée à Lobby ne
              pouvait structurellement avoir AUCUNE photo — ni locale (bloc masqué), ni importée
              (rien ne lisait photos[]). Sa carte de catalogue s'affichait donc sans image. */}
          <div className="flex flex-col gap-1.5">
            <Label>Fotos — opcional</Label>
            <StagedProductPhotos photos={stagedPhotos} onChange={setStagedPhotos} />
          </div>
        </div>
      ) : null}

      {stepIndex === 2 ? (
        <div className="flex flex-col gap-4">
          <ProductTypeFields {...productTypeFieldsCommonProps} section="pricing" />
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 pt-2">
        <Button type="button" variant="outline" onPress={goPrev} isDisabled={stepIndex === 0}>
          Anterior
        </Button>
        {stepIndex < STEP_TITLES.length - 1 ? (
          <Button type="button" onPress={goNext} data-testid="wizard-next-button">
            Siguiente
          </Button>
        ) : (
          <Button
            type="submit"
            isDisabled={isSubmitting}
            data-testid={
              variant === "socio-proposal" ? "submit-product-proposal-button" : "create-product-button"
            }
          >
            {submitLabel}
          </Button>
        )}
      </div>
    </form>
  );
}
