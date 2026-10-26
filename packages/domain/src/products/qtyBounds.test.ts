import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_QTY_PER_RESERVATION,
  perReservationQtyCap,
  productTypeHasMaxQty,
  productTypeHasMinQty,
} from "./qtyBounds.ts";

// Même table que le test pgTAP products_qty_bounds (« product_qty_cap : aucun plafond pour
// activité, camp, logement ») : les deux côtés doivent dire la même chose, type par type.
const TYPES = ["activity", "camp", "evento", "lodging", "transport"] as const;

describe("bornes de quantité par réservation", () => {
  it("aucun maximum pour les types à cupo : activité, camp, logement", () => {
    expect(TYPES.filter((type) => !productTypeHasMaxQty(type))).toEqual(["activity", "camp", "lodging"]);
  });

  it("aucun minimum pour un logement seulement", () => {
    expect(TYPES.filter((type) => !productTypeHasMinQty(type))).toEqual(["lodging"]);
  });

  it("le plafond d'une réservation : null pour un type à cupo, même avec une valeur saisie", () => {
    expect(perReservationQtyCap("activity", 8)).toBeNull();
    expect(perReservationQtyCap("lodging", null)).toBeNull();
    expect(perReservationQtyCap("camp", 3)).toBeNull();
  });

  it("le plafond d'une réservation : max_qty, sinon le repli 20, pour l'evento et le transport", () => {
    expect(perReservationQtyCap("transport", 8)).toBe(8);
    expect(perReservationQtyCap("evento", null)).toBe(DEFAULT_MAX_QTY_PER_RESERVATION);
    expect(DEFAULT_MAX_QTY_PER_RESERVATION).toBe(20);
  });
});
