import { describe, expect, it } from "vitest";
import { proposedTagIds, tagIdsIfChanged, tagLabels } from "./proposedTags";

// Ce que ce fichier protège : la distinction « clé absente » / « clé présente », qui décide côté
// SQL (migration 20261013144848) entre « ne pas toucher aux étiquettes » et « les remplacer ».

describe("tagIdsIfChanged", () => {
  it("sélection inchangée : la clé n'entre PAS dans le payload", () => {
    expect(tagIdsIfChanged(["a", "b"], ["a", "b"])).toEqual({});
    expect(tagIdsIfChanged([], [])).toEqual({});
  });

  it("même ensemble dans un autre ordre : toujours inchangée", () => {
    expect(tagIdsIfChanged(["a", "b"], ["b", "a"])).toEqual({});
  });

  it("ajout, retrait ou remplacement : la sélection entière est envoyée", () => {
    expect(tagIdsIfChanged(["a"], ["a", "b"])).toEqual({ tag_ids: ["a", "b"] });
    expect(tagIdsIfChanged(["a", "b"], ["a"])).toEqual({ tag_ids: ["a"] });
    expect(tagIdsIfChanged(["a"], ["b"])).toEqual({ tag_ids: ["b"] });
  });

  // ⚠️ LE cas. Tout retirer est une demande explicite : un tableau vide doit partir, sinon le
  // socio ne pourrait jamais vider les étiquettes de sa fiche.
  it("tout retirer : un tableau VIDE est envoyé, pas une clé absente", () => {
    expect(tagIdsIfChanged(["a"], [])).toEqual({ tag_ids: [] });
  });
});

describe("proposedTagIds", () => {
  it("rend `null` quand la proposition ne porte pas la clé", () => {
    expect(proposedTagIds({})).toBeNull();
    expect(proposedTagIds({ tag_ids: null })).toBeNull();
  });

  it("rend le tableau, même vide, quand elle la porte", () => {
    expect(proposedTagIds({ tag_ids: [] })).toEqual([]);
    expect(proposedTagIds({ tag_ids: ["a", 3, "b"] })).toEqual(["a", "b"]);
  });
});

describe("tagLabels", () => {
  const tags = [
    { id: "a", label: "Aventura" },
    { id: "b", label: "Naturaleza" },
  ];

  it("résout les libellés, ignore une étiquette disparue du catalogue", () => {
    expect(tagLabels(["b", "x", "a"], tags)).toBe("Naturaleza, Aventura");
  });

  it("rend un tiret quand il n'y en a aucune", () => {
    expect(tagLabels([], tags)).toBe("—");
  });
});
