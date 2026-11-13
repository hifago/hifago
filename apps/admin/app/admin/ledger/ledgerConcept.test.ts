import { describe, expect, it } from "vitest";
import { ledgerConceptLabel } from "./ledgerConcept";

// Espace insécable avant « % » (formatPct) : jamais séparé du nombre à la ligne.
const NBSP = " ";

describe("ledgerConceptLabel", () => {
  it("distingue l'auto-recomendación à 8 % et l'option à 17 %", () => {
    expect(
      ledgerConceptLabel({ entryType: "referral_earned", commissionCase: "self_referral", referrerPct: 0.08 })
    ).toBe(`Auto-recomendación · 8${NBSP}%`);
    expect(
      ledgerConceptLabel({ entryType: "referral_earned", commissionCase: "self_referral", referrerPct: 0.17 })
    ).toBe(`Auto-recomendación · 17${NBSP}%`);
  });

  it("nomme la recommandation vers un autre aliado avec son pourcentage figé (ancien barème compris)", () => {
    expect(
      ledgerConceptLabel({ entryType: "referral_earned", commissionCase: "external_referrer", referrerPct: 0.08 })
    ).toBe(`Recomendación · 8${NBSP}%`);
    expect(
      ledgerConceptLabel({ entryType: "referral_earned", commissionCase: "external_referrer", referrerPct: 0.1 })
    ).toBe(`Recomendación · 10${NBSP}%`);
  });

  it("une compensation reste une compensation, quel que soit le cas de la ligne", () => {
    expect(
      ledgerConceptLabel({
        entryType: "establishment_compensation",
        commissionCase: "self_referral",
        referrerPct: 0.17,
      })
    ).toBe(`Compensación por anulación · 17${NBSP}%`);
  });
});
