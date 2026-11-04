import { describe, expect, it } from "vitest";
import { requiredPricingStepError } from "./productFormRequiredFields";
import { emptyGroupDiscount } from "./groupDiscount";
import { emptyStayRates } from "./stayRates";

// Une activité éditée, au prix renseigné, sans aucune autre exigence : seule la règle testée peut
// renvoyer un message.
function params(overrides: Partial<Parameters<typeof requiredPricingStepError>[0]> = {}) {
  return {
    isEditing: true,
    isEvento: false,
    isCamp: false,
    isActivity: true,
    isLodging: false,
    // Les deux bornes affichées, comme pour un transport : chaque règle de quantité est testable.
    hasMinQty: true,
    hasMaxQty: true,
    needsOwnPrice: true,
    usesTiers: false,
    price: 50000,
    priceLabel: "",
    onlineBookable: false,
    eventoCapacityMode: "" as const,
    defaultCapacity: "",
    isFree: false,
    eventoPaymentMode: "" as const,
    groupDiscount: emptyGroupDiscount(),
    slotRules: [],
    priceTiers: [],
    minQty: "",
    maxQty: "",
    stayRates: emptyStayRates(),
    externalBookingUrl: "",
    ...overrides,
  };
}

describe("requiredPricingStepError — lien de réservation externe", () => {
  it("vide : aucune exigence (le champ est optionnel)", () => {
    expect(requiredPricingStepError(params())).toBeNull();
  });

  it("http et https sont admis, quelle que soit la casse du schéma", () => {
    expect(requiredPricingStepError(params({ externalBookingUrl: "https://reservas.example.com" }))).toBeNull();
    expect(requiredPricingStepError(params({ externalBookingUrl: "http://reservas.example.com" }))).toBeNull();
    expect(requiredPricingStepError(params({ externalBookingUrl: "HTTPS://reservas.example.com" }))).toBeNull();
  });

  it("tout autre schéma est refusé avant l'envoi, comme la contrainte products_external_booking_url_scheme", () => {
    expect(requiredPricingStepError(params({ externalBookingUrl: "ftp://reservas.example.com" }))).toBe(
      "El enlace de reserva externo debe empezar por http:// o https://."
    );
    expect(requiredPricingStepError(params({ externalBookingUrl: "reservas.example.com" }))).toBe(
      "El enlace de reserva externo debe empezar por http:// o https://."
    );
  });
});

describe("requiredPricingStepError — plancher des quantités", () => {
  it("1 et plus sont admis ; vide = pas de borne", () => {
    expect(requiredPricingStepError(params({ minQty: "1", maxQty: "6" }))).toBeNull();
    expect(requiredPricingStepError(params({ minQty: "", maxQty: "" }))).toBeNull();
  });

  it("0 est refusé, comme les contraintes products_min_qty_positive / products_max_qty_positive", () => {
    expect(requiredPricingStepError(params({ minQty: "0" }))).toBe("La cantidad mínima debe ser al menos 1.");
    expect(requiredPricingStepError(params({ maxQty: "0" }))).toBe("La cantidad máxima debe ser al menos 1.");
  });

  it("sans champs de quantité pour ce type, rien n'est vérifié", () => {
    expect(requiredPricingStepError(params({ hasMinQty: false, hasMaxQty: false, minQty: "0" }))).toBeNull();
  });

  // Migration 20261025120000 : une activité n'a plus de maximum, un logement plus de minimum. Une
  // valeur restée dans l'état d'un autre type n'est jamais envoyée : elle ne bloque pas l'écran.
  it("une borne masquée n'est jamais vérifiée, même incohérente", () => {
    expect(requiredPricingStepError(params({ hasMaxQty: false, maxQty: "0" }))).toBeNull();
    expect(requiredPricingStepError(params({ hasMaxQty: false, minQty: "5", maxQty: "2" }))).toBeNull();
    expect(requiredPricingStepError(params({ hasMinQty: false, minQty: "0" }))).toBeNull();
  });

  it("minimum au-dessus du maximum : refusé quand les deux bornes sont affichées (transport)", () => {
    expect(requiredPricingStepError(params({ minQty: "5", maxQty: "2" }))).toBe(
      "La cantidad mínima no puede ser mayor a la máxima."
    );
  });
});

// Migration 20261104120000 (demande Jérôme, 2026-11-04) : une activité naît avec au moins un horaire.
describe("requiredPricingStepError — horaires d'une activité", () => {
  const horario = { weekdays: [1], startTime: "09:00", endTime: "12:00", slotDurationMinutes: "60", capacity: "4" };

  it("création d'une activité sans horaire : refusée", () => {
    expect(requiredPricingStepError(params({ isEditing: false, slotRules: [] }))).toBe(
      "Una actividad necesita al menos un horario.",
    );
  });

  it("création d'une activité avec un horaire valide : acceptée", () => {
    expect(requiredPricingStepError(params({ isEditing: false, slotRules: [horario] }))).toBeNull();
  });

  it("un autre type se crée sans horaire", () => {
    expect(requiredPricingStepError(params({ isEditing: false, isActivity: false, slotRules: [] }))).toBeNull();
  });

  it("l'édition admin n'est pas concernée (les horaires y vivent dans leur propre bloc)", () => {
    expect(requiredPricingStepError(params({ isEditing: true, slotRules: [] }))).toBeNull();
  });
});
