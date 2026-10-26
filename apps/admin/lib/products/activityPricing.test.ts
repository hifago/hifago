import { describe, expect, it } from "vitest";
import { activityPricingError, lineQtyLabel, toActivityPricingColumns } from "./activityPricing";

// Spec 43 — mode de prix d'une activité côté écran.
const regle = (slotDurationMinutes: string) => ({
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  startTime: "08:00",
  endTime: "17:00",
  slotDurationMinutes,
  capacity: "1",
});

describe("toActivityPricingColumns", () => {
  it("à l'heure : le mode et les personnes", () => {
    expect(toActivityPricingColumns({ pricingUnit: "per_hour", minPersons: "1", maxPersons: "10" })).toEqual({
      pricing_unit: "per_hour",
      min_persons: 1,
      max_persons: 10,
    });
  });
  it("par personne : jamais de personnes min/max (la quantité les compte déjà)", () => {
    expect(toActivityPricingColumns({ pricingUnit: "per_person", minPersons: "2", maxPersons: "6" })).toEqual({
      pricing_unit: "per_person",
      min_persons: null,
      max_persons: null,
    });
  });
});

describe("activityPricingError", () => {
  const base = { minPersons: "", maxPersons: "", isEditing: false, slotRules: [regle("60")] };
  it("à l'heure, à la création : des horaires sont exigés", () => {
    expect(activityPricingError({ ...base, pricingUnit: "per_hour", slotRules: [] })).toMatch(/necesita horarios/);
  });
  it("à l'heure : des franjas de 60 minutes seulement", () => {
    expect(activityPricingError({ ...base, pricingUnit: "per_hour", slotRules: [regle("30")] })).toMatch(/60 minutos/);
    expect(activityPricingError({ ...base, pricingUnit: "per_hour" })).toBeNull();
  });
  it("en édition, les horaires vivent dans leur propre bloc : pas d'exigence ici", () => {
    expect(activityPricingError({ ...base, pricingUnit: "per_hour", isEditing: true, slotRules: [] })).toBeNull();
  });
  it("personnes : minimum au-dessus du maximum refusé", () => {
    expect(activityPricingError({ ...base, pricingUnit: "per_activity", minPersons: "5", maxPersons: "2" })).toMatch(
      /mínimas/
    );
  });
});

describe("lineQtyLabel", () => {
  it("dit ce que compte la quantité d'une réservation", () => {
    expect(lineQtyLabel(3, "per_hour")).toBe("3 h");
    expect(lineQtyLabel(1, "per_activity")).toBe("actividad completa");
    expect(lineQtyLabel(4, null)).toBe("4 pers.");
  });
});
