import { describe, expect, it } from "vitest";
import { availabilityScreenFor, productTypeGating, type ProductType } from "./productTypeGating";

// Un test par type sur l'objet COMPLET (toEqual, pas booléen par booléen) : la seule définition de
// ces booléens dans tout le projet (ProductForm, ProductTypeFields, ModerateProductCreationProposalForm
// l'importent tous d'ici) — un `toEqual` global attrape aussi bien un booléen manquant qu'un booléen
// en trop si la fonction évolue sans que ce test soit mis à jour.
describe("productTypeGating", () => {
  it("activity", () => {
    expect(productTypeGating("activity")).toEqual({
      isEvento: false,
      isCamp: false,
      isActivity: true,
      isLodging: false,
      isTransport: false,
      hasLocationAndTags: true,
      hasTags: true,
      hasAmenities: false,
      hasPriceQtyFields: true,
      hasMinQty: true,
      hasMaxQty: false,
      hasCheckInOut: false,
      hasDefaultCapacity: true,
      hasGroupDiscount: false,
      hasProgram: false,
    });
  });

  it("evento", () => {
    expect(productTypeGating("evento")).toEqual({
      isEvento: true,
      isCamp: false,
      isActivity: false,
      isLodging: false,
      isTransport: false,
      hasLocationAndTags: false,
      hasTags: true,
      hasAmenities: false,
      hasPriceQtyFields: false,
      hasMinQty: false,
      hasMaxQty: false,
      hasCheckInOut: false,
      hasDefaultCapacity: false,
      hasGroupDiscount: false,
      hasProgram: false,
    });
  });

  it("camp", () => {
    expect(productTypeGating("camp")).toEqual({
      isEvento: false,
      isCamp: true,
      isActivity: false,
      isLodging: false,
      isTransport: false,
      hasLocationAndTags: false,
      hasTags: true,
      hasAmenities: false,
      hasPriceQtyFields: false,
      hasMinQty: false,
      hasMaxQty: false,
      hasCheckInOut: false,
      hasDefaultCapacity: true,
      hasGroupDiscount: true,
      hasProgram: true,
    });
  });

  it("lodging", () => {
    expect(productTypeGating("lodging")).toEqual({
      isEvento: false,
      isCamp: false,
      isActivity: false,
      isLodging: true,
      isTransport: false,
      hasLocationAndTags: true,
      hasTags: true,
      hasAmenities: true,
      hasPriceQtyFields: true,
      hasMinQty: false,
      hasMaxQty: false,
      hasCheckInOut: true,
      hasDefaultCapacity: true,
      hasGroupDiscount: false,
      hasProgram: false,
    });
  });

  it("transport", () => {
    expect(productTypeGating("transport")).toEqual({
      isEvento: false,
      isCamp: false,
      isActivity: false,
      isLodging: false,
      isTransport: true,
      hasLocationAndTags: false,
      hasTags: true,
      hasAmenities: false,
      hasPriceQtyFields: true,
      hasMinQty: true,
      hasMaxQty: true,
      hasCheckInOut: false,
      hasDefaultCapacity: false,
      hasGroupDiscount: false,
      hasProgram: false,
    });
  });
});

const ALL_TYPES: ProductType[] = ["activity", "evento", "camp", "lodging", "transport"];

describe("availabilityScreenFor", () => {
  it("un produit lié à Lobby (isPmsBacked) affiche toujours 'pms', quel que soit le type", () => {
    for (const type of ALL_TYPES) {
      expect(availabilityScreenFor(type, false, true, null)).toBe("pms");
      expect(availabilityScreenFor(type, true, true, "metered")).toBe("pms");
    }
  });

  it("evento réservable en mode 'metered' matérialise le calendrier générique", () => {
    expect(availabilityScreenFor("evento", false, false, "metered")).toBe("generic");
  });

  it("evento en mode 'unlimited', 'rsvp' ou non activé n'a aucun calendrier", () => {
    expect(availabilityScreenFor("evento", false, false, "unlimited")).toBe("none");
    expect(availabilityScreenFor("evento", false, false, "rsvp")).toBe("none");
    expect(availabilityScreenFor("evento", false, false, null)).toBe("none");
  });

  it("une activité avec des règles de créneaux affiche 'slot' (en plus du générique, cf. commentaire de la fonction)", () => {
    expect(availabilityScreenFor("activity", true, false, null)).toBe("slot");
  });

  it("une activité sans règle de créneaux affiche le générique par défaut", () => {
    expect(availabilityScreenFor("activity", false, false, null)).toBe("generic");
  });

  it("lodging/camp/transport retombent sur le générique par défaut", () => {
    expect(availabilityScreenFor("lodging", false, false, null)).toBe("generic");
    expect(availabilityScreenFor("camp", false, false, null)).toBe("generic");
    expect(availabilityScreenFor("transport", false, false, null)).toBe("generic");
  });
});
