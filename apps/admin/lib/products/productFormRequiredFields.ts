import { validateProgram, type DraftProgram } from "@/lib/products/program";
import { validateTransportInfo, type TransportInfoFields } from "@/lib/products/transportInfo";
import { validateGroupDiscount, type GroupDiscount } from "@/lib/products/groupDiscount";
import { validateSlotRules, type DraftSlotRule } from "@/lib/products/slotRules";
import { validatePriceTiers, type PriceTier } from "@/lib/products/priceTiers";
import { validateStayRates, type DraftStayRates } from "@/lib/products/stayRates";

// Extraits de `product-form.tsx` (chantier assistant par étapes, docs/specs/40) — mêmes règles,
// mot pour mot, découpées par la même frontière étape 1/2/3 que l'UI (Establecimiento y tipo /
// Detalles / Comercialización), pour être appelables à la fois par la validation par étape
// (« Siguiente ») et par la soumission finale : zéro règle dupliquée entre les deux.

// Étape 1 — n'existe qu'à la création (établissement + type immuables ensuite).
export function requiredContextStepError(params: {
  isEditing: boolean;
  hasEstablishment: boolean;
  nombreEs: string;
}): string | null {
  if (!params.isEditing) {
    if (!params.hasEstablishment || !params.nombreEs) {
      return "El nombre (es) y el establecimiento son obligatorios.";
    }
    return null;
  }
  if (!params.nombreEs) {
    return "El nombre (es) es obligatorio.";
  }
  return null;
}

// Étape 2 — tout ce qui décrit le produit (hors tarification).
export function requiredDetailsStepError(params: {
  isEditing: boolean;
  isCamp: boolean;
  isTransport: boolean;
  isEvento: boolean;
  isLodging: boolean;
  program: DraftProgram;
  durationDaysInput: string;
  persistedDurationDays: number | null;
  transportInfo: TransportInfoFields;
  occurrenceType: "once" | "recurring";
  occurrenceDate: string;
  recurrenceFrequencyDays: string;
  capacity: string;
  unitCount: string;
}): string | null {
  if (params.isCamp) {
    const programError = validateProgram(
      params.program,
      params.durationDaysInput.trim() !== "" && Number(params.durationDaysInput) >= 1
        ? Number(params.durationDaysInput)
        : params.persistedDurationDays,
    );
    if (programError) return programError;
  }

  if (params.isTransport) {
    const transportError = validateTransportInfo(params.transportInfo);
    if (transportError) return transportError;
  }

  // Gaps préexistants, jamais éditables aujourd'hui (spec 11 §2, "hors scope Jérôme") — reproduits
  // à l'identique, pas corrigés en silence.
  if (!params.isEditing) {
    if (params.isEvento && !params.occurrenceDate) {
      return params.occurrenceType === "once"
        ? "La fecha es obligatoria para un evento puntual."
        : "La fecha de la primera ocurrencia es obligatoria para un evento recurrente.";
    }
    if (params.isEvento && params.occurrenceType === "recurring" && !params.recurrenceFrequencyDays) {
      return "La frecuencia es obligatoria para un evento recurrente.";
    }
    if (params.isCamp && (!params.durationDaysInput || Number(params.durationDaysInput) < 1)) {
      return "La duración (días) es obligatoria para un campamento.";
    }
  }

  if (params.isLodging) {
    if (
      params.capacity.trim() &&
      (!Number.isInteger(Number(params.capacity)) || Number(params.capacity) <= 0)
    ) {
      return "La capacidad (número de couchage) debe ser un número entero mayor a 0.";
    }
    if (
      params.unitCount.trim() &&
      (!Number.isInteger(Number(params.unitCount)) || Number(params.unitCount) <= 0)
    ) {
      return "La cantidad (habitaciones o camas) debe ser un número entero mayor a 0.";
    }
  }

  return null;
}

