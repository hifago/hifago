import { describe, expect, it } from "vitest";
import { amenityIdsIfChanged, proposedAmenityIds } from "./proposedAmenities";

// Ce que ce fichier protège : la distinction « clé absente » / « clé présente », qui décide côté
// SQL (migration 20261013151206) entre « ne pas toucher aux équipements » et « les remplacer ».

describe("amenityIdsIfChanged", () => {
  it("sélection inchangée, même dans un autre ordre : la clé n'entre PAS dans le payload", () => {
    expect(amenityIdsIfChanged(["a", "b"], ["b", "a"])).toEqual({});
    expect(amenityIdsIfChanged([], [])).toEqual({});
  });

  it("ajout, retrait ou remplacement : la sélection entière est envoyée", () => {
    expect(amenityIdsIfChanged(["a"], ["a", "b"])).toEqual({ amenity_ids: ["a", "b"] });
    expect(amenityIdsIfChanged(["a", "b"], ["a"])).toEqual({ amenity_ids: ["a"] });
    expect(amenityIdsIfChanged(["a"], ["b"])).toEqual({ amenity_ids: ["b"] });
  });

  it("tout retirer : un tableau VIDE est envoyé, pas une clé absente", () => {
    expect(amenityIdsIfChanged(["a"], [])).toEqual({ amenity_ids: [] });
  });
});

describe("proposedAmenityIds", () => {
  it("clé absente ou mal formée : la proposition ne touche pas aux équipements", () => {
    expect(proposedAmenityIds({})).toBeNull();
    expect(proposedAmenityIds({ amenity_ids: null })).toBeNull();
    expect(proposedAmenityIds({ amenity_ids: "a" })).toBeNull();
  });

  it("tableau présent, même vide : c'est une proposition", () => {
    expect(proposedAmenityIds({ amenity_ids: [] })).toEqual([]);
    expect(proposedAmenityIds({ amenity_ids: ["a", 3, "b"] })).toEqual(["a", "b"]);
  });
});
