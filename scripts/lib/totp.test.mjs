import { describe, expect, it } from "vitest";
import { generateTotp } from "./totp.mjs";
import { ADMIN_TOTP_SECRET, generateTotp as generateTotpE2e } from "../../packages/e2e-support/src/mfa.ts";

// RFC 6238 annexe B, SHA-1 : secret ASCII « 12345678901234567890 », codes à 8 chiffres dont on
// garde les 6 derniers (même troncature modulo 10^6).
const SECRET_RFC = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const VECTEURS_RFC = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
];

describe("generateTotp (scripts/lib)", () => {
  it.each(VECTEURS_RFC)("RFC 6238 à t=%i s → %s", (secondes, attendu) => {
    expect(generateTotp(SECRET_RFC, secondes * 1000)).toBe(attendu);
  });

  it("donne le même code que le générateur des e2e (packages/e2e-support/src/mfa.ts)", () => {
    for (let t = 0; t < 50; t += 1) {
      const instant = 1_700_000_000_000 + t * 30_000;
      expect(generateTotp(ADMIN_TOTP_SECRET, instant)).toBe(generateTotpE2e(ADMIN_TOTP_SECRET, instant));
    }
  });

  it("refuse un secret hors base32 plutôt que de produire un code faux", () => {
    expect(() => generateTotp("PAS-BASE32!")).toThrow(/hors base32/);
  });
});
