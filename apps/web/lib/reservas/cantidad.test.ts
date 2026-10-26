import { describe, expect, it } from "vitest";
import { limitarCantidad, pisoCantidad, plafondCantidad, topeCantidad } from "./cantidad";

describe("limitarCantidad", () => {
  it("laisse passer une valeur dans les bornes", () => {
    expect(limitarCantidad(3, 1, 8)).toBe(3);
  });

  it("remonte à 1 ce qui est sous la borne basse par défaut (min_qty absent)", () => {
    expect(limitarCantidad(0, 1, 8)).toBe(1);
    expect(limitarCantidad(-5, 1, 8)).toBe(1);
  });

  it("plafonne au maximum", () => {
    expect(limitarCantidad(99, 1, 8)).toBe(8);
  });

  it("un maximum de zéro laisse quand même saisir 1 — sinon la borne haute passe sous la basse", () => {
    expect(limitarCantidad(1, 1, 0)).toBe(1);
    expect(limitarCantidad(5, 1, 0)).toBe(1);
  });

  it("NaN retombe sur le plancher — c'est la garde qui n'existait que dans UN des trois formulaires", () => {
    // `Math.max(NaN, 1)` vaut NaN, et `setQty(NaN)` passait sans rien casser de visible :
    // le champ se vidait, le bouton restait actif. Spec 30 §7a, duplication n°1.
    expect(limitarCantidad(Number.NaN, 1, 8)).toBe(1);
  });

  it("l'infini retombe sur le plancher, jamais sur le maximum", () => {
    // Un plafonnement à `max` serait défendable, mais un nombre non fini vient toujours d'une
    // saisie cassée : repartir du plancher est le seul comportement qui ne prétend rien.
    expect(limitarCantidad(Number.POSITIVE_INFINITY, 1, 8)).toBe(1);
    expect(limitarCantidad(Number.NEGATIVE_INFINITY, 1, 8)).toBe(1);
  });

  // Retour Jérôme (2026-09-14, produit "Hiking Group", min_qty: 2) — create_order refusait déjà
  // qty_below_minimum, rien au-dessus n'empêchait ni ne signalait la saisie d'1.
  describe("min_qty > 1 (Jérôme, 2026-09-14)", () => {
    it("remonte une saisie sous le plancher AU plancher, pas à 1", () => {
      expect(limitarCantidad(1, 2, 10)).toBe(2);
      expect(limitarCantidad(0, 2, 10)).toBe(2);
    });

    it("NaN retombe sur le plancher, pas sur 1", () => {
      expect(limitarCantidad(Number.NaN, 2, 10)).toBe(2);
    });

    it("laisse passer une saisie déjà conforme au plancher", () => {
      expect(limitarCantidad(2, 2, 10)).toBe(2);
      expect(limitarCantidad(5, 2, 10)).toBe(5);
    });

    it("plus qu'une place restante mais min_qty=2 : retombe sur ce qui est réellement disponible, jamais bloqué", () => {
      // Aucune quantité ne satisferait à la fois le plancher (2) et le plafond (1) — create_order
      // reste le filet fail-closed (qty_below_minimum) si le client valide quand même.
      expect(limitarCantidad(2, 2, 1)).toBe(1);
    });
  });
});

describe("pisoCantidad", () => {
  it("jamais sous 1", () => {
    expect(pisoCantidad(0, 10)).toBe(1);
    expect(pisoCantidad(-3, 10)).toBe(1);
  });

  it("reflète min_qty quand il tient sous le maximum", () => {
    expect(pisoCantidad(2, 10)).toBe(2);
  });

  it("ne dépasse jamais le maximum disponible", () => {
    expect(pisoCantidad(2, 1)).toBe(1);
  });
});

describe("topeCantidad", () => {
  it("jamais sous 1", () => {
    expect(topeCantidad(0)).toBe(1);
    expect(topeCantidad(-3)).toBe(1);
  });

  it("reflète le maximum sinon", () => {
    expect(topeCantidad(8)).toBe(8);
  });
});

describe("plafondCantidad", () => {
  const restantes = new Map([
    ["2026-12-20", 8],
    ["2026-12-21", 2],
    ["2026-12-22", 5],
  ]);

  it("sans plage : le maximum des nuits chargées, borné par max_qty", () => {
    expect(plafondCantidad(20, restantes, [])).toBe(8);
    expect(plafondCantidad(6, restantes, [])).toBe(6);
  });

  it("sur une plage : la nuit la moins fournie borne (2 lits libres une nuit)", () => {
    expect(plafondCantidad(20, restantes, ["2026-12-20", "2026-12-21", "2026-12-22"])).toBe(2);
    expect(plafondCantidad(20, restantes, ["2026-12-20"])).toBe(8);
  });

  it("une nuit absente de la map vaut 0 — fail-closed", () => {
    expect(plafondCantidad(20, restantes, ["2026-12-20", "2026-12-23"])).toBe(0);
  });

  // Migration 20261025120000 : un logement n'a plus de plafond par réservation (maxQty null) — un
  // dortoir de 30 lits libres se prend en entier, l'ancien repli 20 ne bride plus rien.
  it("sans plafond produit : seules les nuits bornent, au-delà de l'ancien repli 20", () => {
    const dortoir = new Map([["2026-12-20", 30], ["2026-12-21", 25]]);
    expect(plafondCantidad(null, dortoir, [])).toBe(30);
    expect(plafondCantidad(null, dortoir, ["2026-12-20", "2026-12-21"])).toBe(25);
  });

  it("rien de chargé : maxQty s'il existe, sinon 1 (rien n'est encore réservable)", () => {
    expect(plafondCantidad(null, new Map(), [])).toBe(1);
    expect(plafondCantidad(6, new Map(), [])).toBe(6);
  });
});
