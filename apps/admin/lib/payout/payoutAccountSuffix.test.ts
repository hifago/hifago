import { describe, expect, it } from "vitest";
import { payoutAccountSuffix } from "./payoutAccountSuffix";

// Cahier socio, décision du 2026-08-11 : une coordonnée de paiement enregistrée n'est jamais
// réaffichée complète — seuls les derniers caractères l'identifient.

describe("payoutAccountSuffix", () => {
  it("rend les 4 derniers caractères d'un compte", () => {
    expect(payoutAccountSuffix("referente@mp.test")).toBe("test");
    expect(payoutAccountSuffix("0000003100012345678901")).toBe("8901");
  });

  it("ignore les espaces autour de la valeur", () => {
    expect(payoutAccountSuffix("  alias.mp.cuenta  ")).toBe("enta");
  });

  it("ne montre jamais plus de la moitié d'une valeur courte", () => {
    expect(payoutAccountSuffix("abcdef")).toBe("def");
    expect(payoutAccountSuffix("abc")).toBe("c");
    expect(payoutAccountSuffix("a")).toBe("");
  });

  it("aucun compte enregistré : null", () => {
    expect(payoutAccountSuffix(null)).toBeNull();
    expect(payoutAccountSuffix(undefined)).toBeNull();
    expect(payoutAccountSuffix("   ")).toBeNull();
  });
});
