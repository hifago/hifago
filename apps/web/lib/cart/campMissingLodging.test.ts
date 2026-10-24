import { describe, expect, it } from "vitest";
import { findCampMissingLodging } from "./campMissingLodging";
import type { CartLineForDisplay } from "./getCartLines";

// Reflet côté front de create_order (camp_missing_lodging, migration 20260915100000) — ce test
// vérifie que la fonction pure reproduit EXACTEMENT la même formule (nuits requises =
// duration_days - 1), pas seulement qu'elle "fonctionne" sur un cas heureux.

function ligne(partial: Partial<CartLineForDisplay> & { id: string }): CartLineForDisplay {
  return {
    productId: "producto",
    productName: "Producto",
    productType: "activity",
    productSlug: "producto",
    establishmentId: "est",
    establishmentName: "Establecimiento",
    date: "2026-10-01",
    endDate: null,
    slotStartTime: null,
    qty: 1,
    priceCop: 100000,
    availability: { status: "available" },
    durationDays: null,
    priceTiers: null,
    pmsPrice: null,
    ...partial,
  };
}

describe("findCampMissingLodging", () => {
  it("rend null pour un panier vide", () => {
    expect(findCampMissingLodging([])).toBeNull();
  });

  it("rend null quand le panier n'a aucun camp", () => {
    const lines = [ligne({ id: "1", productType: "activity" }), ligne({ id: "2", productType: "lodging" })];
    expect(findCampMissingLodging(lines)).toBeNull();
  });

  it("rend null pour un camp d'une seule journée (duration_days=1, 0 nuit requise)", () => {
    const lines = [ligne({ id: "camp", productType: "camp", durationDays: 1, date: "2026-10-01" })];
    expect(findCampMissingLodging(lines)).toBeNull();
  });

  it("rend la ligne camp quand aucune ligne lodging n'existe dans le panier", () => {
    const camp = ligne({ id: "camp", productType: "camp", durationDays: 5, date: "2026-10-01" });
    expect(findCampMissingLodging([camp])).toBe(camp);
  });

  it("rend null quand une ligne lodging couvre EXACTEMENT les nuits requises", () => {
    // camp du 1 au 5 (duration_days=5) → nuits requises 1,2,3,4 → lodging doit couvrir [10-01,10-05).
    const lines = [
      ligne({ id: "camp", productType: "camp", durationDays: 5, date: "2026-10-01" }),
      ligne({ id: "lodging", productType: "lodging", date: "2026-10-01", endDate: "2026-10-05" }),
    ];
    expect(findCampMissingLodging(lines)).toBeNull();
  });

  it("rend null quand la ligne lodging est plus large (arrivée avant, départ après)", () => {
    const lines = [
      ligne({ id: "camp", productType: "camp", durationDays: 5, date: "2026-10-10" }),
      ligne({ id: "lodging", productType: "lodging", date: "2026-10-09", endDate: "2026-10-15" }),
    ];
    expect(findCampMissingLodging(lines)).toBeNull();
  });

  it("rend la ligne camp quand deux lignes lodging contiguës laissent un trou", () => {
    // camp du 06-01 au 06-05 (duration_days=5, nuits requises 01,02,03,04) — lodging A (01→03,
    // nuits 01,02) et B (04→06, nuits 04,05) laissent la nuit du 03 non couverte par aucune seule.
    const camp = ligne({ id: "camp", productType: "camp", durationDays: 5, date: "2026-06-01" });
    const lines = [
      camp,
      ligne({ id: "lodgingA", productType: "lodging", date: "2026-06-01", endDate: "2026-06-03" }),
      ligne({ id: "lodgingB", productType: "lodging", date: "2026-06-04", endDate: "2026-06-06" }),
    ];
    expect(findCampMissingLodging(lines)).toBe(camp);
  });

  it("ignore la quantité — une lodging à qty=1 satisfait un camp à qty=4 (pas de comparaison de capacité)", () => {
    const lines = [
      ligne({ id: "camp", productType: "camp", durationDays: 3, date: "2026-10-01", qty: 4 }),
      ligne({ id: "lodging", productType: "lodging", date: "2026-10-01", endDate: "2026-10-03", qty: 1 }),
    ];
    expect(findCampMissingLodging(lines)).toBeNull();
  });

  it("ignore l'établissement — une lodging de n'importe quel établissement convient", () => {
    const lines = [
      ligne({ id: "camp", productType: "camp", durationDays: 3, date: "2026-10-01", establishmentId: "est-camp" }),
      ligne({
        id: "lodging",
        productType: "lodging",
        date: "2026-10-01",
        endDate: "2026-10-03",
        establishmentId: "est-autre",
      }),
    ];
    expect(findCampMissingLodging(lines)).toBeNull();
  });

  it("rend null quand deux camps ont chacun leur propre lodging compatible", () => {
    const lines = [
      ligne({ id: "campA", productType: "camp", durationDays: 3, date: "2026-07-01" }),
      ligne({ id: "lodgingA", productType: "lodging", date: "2026-07-01", endDate: "2026-07-03" }),
      ligne({ id: "campB", productType: "camp", durationDays: 3, date: "2026-07-10" }),
      ligne({ id: "lodgingB", productType: "lodging", date: "2026-07-10", endDate: "2026-07-12" }),
    ];
    expect(findCampMissingLodging(lines)).toBeNull();
  });
});
