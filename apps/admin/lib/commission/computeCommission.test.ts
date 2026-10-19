import { describe, expect, it } from "vitest";
import { computeCommission } from "./computeCommission";

describe("computeCommission", () => {
  it("direct : aucun référent → 17/0/17", () => {
    expect(
      computeCommission({ referrerPartnerId: null, productPartnerId: "partner-a" })
    ).toEqual({ case: "direct", acomptePct: 0.17, referrerPct: 0, appPct: 0.17 });
  });

  it("auto-référence : le référent est le propriétaire du produit → 9/0/9", () => {
    expect(
      computeCommission({ referrerPartnerId: "partner-a", productPartnerId: "partner-a" })
    ).toEqual({ case: "self_referral", acomptePct: 0.09, referrerPct: 0, appPct: 0.09 });
  });

  it("référent externe : différent du propriétaire du produit → 17/8/9", () => {
    expect(
      computeCommission({ referrerPartnerId: "partner-b", productPartnerId: "partner-a" })
    ).toEqual({ case: "external_referrer", acomptePct: 0.17, referrerPct: 0.08, appPct: 0.09 });
  });

  it("referrerPartnerId null est traité identiquement à un référent absent (aucun 3e état)", () => {
    const withNull = computeCommission({ referrerPartnerId: null, productPartnerId: "partner-a" });
    expect(withNull.case).toBe("direct");
  });
});
