import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safeNextPath";

describe("safeNextPath", () => {
  it.each([
    ["//evil.com"],
    ["/\\evil.com"],
    ["/\\\\evil.com"],
    ["/\t/evil.com"],
    ["/\n/evil.com"],
    ["/./\\evil.com"],
    ["/..//evil.com"],
    ["/a/../..//evil.com"],
    ["https://evil.com"],
    ["javascript:alert(1)"],
    ["evil.com"],
    [" /es"],
    [""],
  ])("rejette %j (hors du site ou pas un chemin absolu)", (raw) => {
    expect(safeNextPath(raw)).toBe("/");
  });

  it.each([[undefined], [null], [42], [["/es", "/en"]]])(
    "rejette une valeur qui n'est pas une chaîne (%j)",
    (raw) => {
      expect(safeNextPath(raw)).toBe("/");
    }
  );

  it.each([
    ["/"],
    ["/partner"],
    ["/partner/join?token=abc"],
    ["/partner/join?token=a%26b"],
    ["/mfa/enroll?next=%2Fpartner"],
    ["/es/productos/x?ref=abc#top"],
    ["/%2F%2Fevil.com"],
  ])("conserve le chemin interne %j tel quel", (raw) => {
    expect(safeNextPath(raw)).toBe(raw);
  });

  it("rend le repli fourni quand la valeur est refusée", () => {
    expect(safeNextPath("//evil.com", "/partner")).toBe("/partner");
  });

  it("ne sort jamais du site, quel que soit le puits qui consomme le résultat", () => {
    const origin = "http://localhost:3101";
    for (const raw of ["/./\\evil.com", "/..//evil.com", "/a/../..//evil.com", "//evil.com"]) {
      expect(new URL(safeNextPath(raw), origin).origin).toBe(origin);
    }
  });
});
