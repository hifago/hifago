// @vitest-environment node
import { describe, expect, it } from "vitest";
import { REF_CODE_MAX_LENGTH, normalizeRefCode, refCookieOptions } from "./refCookie";

// Le code d'attribution arrive d'une URL (`?ref=`) ou d'un cookie que le navigateur renvoie tel
// quel : une donnée du visiteur, recopiée dans `carts.attribution_code`. Ce fichier prouve qu'elle
// est bornée avant d'être posée ou enregistrée, et que le cookie n'est `Secure` qu'en HTTPS.

describe("normalizeRefCode", () => {
  it.each([
    ["SEED-REFACTIVE", "SEED-REFACTIVE"],
    ["  CASA-KAYAM  ", "CASA-KAYAM"],
    ["x".repeat(REF_CODE_MAX_LENGTH), "x".repeat(REF_CODE_MAX_LENGTH)],
  ])("garde %j", (brut, attendu) => {
    expect(normalizeRefCode(brut)).toBe(attendu);
  });

  it.each([[null], [undefined], [""], ["   "], ["x".repeat(REF_CODE_MAX_LENGTH + 1)]])(
    "ignore %j",
    (brut) => {
      expect(normalizeRefCode(brut)).toBeNull();
    }
  );
});

describe("refCookieOptions", () => {
  it("pose Secure en HTTPS", () => {
    expect(refCookieOptions("https:")).toEqual({
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
    });
  });

  it("ne pose pas Secure en HTTP (développement, e2e locaux)", () => {
    expect(refCookieOptions("http:").secure).toBe(false);
  });
});
