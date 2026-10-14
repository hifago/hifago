import { describe, expect, it } from "vitest";
import { identityUncheckedWarning } from "./identityWarning";

describe("identityUncheckedWarning", () => {
  it.each([0, -1, 1.5, Number.NaN])("%s : rien à signaler", (count) => {
    expect(identityUncheckedWarning(count)).toBeNull();
  });

  it("une décision : singulier", () => {
    expect(identityUncheckedWarning(1)).toBe(
      "1 decisión tomada sin control de identidad de Mercado Pago: la cuenta receptora no estaba registrada al crear el pago"
    );
  });

  it("plusieurs décisions : pluriel accordé", () => {
    expect(identityUncheckedWarning(6)).toBe(
      "6 decisiones tomadas sin control de identidad de Mercado Pago: la cuenta receptora no estaba registrada al crear los pagos"
    );
  });
});
