import { buildLocalizedPayload, type LocalizedValue } from "@/components/localized-text-field";
import type { StagedPhoto } from "@/components/product-photos-staged";
import { lowestTierPrice, toPriceTiersColumn } from "@/lib/products/priceTiers";
import { toStayRatesColumn } from "@/lib/products/stayRates";
import { toProgramColumn } from "@/lib/products/program";
import { toGroupDiscountColumns } from "@/lib/products/groupDiscount";
import { toEventoBookableColumns } from "@/lib/products/eventoBookable";
import { toEventoOccurrenceColumns } from "@/lib/products/eventoOccurrence";
import { toSlotRuleRows } from "@/lib/products/slotRules";
import { toTransportInfoColumns } from "@/lib/products/transportInfo";
import { pricingAllowsQty, toActivityPricingColumns } from "@/lib/products/activityPricing";
import { productTypeGating, type ProductType, type ProductTypeFieldsState } from "@/lib/products/useProductTypeFieldsState";

// Construit le payload jsonb attendu par submit_product_creation_proposal / le
// p_corrected_payload de moderate_product_proposal (kind='create') — et, depuis le 2026-09-09, la
// SEULE source des colonnes de `products` pour la création ADMIN-DIRECTE également : product-form.tsx
// l'appelle puis retire les clés hors-colonnes (photos/tag_ids/amenity_ids/slot_rules) avant son
// insert.
// Ce fichier n'était jusque-là qu'un « miroir exact » de l'insert écrit à la main en face, et les
// deux avaient fini par diverger — le bloc « vitrine » plus bas (external_booking_url/price_label
// sur un non-evento) n'existait que d'un seul côté. Une seule définition, plus de miroir à tenir.
// Mêmes fonctions de conversion (toPriceTiersColumn/toStayRatesColumn/toSlotRuleRows), donc
// price_cop/price_tiers/slot_rules arrivent déjà dans la forme EXACTE des colonnes cibles —
// create_product_from_proposal (SQL) ne fait plus aucun calcul, seulement une transposition.
// `photos` (spec 15, révisé 2026-08-17) : les fichiers sont déjà uploadés vers Storage au moment
// de l'appel (StagedProductPhotos, réutilisé tel quel côté socio) — seul le storage_path traverse
// la proposition, jamais un binaire.
// Type de retour large (Record<string, unknown>, pas le Json récursif local à chaque formulaire) :
// cast au bord de l'appel .rpc(), même convention que les autres payloads jsonb du projet.
export function buildProductCreationPayload(
  type: ProductType,
  name: LocalizedValue,
  description: LocalizedValue,
  fields: ProductTypeFieldsState,
  stagedPhotos: StagedPhoto[] = [],
): Record<string, unknown> {
  const {
    isEvento, isCamp, isLodging, isActivity, isTransport,
    hasLocationAndTags, hasTags, hasAmenities, hasPriceQtyFields, hasCheckInOut, hasDefaultCapacity,
    hasMinQty, hasMaxQty,
  } = productTypeGating(type);
  // Spec 43 : une activité vendue entière n'a ni tramos ni minimum (la fiche en réserve une).
  const venteEntiere = isActivity && !pricingAllowsQty(fields.pricingUnit);
  const usesTiers = hasPriceQtyFields && fields.priceMode === "tiers" && !venteEntiere;
  // `Number("")` vaut 0, PAS NaN : un champ prix laissé vide franchissait donc `Number.isFinite`
  // et partait en base à 0, refusé par `products_price_cop_positive` (`check price_cop > 0`). Cela
  // fermait le cas « vitrine sans prix chiffré » que la migration 20260908200000 venait justement
  // d'ouvrir — l'admin ne voyait qu'un toast générique (mesuré le 2026-09-09).
  // Seul un prix STRICTEMENT POSITIF est un prix ; tout le reste vaut null, et c'est alors
  // `products_price_cop_required_unless_vitrine` qui dit si la ligne est acceptable — un non-evento
  // sans prix ET sans URL externe est refusé en base, comme la validation de l'écran l'exige déjà.
  const prixSaisi = Number(fields.priceCop);
  const priceCopOuNull = Number.isFinite(prixSaisi) && prixSaisi > 0 ? prixSaisi : null;

  return {
    name: buildLocalizedPayload(name) ?? { es: name.es?.trim() ?? "" },
    description: buildLocalizedPayload(description) ?? null,
    photos: stagedPhotos.map((photo) => ({ storage_path: photo.path })),
    ...(hasLocationAndTags
      ? {
          address: fields.address.trim() || null,
          lat: fields.lat.trim() ? Number(fields.lat) : null,
          lon: fields.lon.trim() ? Number(fields.lon) : null,
        }
      : {}),
    // Séparé d'hasLocationAndTags ci-dessus (retour Jérôme 2026-08-18) : camp a des tags
    // ("servicios incluidos") sans avoir d'adresse propre.
    ...(hasTags ? { tag_ids: fields.selectedTagIds } : {}),
    // Équipements d'un logement (migration 20261013151206) : whitelistés par
    // submit_product_creation_proposal, posés par create_product_from_proposal. Comme `tag_ids`,
    // ce n'est pas une colonne de `products` — la création admin directe retire la clé.
    ...(hasAmenities ? { amenity_ids: fields.selectedAmenityIds } : {}),
    ...(hasPriceQtyFields
      ? {
          price_cop: usesTiers ? lowestTierPrice(fields.priceTiers) : priceCopOuNull,
          price_tiers: usesTiers ? toPriceTiersColumn(fields.priceTiers) : null,
          // NULL explicite là où le type n'a pas la borne (migration 20261025120000 : la base la
          // refuse) — une valeur saisie sous un autre type avant de basculer resterait sinon dans
          // l'état, invisible, et ferait échouer l'enregistrement.
          min_qty: hasMinQty && !venteEntiere && fields.minQty.trim() ? Number(fields.minQty) : null,
          max_qty: hasMaxQty && fields.maxQty.trim() ? Number(fields.maxQty) : null,
        }
      : {}),
    // Spec 43 (migration 20261025140000) : mode de prix et personnes min/max d'une activité.
    ...(isActivity ? toActivityPricingColumns(fields) : {}),
    ...(isCamp
      ? {
          price_cop: priceCopOuNull,
          duration_days: Number(fields.durationDays),
          // Remise par seuil de remplissage cumulé (migration 20260914130000) — création
          // uniquement, même limitation que duration_days ci-dessus (« gap préexistant, jamais
          // éditable aujourd'hui », cf. product-form.tsx) : pas une omission distincte.
          ...toGroupDiscountColumns(fields.groupDiscount),
          // Programme jour par jour (spec 37) : disponible DÈS la création, demande explicite de
          // Jérôme — un camp naît avec son programme en un seul clic, il n'y a pas d'écran d'après.
          program: toProgramColumn(fields.program),
        }
      : {}),
    ...(hasCheckInOut
      ? { check_in_time: fields.checkInTime || null, check_out_time: fields.checkOutTime || null }
      : {}),
    ...(isLodging
      ? {
          capacity: fields.capacity.trim() ? Number(fields.capacity) : null,
          // `unit_count` (renommé le 2026-08-27) : nombre d'unités du type, à côté de la capacité qui est
          // nombre d'occupants d'UNE unité. Whitelisté par submit_product_creation_proposal ET
          // submit_product_proposal (migration 20260826190000) — les deux, sinon le champ se
          // remplirait à la création puis disparaîtrait à la première modification.
          unit_count: fields.unitCount.trim() ? Number(fields.unitCount) : null,
          // `lodging_kind` (2026-08-27) : dortoir / chambre privée / maison entière. Whitelisté par
          // les DEUX RPC de proposition (migration 20260827120000), même raison que ci-dessus.
          lodging_kind: fields.lodgingKind || null,
          unit: fields.unit || null,
          stay_rates: toStayRatesColumn(fields.stayRates),
          // Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — la RPC elle-même ignore ce champ
          // si l'établissement n'est pas connecté (cf. submit_product_creation_proposal), donc
          // aucun besoin de reconditionner ça ici.
          lobby_category_id: fields.lobbyCategoryId.trim() ? Number(fields.lobbyCategoryId) : null,
        }
      : {}),
    // Élargi le 2026-08-26 de isActivity seul à (isActivity || isTransport) — cf. commentaire de
    // tête de product-type-fields.tsx pour le raisonnement complet (evento/camp restent exclus).
    ...(isActivity || isTransport
      ? { lobby_product_id: fields.lobbyProductId.trim() ? Number(fields.lobbyProductId) : null }
      : {}),
    ...(hasDefaultCapacity
      ? { default_capacity: fields.defaultCapacity.trim() ? Number(fields.defaultCapacity) : null }
      : {}),
    ...(isActivity ? { slot_rules: toSlotRuleRows(fields.slotRules) } : {}),
    // Transport informatif (migration 20260916150000, demande Jérôme du 2026-09-16) : fenêtre de
    // départs, places annoncées par départ, et les DEUX lieux dédiés — `transport_departure_*`
    // remplace le trio générique `address`/`lat`/`lon` pour ce type (retiré d'`hasLocationAndTags`).
    // Une seule définition des 9 colonnes, partagée avec le chemin d'édition (`toTransportInfoColumns`) :
    // les écrire à la main de chaque côté est ce qui avait déjà fait diverger `price_label`.
    ...(isTransport ? toTransportInfoColumns(fields.transportInfo) : {}),
    // LA VITRINE, pour tous les types sauf evento (qui porte déjà ces deux clés dans son bloc).
    // C'est la PRÉSENCE de l'URL qui fait la vitrine, jamais le type — cahier §2e, ouvert par la
    // contrainte `products_price_cop_required_unless_vitrine` (spec 30 §3.1).
    ...(isEvento
      ? {}
      : {
          external_booking_url: fields.externalBookingUrl.trim() || null,
          price_label: fields.externalBookingUrl.trim()
            ? fields.priceLabel.trim() || null
            : null,
        }),
    ...(isEvento
      ? {
          // online_bookable (2026-09-15) : bascule vitrine/réservable. Décision « admin
          // uniquement » — ce champ vaut toujours `false` par défaut dans l'état, jamais affiché
          // ni positionnable côté formulaire socio (allowOnlineBookableConfig, product-type-
          // fields.tsx), donc structurellement inerte ici pour une proposition. Rempart réel côté
          // RPC : submit_product_creation_proposal/create_product_from_proposal whitelistent leurs
          // colonnes et jettent silencieusement toute clé absente de leur liste — ces 5 nouvelles
          // clés n'y figurent pas.
          //
          // Les 7 colonnes viennent de `toEventoBookableColumns`, PARTAGÉE avec le chemin d'édition
          // (`product-form.tsx`) : les écrire ici à la main avait déjà fait diverger `price_label`
          // entre les deux, exactement ce que l'en-tête de ce fichier raconte.
          ...toEventoBookableColumns(fields),
          // Prix chiffré (evento réservable payant) — jamais posé pour un evento vitrine (price_label
          // fait foi) ni pour un evento gratuit (contrainte DB products_evento_is_free_price_null).
          price_cop: fields.onlineBookable && !fields.isFree ? priceCopOuNull : null,
          // Date, récurrence, heure, durée : `toEventoOccurrenceColumns`, PARTAGÉE avec le chemin
          // d'édition depuis le 2026-10-13 — écrites ici seulement, elles disparaissaient à la
          // première modification (eventoOccurrence.ts).
          ...toEventoOccurrenceColumns(fields),
          external_booking_url: fields.onlineBookable ? null : fields.externalBookingUrl.trim() || null,
        }
      : {}),
  };
}
