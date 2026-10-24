import { describe, expect, it } from "vitest";
import type { NightCatalogRow } from "./alignLobbyCatalogEntries";
import { lobbyOccupancyForUnit, quoteLobbyStay, stayUnitPriceCop, unitPriceForOccupancy } from "./quoteLobbyStay";

const VIDPOVO = 9631;
const GLAMPING = 29376;

// Un catalogue tel qu'alignLobbyCatalogEntries le rend : une ligne par nuit, ce que Lobby cote.
function nuit(
  date: string,
  disponibles: Record<number, number>,
  prix: Record<number, Record<number, number>>
): NightCatalogRow {
  return {
    date,
    availableByCategory: new Map(Object.entries(disponibles).map(([id, n]) => [Number(id), n])),
    restrictionsByCategory: new Map(),
    pricesByCategory: new Map(Object.entries(prix).map(([id, p]) => [Number(id), p])),
  };
}

// Vendredi 45 000 le lit, samedi 60 000 ; la tente : 120 000 à un, 180 000 à deux.
const CATALOGUE = [
  nuit("2026-11-06", { [VIDPOVO]: 8, [GLAMPING]: 3 }, { [VIDPOVO]: { 1: 45_000 }, [GLAMPING]: { 1: 120_000, 2: 180_000 } }),
  nuit("2026-11-07", { [VIDPOVO]: 2, [GLAMPING]: 1 }, { [VIDPOVO]: { 1: 60_000 }, [GLAMPING]: { 1: 150_000, 2: 210_000 } }),
];

describe("lobbyOccupancyForUnit — sous-règle (a)", () => {
  it("2 pour un produit vendu per_two, 1 sinon", () => {
    expect(lobbyOccupancyForUnit("per_two")).toBe(2);
    expect(lobbyOccupancyForUnit("per_person")).toBe(1);
    expect(lobbyOccupancyForUnit("per_house")).toBe(1);
    expect(lobbyOccupancyForUnit(null)).toBe(1);
  });

  it("une occupation non cotée n'emprunte jamais le prix d'un autre niveau", () => {
    expect(unitPriceForOccupancy({ 1: 45_000 }, 2)).toBeNull();
    expect(unitPriceForOccupancy(undefined, 1)).toBeNull();
  });
});

describe("quoteLobbyStay", () => {
  it("le prix de CHAQUE nuit — semaine et week-end — et le minimum des places libres", () => {
    const resultat = quoteLobbyStay({
      catalog: CATALOGUE,
      categoryId: VIDPOVO,
      occupancy: 1,
      nights: ["2026-11-06", "2026-11-07"],
      qty: 2,
    });
    expect(resultat).toEqual({
      ok: true,
      quote: {
        nightly: [
          { date: "2026-11-06", unitPriceCop: 45_000 },
          { date: "2026-11-07", unitPriceCop: 60_000 },
        ],
        minAvailableCupos: 2,
      },
    });
    if (resultat.ok) expect(stayUnitPriceCop(resultat.quote.nightly)).toBe(105_000);
  });

  it("per_two : le prix à DEUX personnes de la tente", () => {
    const resultat = quoteLobbyStay({
      catalog: CATALOGUE,
      categoryId: GLAMPING,
      occupancy: 2,
      nights: ["2026-11-06", "2026-11-07"],
      qty: 1,
    });
    expect(resultat.ok && resultat.quote.nightly.map((n) => n.unitPriceCop)).toEqual([180_000, 210_000]);
  });

  it("2 lits libres une nuit, 3 demandés : `insufficient`, le devis reste lisible pour l'enregistrer", () => {
    const resultat = quoteLobbyStay({
      catalog: CATALOGUE,
      categoryId: VIDPOVO,
      occupancy: 1,
      nights: ["2026-11-06", "2026-11-07"],
      qty: 3,
    });
    expect(resultat).toMatchObject({ ok: false, reason: "insufficient", quote: { minAvailableCupos: 2 } });
  });

  it("une nuit absente du catalogue, ou dont la catégorie n'est pas cotée : `night_missing`", () => {
    expect(
      quoteLobbyStay({ catalog: CATALOGUE, categoryId: VIDPOVO, occupancy: 1, nights: ["2026-11-08"], qty: 1 })
    ).toEqual({ ok: false, reason: "night_missing", date: "2026-11-08" });
    expect(
      quoteLobbyStay({ catalog: CATALOGUE, categoryId: 12345, occupancy: 1, nights: ["2026-11-06"], qty: 1 })
    ).toEqual({ ok: false, reason: "night_missing", date: "2026-11-06" });
    expect(quoteLobbyStay({ catalog: CATALOGUE, categoryId: VIDPOVO, occupancy: 1, nights: [], qty: 1 })).toEqual({
      ok: false,
      reason: "night_missing",
      date: null,
    });
  });

  it("disponible mais sans prix à cette occupation : `price_missing`, jamais un prix fabriqué", () => {
    expect(
      quoteLobbyStay({ catalog: CATALOGUE, categoryId: VIDPOVO, occupancy: 2, nights: ["2026-11-06"], qty: 1 })
    ).toEqual({ ok: false, reason: "price_missing", date: "2026-11-06" });
    const sansPrix = [nuit("2026-11-06", { [VIDPOVO]: 8 }, {})];
    expect(
      quoteLobbyStay({ catalog: sansPrix, categoryId: VIDPOVO, occupancy: 1, nights: ["2026-11-06"], qty: 1 })
    ).toEqual({ ok: false, reason: "price_missing", date: "2026-11-06" });
  });
});
