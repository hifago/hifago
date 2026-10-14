import { describe, expect, it } from "vitest";
import { isExistingTagName, tagMatchesQuery, tagSlug } from "./tagSlug";

// Ce que ce fichier protège : deux étiquettes au nom différent n'ont jamais le même slug par
// accident. Le slug est la clé d'unicité de `catalog_tags` et l'adresse publique de la catégorie —
// un slug vide ou partagé rend la deuxième étiquette impossible à créer.

describe("tagSlug", () => {
  it("un nom ordinaire suit slugify", () => {
    expect(tagSlug("  Económico ")).toBe("economico");
    expect(tagSlug("Vista al lago")).toBe("vista-al-lago");
  });

  // ⚠️ LE cas (2026-10-13) : les quatre donnaient "" et se bloquaient l'une l'autre.
  it("chaque gamme de prix a son propre slug, jamais vide", () => {
    expect(["$", "$$", "$$$", "$$$$"].map(tagSlug)).toEqual([
      "precio-1",
      "precio-2",
      "precio-3",
      "precio-4",
    ]);
  });

  it("tout autre nom sans lettre ni chiffre rend un slug vide, que l'appelant refuse", () => {
    expect(tagSlug("★★★")).toBe("");
    expect(tagSlug("€€")).toBe("");
    expect(tagSlug("$ $")).toBe("");
  });
});

describe("isExistingTagName", () => {
  it("« $$ » n'est pas le doublon de « $ »", () => {
    expect(isExistingTagName("$$", ["$", "Agua"])).toBe(false);
    expect(isExistingTagName("$", ["$", "Agua"])).toBe(true);
  });

  it("accents et casse ne font pas un nom nouveau", () => {
    expect(isExistingTagName("economico", ["Económico"])).toBe(true);
  });

  it("un nom sans slug n'est le doublon de rien : c'est la création qui le refuse", () => {
    expect(isExistingTagName("★★", ["★★★"])).toBe(false);
  });
});

describe("tagMatchesQuery", () => {
  it("recherche sans accents ni casse", () => {
    expect(tagMatchesQuery("Económico", "ECONO")).toBe(true);
    expect(tagMatchesQuery("Agua", "econo")).toBe(false);
  });

  it("une requête tout en symboles filtre sur le nom, au lieu de tout laisser passer", () => {
    expect(tagMatchesQuery("$$$", "$$")).toBe(true);
    expect(tagMatchesQuery("$", "$$")).toBe(false);
    expect(tagMatchesQuery("Agua", "$$")).toBe(false);
  });
});
