import { describe, expect, it } from "vitest";
import { formatCop } from "./formatCop";

// Toujours le séparateur de milliers, y compris sous 10 000 (la règle CLDR de `es` ne groupe qu'à
// partir de 10 000). L'espace avant « COP » est insécable (U+00A0), comme Intl le produit.
const NBSP = " ";

describe("formatCop", () => {
  it.each([
    [3400, `3.400${NBSP}COP`],
    [45000, `45.000${NBSP}COP`],
    [999, `999${NBSP}COP`],
    [1000000, `1.000.000${NBSP}COP`],
    [12345.6, `12.346${NBSP}COP`],
  ])("es : %d → %s", (montant, attendu) => {
    expect(formatCop(montant)).toBe(attendu);
    expect(formatCop(montant, "es")).toBe(attendu);
  });

  it("en : inchangé (groupait déjà)", () => {
    expect(formatCop(3400, "en")).toBe(`COP${NBSP}3,400`);
    expect(formatCop(45000, "en")).toBe(`COP${NBSP}45,000`);
  });
});
