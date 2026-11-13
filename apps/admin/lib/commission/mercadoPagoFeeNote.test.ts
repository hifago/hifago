import { describe, expect, it } from "vitest";
import { mercadoPagoFeeNote } from "./mercadoPagoFeeNote";

// formatCop sépare « COP » par une espace insécable.
const NBSP = " ";

describe("mercadoPagoFeeNote", () => {
  it("dit les frais Mercado Pago retenus sur l'option 17 %", () => {
    expect(mercadoPagoFeeNote(850)).toBe(`− 850${NBSP}COP comisión Mercado Pago`);
  });

  it("rien quand rien n'est retenu", () => {
    expect(mercadoPagoFeeNote(null)).toBeNull();
    expect(mercadoPagoFeeNote(undefined)).toBeNull();
    expect(mercadoPagoFeeNote(0)).toBeNull();
  });
});
