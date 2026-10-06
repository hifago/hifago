import { describe, expect, it } from "vitest";
import { bearerMatchesKey, readBearerToken } from "./bearerMatchesKey";

const KEY = "eyJhbGciOiJIUzI1NiJ9.service-role-de-test.signature";

describe("bearerMatchesKey", () => {
  it("accepte exactement `Bearer <clé>` (casse du schéma et blancs autour tolérés)", async () => {
    expect(await bearerMatchesKey(`Bearer ${KEY}`, KEY)).toBe(true);
    expect(await bearerMatchesKey(`bearer ${KEY}`, KEY)).toBe(true);
    expect(await bearerMatchesKey(`  Bearer   ${KEY}  `, KEY)).toBe(true);
  });

  it.each([
    ["une autre clé (anon)", "Bearer eyJhbGciOiJIUzI1NiJ9.anon-de-test.signature"],
    ["une clé publishable", "Bearer sb_publishable_abcdefghijklmnop"],
    ["la clé tronquée d'un caractère", `Bearer ${KEY.slice(0, -1)}`],
    ["la clé suivie d'un caractère", `Bearer ${KEY}x`],
    ["la clé sans schéma", KEY],
    ["un autre schéma", `Basic ${KEY}`],
    ["la clé suivie d'un second mot", `Bearer ${KEY} ${KEY}`],
    ["un Bearer vide", "Bearer "],
    ["un en-tête vide", ""],
  ])("refuse %s", async (_cas, header) => {
    expect(await bearerMatchesKey(header, KEY)).toBe(false);
  });

  it("refuse un en-tête absent", async () => {
    expect(await bearerMatchesKey(null, KEY)).toBe(false);
    expect(await bearerMatchesKey(undefined, KEY)).toBe(false);
  });

  it("échec fermé : une clé attendue absente ne valide rien, pas même un Bearer vide ou identique", async () => {
    expect(await bearerMatchesKey("Bearer ", "")).toBe(false);
    expect(await bearerMatchesKey("Bearer x", "")).toBe(false);
    expect(await bearerMatchesKey(`Bearer ${KEY}`, null)).toBe(false);
    expect(await bearerMatchesKey(`Bearer ${KEY}`, undefined)).toBe(false);
  });
});

describe("readBearerToken", () => {
  it("rend le jeton d'un en-tête Bearer, null sinon", () => {
    expect(readBearerToken("Bearer abc")).toBe("abc");
    expect(readBearerToken("Basic abc")).toBeNull();
    expect(readBearerToken("Bearer")).toBeNull();
    expect(readBearerToken(null)).toBeNull();
  });
});
