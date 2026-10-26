import { describe, expect, it } from "vitest";
import type { CartLine } from "@/lib/cart/CartContext";
import { finDePlage, heuresCouvertes, heuresLibresDepuis, ocupacionCarritoPorHora } from "./horas";

// Spec 43 — miroir côté fiche de public.order_line_slot_units.
describe("heuresCouvertes", () => {
  it("couvre chaque heure de la plage", () => {
    expect(heuresCouvertes("10:00", 3)).toEqual(["10:00", "11:00", "12:00"]);
  });
  it("s'arrête à minuit, comme la base", () => {
    expect(heuresCouvertes("22:00:00", 3)).toEqual(["22:00", "23:00"]);
  });
  it("donne l'heure de fin", () => {
    expect(finDePlage("10:00", 3)).toBe("13:00");
  });
});

describe("ocupacionCarritoPorHora", () => {
  const ligne = (over: Partial<CartLine>): CartLine =>
    ({ id: "l", productId: "p", date: "2029-06-04", qty: 1, ...over }) as CartLine;

  it("une ligne de 3 h compte 1 sur chacune de ses heures, jamais 3 sur la première", () => {
    const mapa = ocupacionCarritoPorHora([ligne({ slotStartTime: "10:00", qty: 3 })], "p");
    expect([...mapa.entries()]).toEqual([
      ["2029-06-04|10:00", 1],
      ["2029-06-04|11:00", 1],
      ["2029-06-04|12:00", 1],
    ]);
  });
  it("ignore les autres produits et les lignes sans créneau", () => {
    const mapa = ocupacionCarritoPorHora(
      [ligne({ productId: "autre", slotStartTime: "10:00" }), ligne({ slotStartTime: undefined })],
      "p"
    );
    expect(mapa.size).toBe(0);
  });
});

describe("heuresLibresDepuis", () => {
  const h = (debut: string, restantes = 1, dureeMinutes = 60) => ({ debut, restantes, dureeMinutes });

  it("compte les heures consécutives libres à partir de chaque début", () => {
    const libres = heuresLibresDepuis([h("08:00"), h("09:00"), h("10:00", 0), h("11:00"), h("12:00")]);
    expect(libres.get("08:00")).toBe(2);
    expect(libres.get("09:00")).toBe(1);
    expect(libres.get("10:00")).toBe(0);
    expect(libres.get("11:00")).toBe(2);
  });
  it("un trou dans les horaires arrête la plage", () => {
    const libres = heuresLibresDepuis([h("08:00"), h("10:00")]);
    expect(libres.get("08:00")).toBe(1);
  });
  it("un créneau qui ne dure pas une heure n'est jamais une heure libre", () => {
    expect(heuresLibresDepuis([h("08:00", 1, 30)]).get("08:00")).toBe(0);
  });
});
