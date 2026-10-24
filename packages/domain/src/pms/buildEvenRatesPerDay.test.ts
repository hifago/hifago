import { describe, expect, it } from "vitest";
import { buildEvenRatesPerDay, buildNightlyRatesPerDay } from "./buildEvenRatesPerDay";

describe("buildEvenRatesPerDay", () => {
  it("répartit également un total qui se divise sans reste", () => {
    expect(buildEvenRatesPerDay("2028-09-01", "2028-09-03", 200000)).toEqual([
      { date: "2028-09-01", price: 100000 },
      { date: "2028-09-02", price: 100000 },
    ]);
  });

  it("la somme reste EXACTEMENT le total même quand la division a un reste", () => {
    const rates = buildEvenRatesPerDay("2028-09-01", "2028-09-04", 100000);
    expect(rates).toHaveLength(3);
    const sum = rates.reduce((acc, r) => acc + r.price, 0);
    expect(sum).toBe(100000);
    // Les deux premières nuits portent la part entière (33333), la dernière absorbe le reste.
    expect(rates[0]).toEqual({ date: "2028-09-01", price: 33333 });
    expect(rates[1]).toEqual({ date: "2028-09-02", price: 33333 });
    expect(rates[2]).toEqual({ date: "2028-09-03", price: 33334 });
  });

  it("une seule nuit → tout le total sur cette nuit", () => {
    expect(buildEvenRatesPerDay("2028-09-01", "2028-09-02", 100000)).toEqual([
      { date: "2028-09-01", price: 100000 },
    ]);
  });

  it("end_date <= start_date → tableau vide, jamais une exception", () => {
    expect(buildEvenRatesPerDay("2028-09-03", "2028-09-01", 100000)).toEqual([]);
    expect(buildEvenRatesPerDay("2028-09-01", "2028-09-01", 100000)).toEqual([]);
  });
});

describe("buildNightlyRatesPerDay — le prix de chaque nuit, figé par create_order (2026-10-23)", () => {
  const nightly = [
    { date: "2026-11-06", unit_price_cop: 45_000 },
    { date: "2026-11-07", unit_price_cop: 60_000 },
  ];

  it("prix d'une unité × qty, nuit par nuit — le week-end plus cher le reste dans le booking", () => {
    expect(buildNightlyRatesPerDay("2026-11-06", "2026-11-08", 3, 315_000, nightly)).toEqual([
      { date: "2026-11-06", price: 135_000 },
      { date: "2026-11-07", price: 180_000 },
    ]);
  });

  it("sans ventilation (ligne ancienne) : le partage égal, inchangé", () => {
    expect(buildNightlyRatesPerDay("2026-11-06", "2026-11-08", 3, 315_000, null)).toEqual(
      buildEvenRatesPerDay("2026-11-06", "2026-11-08", 315_000)
    );
  });

  it("une ventilation qui ne recompose plus le total facturé (ligne modifiée au prix fixe) : repli", () => {
    expect(buildNightlyRatesPerDay("2026-11-06", "2026-11-08", 3, 300_000, nightly)).toEqual(
      buildEvenRatesPerDay("2026-11-06", "2026-11-08", 300_000)
    );
  });

  it("une nuit manquante, décalée ou au prix illisible : repli, jamais un tarif deviné", () => {
    const even = buildEvenRatesPerDay("2026-11-06", "2026-11-08", 315_000);
    expect(buildNightlyRatesPerDay("2026-11-06", "2026-11-08", 3, 315_000, nightly.slice(0, 1))).toEqual(even);
    expect(
      buildNightlyRatesPerDay("2026-11-06", "2026-11-08", 3, 315_000, [
        { date: "2026-11-07", unit_price_cop: 45_000 },
        { date: "2026-11-08", unit_price_cop: 60_000 },
      ])
    ).toEqual(even);
    expect(
      buildNightlyRatesPerDay("2026-11-06", "2026-11-08", 3, 315_000, [
        { date: "2026-11-06", unit_price_cop: 45_000.5 },
        { date: "2026-11-07", unit_price_cop: 59_999.5 },
      ])
    ).toEqual(even);
  });
});
