import { PER_HOUR_SLOT_MINUTES, type PricingUnit } from "@hifago/domain";
import type { DraftSlotRule } from "@/lib/products/slotRules";

// Spec 43 (migration 20261025140000) — le mode de prix d'une activité, côté écran. UNE définition
// de ce que chaque mode affiche et envoie, lue par le formulaire (ProductTypeFields), les deux
// payloads (création, édition/proposition) et la validation de l'étape prix.

export const PRICING_UNIT_OPTIONS: { value: PricingUnit; label: string; description: string }[] = [
  {
    value: "per_person",
    label: "Por persona",
    description: "El cliente elige cuántas personas; el precio se multiplica por persona.",
  },
  {
    value: "per_hour",
    label: "Por hora",
    description:
      "El cliente elige la hora de inicio y cuántas horas; el precio se multiplica por hora. Necesita horarios de 60 minutos.",
  },
  {
    value: "per_activity",
    label: "Por actividad completa",
    description: "Un precio por la actividad entera, sea cual sea el número de personas.",
  },
];

/** Le nombre de personnes min/max (simple mention sur la fiche) : à l'heure ou à l'activité. */
export function pricingShowsPersons(unit: PricingUnit): boolean {
  return unit !== "per_person";
}

/** Tramos et minimum par réservation : sans objet pour une activité vendue entière (quantité 1). */
export function pricingAllowsQty(unit: PricingUnit): boolean {
  return unit !== "per_activity";
}

/** À l'heure, les heures vendables sont les horaires : le cupo du jour n'a plus de sens. */
export function pricingShowsDailyCapacity(unit: PricingUnit): boolean {
  return unit !== "per_hour";
}

export function minQtyLabel(unit: PricingUnit): string {
  return unit === "per_hour" ? "Horas mínimas por reserva — opcional" : "Personas mínimas por reserva — opcional";
}

export function priceLabel(unit: PricingUnit): string {
  if (unit === "per_hour") return "Precio por hora (COP)";
  if (unit === "per_activity") return "Precio de la actividad completa (COP)";
  return "Precio por persona (COP)";
}

export function dailyCapacityLabel(unit: PricingUnit): string {
  return unit === "per_activity" ? "Actividades por día — opcional" : "Cupo diario por defecto — opcional";
}

type PricingFields = { pricingUnit: PricingUnit; minPersons: string; maxPersons: string };

function entierOuNull(valeur: string): number | null {
  return valeur.trim() ? Number(valeur) : null;
}

/** Les trois colonnes, pour une activité seulement. Personnes à NULL en « por persona ». */
export function toActivityPricingColumns(fields: PricingFields): Record<string, unknown> {
  const avecPersonnes = pricingShowsPersons(fields.pricingUnit);
  return {
    pricing_unit: fields.pricingUnit,
    min_persons: avecPersonnes ? entierOuNull(fields.minPersons) : null,
    max_persons: avecPersonnes ? entierOuNull(fields.maxPersons) : null,
  };
}

/**
 * Erreurs propres au mode de prix. `slotRules` n'est vérifié qu'à la création (seul écran qui les
 * saisit en même temps que le mode) : une activité à l'heure naît avec des horaires de 60 min — la
 * base le refuse sinon (`per_hour_requires_hourly_slots`) ou ne la rend pas réservable.
 */
export function activityPricingError(params: PricingFields & { isEditing: boolean; slotRules: DraftSlotRule[] }): string | null {
  if (pricingShowsPersons(params.pricingUnit)) {
    const min = entierOuNull(params.minPersons);
    const max = entierOuNull(params.maxPersons);
    if ((min !== null && (!Number.isInteger(min) || min < 1)) || (max !== null && (!Number.isInteger(max) || max < 1))) {
      return "El número de personas debe ser un número entero mayor a 0.";
    }
    if (min !== null && max !== null && min > max) {
      return "Las personas mínimas no pueden ser más que las máximas.";
    }
  }
  if (params.pricingUnit === "per_hour" && !params.isEditing) {
    if (params.slotRules.length === 0) {
      return "Una actividad por hora necesita horarios: el cliente elige la hora de inicio.";
    }
    if (params.slotRules.some((rule) => Number(rule.slotDurationMinutes) !== PER_HOUR_SLOT_MINUTES)) {
      return "Una actividad por hora solo admite franjas de 60 minutos.";
    }
  }
  return null;
}

/**
 * Ce que compte la quantité d'une RÉSERVATION, d'après son instantané `order_lines.pricing_unit`
 * (null pour tout ce qui n'est pas une activité, ou une ligne antérieure à la spec 43).
 */
export function lineQtyLabel(qty: number, pricingUnit: string | null | undefined): string {
  if (pricingUnit === "per_hour") return `${qty} h`;
  if (pricingUnit === "per_activity") return qty === 1 ? "actividad completa" : `${qty} actividades`;
  return `${qty} pers.`;
}
