import { describe, expect, it } from "vitest";
import { computeCartLineTotal } from "./cartLineTotal";

// Correctif Jérôme 2026-09-16 : le panier ignorait complètement les nuits pour une ligne logement
// (priceCop × qty, sans jamais multiplier par le nombre de nuits) — déjà détecté par
// `e2e/reserve-lodging-range.spec.ts` (rouge avant ce correctif). qty désigne des unités
// facturables (chambres/lits/maisons selon lodgingKind), jamais des occupants — d'où la
// multiplication par qty, qui correspond maintenant à la règle serveur de create_order/
// modify_order_line (migration 20260916120000_fix_lodging_price_missing_qty : la branche lodging
// avait perdu cette multiplication le 2026-08-27 en fusionnant l'ancienne branche room_type_id —
// où qty désignait déjà des lits/chambres distincts — avec la branche alojamiento, régression
// invisible tant qu'aucun test n'utilisait qty > 1).
describe("computeCartLineTotal", () => {
  it("logement sans palier : nuits × priceCop × qty", () => {
    const line = {
      date: "2026-11-01",
      endDate: "2026-11-06", // 5 nuits, sortie exclusive
      qty: 2,
      priceCop: 200_000,
      priceTiers: null,
    };
    expect(computeCartLineTotal(line)).toBe(2_000_000); // 5 × 200 000 × 2
  });

  it("logement avec palier de quantité : le palier correspondant à qty est sélectionné", () => {
    const line = {
      date: "2026-11-01",
      endDate: "2026-11-03", // 2 nuits
      qty: 3,
      priceCop: 100_000,
      priceTiers: [
        { min_qty: 1, max_qty: 2, price_cop: 100_000 },
        { min_qty: 3, max_qty: 6, price_cop: 80_000 },
      ],
    };
    expect(computeCartLineTotal(line)).toBe(480_000); // 2 nuits × 80 000 (palier qty=3) × 3
  });

  it("ligne non-logement (endDate null) : inchangé, priceCop × qty", () => {
    const line = {
      date: "2026-11-01",
      endDate: null,
      qty: 4,
      priceCop: 50_000,
      priceTiers: null,
    };
    expect(computeCartLineTotal(line)).toBe(200_000); // 50 000 × 4, aucun facteur de jours
  });
});

describe("computeCartLineTotal — prix Lobby (2026-10-23)", () => {
  const nuitee = { date: "2026-11-06", endDate: "2026-11-08", qty: 2, priceCop: 20000, priceTiers: null };
  it("le devis ou l'estimation, déjà × qty, prime sur le prix fixe", () => {
    expect(computeCartLineTotal({ ...nuitee, pmsPrice: { kind: "quoted", totalCop: 230000, estimateCop: null } })).toBe(230000);
    expect(computeCartLineTotal({ ...nuitee, pmsPrice: { kind: "estimated", totalCop: 210000 } })).toBe(210000);
  });
  it("non estimable : 0 au total, que le récapitulatif dit à part", () => {
    expect(computeCartLineTotal({ ...nuitee, pmsPrice: { kind: "pending" } })).toBe(0);
  });
  it("sans prix Lobby : le calcul habituel", () => {
    expect(computeCartLineTotal({ ...nuitee, pmsPrice: null })).toBe(80000);
  });
});