// Étape 3 — tout ce qui concerne le prix/la vente.
export function requiredPricingStepError(params: {
  isEditing: boolean;
  isEvento: boolean;
  isCamp: boolean;
  isActivity: boolean;
  isLodging: boolean;
  hasPriceQtyFields: boolean;
  needsOwnPrice: boolean;
  usesTiers: boolean;
  price: number;
  priceLabel: string;
  onlineBookable: boolean;
  eventoCapacityMode: "unlimited" | "metered" | "rsvp" | "";
  defaultCapacity: string;
  isFree: boolean;
  eventoPaymentMode: "online" | "on_site" | "";
  groupDiscount: GroupDiscount;
  slotRules: DraftSlotRule[];
  priceTiers: PriceTier[];
  minQty: string;
  maxQty: string;
  stayRates: DraftStayRates;
  externalBookingUrl: string;
}): string | null {
  if (params.needsOwnPrice && !params.usesTiers && (!Number.isFinite(params.price) || params.price <= 0)) {
    return "El precio es obligatorio para este tipo de producto.";
  }

  // Gaps préexistants, création seulement — cf. requiredDetailsStepError.
  if (!params.isEditing) {
    if (params.isEvento && !params.onlineBookable && !params.priceLabel.trim()) {
      return "El precio en texto libre es obligatorio para un evento.";
    }
    if (params.isCamp) {
      const groupDiscountError = validateGroupDiscount(params.groupDiscount);
      if (groupDiscountError) return groupDiscountError;
    }
    if (params.isActivity) {
      const slotRulesError = validateSlotRules(params.slotRules);
      if (slotRulesError) return slotRulesError;
    }
  }

  // Evento réservable en ligne — réécrit dans les deux modes (pas un gap création-only), donc
  // toujours validé, éditée ou non.
  if (params.isEvento && params.onlineBookable) {
    if (!params.eventoCapacityMode) {
      return "El modo de capacidad es obligatorio para un evento reservable en línea.";
    }
    if (
      (params.eventoCapacityMode === "metered" || params.eventoCapacityMode === "rsvp") &&
      !params.defaultCapacity.trim()
    ) {
      return "El aforo es obligatorio para este modo de capacidad.";
    }
    if (!params.isFree && !params.eventoPaymentMode) {
      return "El modo de pago es obligatorio para un evento reservable de pago.";
    }
  }

  if (params.usesTiers) {
    const tiersError = validatePriceTiers(params.priceTiers);
    if (tiersError) return tiersError;
  }

  // Même plancher que les contraintes products_min_qty_positive / products_max_qty_positive
  // (20261001144546) : refusé ici avec un message, plutôt qu'en erreur générique à l'enregistrement.
  if (params.hasPriceQtyFields) {
    if (params.minQty.trim() && Number(params.minQty) < 1) {
      return "La cantidad mínima debe ser al menos 1.";
    }
    if (params.maxQty.trim() && Number(params.maxQty) < 1) {
      return "La cantidad máxima debe ser al menos 1.";
    }
  }

  if (
    params.hasPriceQtyFields &&
    params.minQty.trim() &&
    params.maxQty.trim() &&
    Number(params.minQty) > Number(params.maxQty)
  ) {
    return "La cantidad mínima no puede ser mayor a la máxima.";
  }

  // Lien rendu tel quel dans la vitrine : seuls http et https sont admis, comme la contrainte
  // products_external_booking_url_scheme (20261001144546). Le formulaire est `noValidate`, donc
  // l'`<Input type="url">` ne vérifie rien de lui-même.
  if (params.externalBookingUrl.trim() && !/^https?:\/\//i.test(params.externalBookingUrl.trim())) {
    return "El enlace de reserva externo debe empezar por http:// o https://.";
  }

  if (params.isLodging) {
    const stayRatesError = validateStayRates(params.stayRates);
    if (stayRatesError) return stayRatesError;
  }

  return null;
}
