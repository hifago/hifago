import { describe, expect, it } from "vitest";
import { slugGammePrix } from "./tag-slug.mjs";

// Lancé par `npm run verify` (étape « Politique Auth », qui exécute tout `scripts/lib`), donc en CI.
// Mêmes sorties que `apps/admin/lib/tags/tagSlug.test.ts` : le script de mock data et l'admin
// donnent le même slug à une gamme de prix.

describe("slugGammePrix", () => {
  it("chaque gamme de prix a son propre slug, jamais vide", () => {
    expect(["$", "$$", "$$$", "$$$$"].map(slugGammePrix)).toEqual([
      "precio-1",
      "precio-2",
      "precio-3",
      "precio-4",
    ]);
    expect(slugGammePrix("  $$ ")).toBe("precio-2");
  });

  it("tout autre libellé rend null : l'appelant prend le slugify ordinaire", () => {
    expect(slugGammePrix("Agua")).toBeNull();
    expect(slugGammePrix("$ $")).toBeNull();
    expect(slugGammePrix("€€")).toBeNull();
    expect(slugGammePrix("")).toBeNull();
  });
});
