import { buildLocalizedPayload, type LocalizedValue } from "@/components/localized-text-field";
import { lowestTierPrice, toPriceTiersColumn } from "@/lib/products/priceTiers";
import { toStayRatesColumn } from "@/lib/products/stayRates";
import { toProgramColumn } from "@/lib/products/program";
import { toGroupDiscountColumns } from "@/lib/products/groupDiscount";
import { toEventoBookableColumns } from "@/lib/products/eventoBookable";
import { toEventoOccurrenceColumns } from "@/lib/products/eventoOccurrence";
import { toTransportInfoColumns } from "@/lib/products/transportInfo";
import { productTypeGating, type ProductType, type ProductTypeFieldsState } from "@/lib/products/useProductTypeFieldsState";

// Construit le payload jsonb attendu par submit_product_proposal / le p_corrected_payload de
// moderate_product_proposal (kind='content') — miroir exact du bloc `if (isEditing && product)` de
// ProductForm.handleSubmit (product-form.tsx) : mêmes champs, jamais tags/photos/slot_rules/
// (délégués à des blocs séparés à sauvegarde immédiate côté admin, jamais couverts par
// ce même submit là non plus — cf. tête de migration 20260817150000).
//
// Les étiquettes d'une PROPOSITION d'édition (migration 20261013144848) ne passent pas par ici :
// ce payload sert aussi à l'update direct de ProductForm, où `tag_ids` n'est pas une colonne. Les
// deux formulaires de proposition (EditProposalForm, ModerateProposalForm) ajoutent la clé
// eux-mêmes, et seulement quand elle doit y être (lib/tags/proposedTags.ts).
export function buildProductEditPayload(
  type: ProductType,
  name: LocalizedValue,
  description: LocalizedValue,
  fields: ProductTypeFieldsState,
): Record<string, unknown> {
  const {
    isEvento, hasLocationAndTags, hasPriceQtyFields, hasCheckInOut, isLodging, hasDefaultCapacity,
    isTransport, isCamp, isActivity,
  } = productTypeGating(type);
  const usesTiers = hasPriceQtyFields && fields.priceMode === "tiers";
  // Même garde que productCreationPayload : `Number("")` vaut 0, PAS NaN, et 0 est refusé par
  // `products_price_cop_positive`. Sans ce `> 0`, effacer le prix d'un produit pour le passer en
  // vitrine faisait échouer l'approbation de la proposition (mesuré le 2026-09-09).
  const prixSaisi = Number(fields.priceCop);
  const priceCopOuNull = Number.isFinite(prixSaisi) && prixSaisi > 0 ? prixSaisi : null;

  return {
    name: buildLocalizedPayload(name) ?? { es: name.es?.trim() ?? "" },
    description: buildLocalizedPayload(description) ?? null,
    ...(hasLocationAndTags
      ? {
          address: fields.address.trim() || null,
          lat: fields.lat.trim() ? Number(fields.lat) : null,
          lon: fields.lon.trim() ? Number(fields.lon) : null,
        }
      : {}),
    // Manquait ici jusqu'au chantier de dédoublonnage payload (2026-09-17) : gaté par `!isEvento`,
    // ce champ n'apparaissait jamais dans le payload d'un evento — modifier le prix (ou basculer
    // isFree) d'un evento réservable en ligne via une proposition était donc silencieusement
    // ignoré. Miroir exact de l'update() historique de ProductForm : toujours présent, un evento
    // gratuit vaut `null`, jamais gaté par le type.
    price_cop: isEvento && fields.isFree ? null : usesTiers ? lowestTierPrice(fields.priceTiers) : priceCopOuNull,
    price_tiers: usesTiers ? toPriceTiersColumn(fields.priceTiers) : null,
    // Miroir exact du bloc d'édition de ProductForm (product-form.tsx) : la vitrine reste
    // modifiable après création. Ces deux clés manquaient ici ET dans la whitelist de
    // submit_product_proposal — un socio ne pouvait donc pas corriger l'URL d'une vitrine qu'il
    // avait lui-même proposée (migration 20260909180000, qui ouvre l'autre moitié du chemin).
    ...(isEvento
      ? {}
      : {
          external_booking_url: fields.externalBookingUrl.trim() || null,
          price_label: fields.externalBookingUrl.trim() ? fields.priceLabel.trim() || null : null,
        }),
    // Manquait ENTIÈREMENT ici jusqu'au chantier de dédoublonnage payload (2026-09-17) — le bug le
    // plus sérieux trouvé en écrivant les tests de ce chantier, pas anticipé par la revue initiale :
    // ce fichier n'avait jamais porté ce bloc, alors que l'update() historique de ProductForm
    // l'écrivait pour toute édition directe admin. `online_bookable`/`evento_capacity_mode`/
    // `is_free`/`evento_payment_mode`/`evento_occupies_resource` d'un evento existant repartaient
    // silencieusement à leur valeur en base à chaque édition (directe ET proposition) — jamais
    // testé unitairement avant ce chantier. MÊME fonction que productCreationPayload.ts.
    ...(isEvento ? toEventoBookableColumns(fields) : {}),
    // Date, récurrence, heure, durée d'un evento (2026-10-13) — restées « création seulement »
    // jusqu'ici : ce fichier ne les émettait pas, donc l'édition admin ne les réécrivait pas et une
    // proposition socio arrivait à la modération SANS elles (« Exposición Mirarte », la date et
    // l'heure saisies par le partenaire avaient disparu). MÊME fonction que
    // productCreationPayload.ts ; les deux pages d'édition les relisent désormais, sinon ce bloc
    // écrirait des champs vides.
    ...(isEvento ? toEventoOccurrenceColumns(fields) : {}),
    ...(hasPriceQtyFields
      ? {
          min_qty: fields.minQty.trim() ? Number(fields.minQty) : null,
          max_qty: fields.maxQty.trim() ? Number(fields.maxQty) : null,
        }
      : {}),
    ...(hasCheckInOut
      ? { check_in_time: fields.checkInTime || null, check_out_time: fields.checkOutTime || null }
      : {}),
    ...(isLodging
      ? {
          capacity: fields.capacity.trim() ? Number(fields.capacity) : null,
          // Miroir exact de productCreationPayload (cf. son commentaire) : même clé whitelistée des
          // deux côtés, sinon une modification effacerait la valeur posée à la création.
          unit_count: fields.unitCount.trim() ? Number(fields.unitCount) : null,
          lodging_kind: fields.lodgingKind || null,
          unit: fields.unit || null,
          stay_rates: toStayRatesColumn(fields.stayRates),
          // Manquait ici jusqu'au chantier de dédoublonnage payload (2026-09-17) : product-form.tsx
          // l'écrivait dans son update() manuel, ce fichier ne l'émettait pas — modifier un logement
          // lié à Lobby via une proposition (socio ou modération) effaçait silencieusement le lien.
          lobby_category_id: fields.lobbyCategoryId.trim() ? Number(fields.lobbyCategoryId) : null,
        }
      : {}),
    // Manquait ici jusqu'au chantier de dédoublonnage payload (2026-09-17), même bug que
    // lobby_category_id ci-dessus mais côté activity/transport. Miroir exact de
    // productCreationPayload.ts (même condition, même commentaire de raisonnement).
    ...(isActivity || isTransport
      ? { lobby_product_id: fields.lobbyProductId.trim() ? Number(fields.lobbyProductId) : null }
      : {}),
    ...(hasDefaultCapacity
      ? { default_capacity: fields.defaultCapacity.trim() ? Number(fields.defaultCapacity) : null }
      : {}),
    // Transport informatif (migration 20260916150000, demande Jérôme du 2026-09-16) : fenêtre de
    // départs, places annoncées par départ, et les DEUX lieux dédiés — `transport_departure_*`
    // remplace le trio générique `address`/`lat`/`lon` pour ce type (retiré d'`hasLocationAndTags`).
    // Une seule définition des 9 colonnes, partagée avec le chemin d'édition (`toTransportInfoColumns`) :
    // les écrire à la main de chaque côté est ce qui avait déjà fait diverger `price_label`.
    ...(isTransport ? toTransportInfoColumns(fields.transportInfo) : {}),
    // Bloc camp — il n'existait PAS dans ce fichier jusqu'au 2026-09-16, et c'était un bug réel,
    // pas une simplification : la whitelist SQL de submit_product_proposal construit
    // `jsonb_build_object('group_discount_pct', p_payload -> 'group_discount_pct')`, donc pour un
    // camp la clé est TOUJOURS présente dans le payload stocké — à null quand ce fichier ne
    // l'émet pas. La garde `v_final_payload ? 'group_discount_pct'` de moderate_product_proposal
    // la voit alors présente et écrit null : approuver une édition socio EFFAÇAIT la remise de
    // groupe du camp. Reproduit en réel le 2026-09-16 (seuil 16 / 20 % → NULL après approbation)
    // en écrivant le programme — d'où la correction des deux ensemble.
    //
    // Règle à retenir pour la suite : pour un camp, tout champ whitelisté côté SQL DOIT être émis
    // ici, sinon chaque édition approuvée l'efface silencieusement.
    ...(isCamp
      ? {
          ...toGroupDiscountColumns(fields.groupDiscount),
          program: toProgramColumn(fields.program),
        }
      : {}),
  };
}
