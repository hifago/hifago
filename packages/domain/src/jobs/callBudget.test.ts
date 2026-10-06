import { describe, expect, it } from "vitest";
import { createCallBudget } from "./callBudget";

describe("createCallBudget", () => {
  function horloge(depart = 1_000) {
    let t = depart;
    return { now: () => t, avancer: (ms: number) => (t += ms) };
  }

  it("plafonne chaque appel, puis le borne à ce qui reste du budget", () => {
    const h = horloge();
    const next = createCallBudget(h.now, 20_000, 8_000);
    expect(next()).toBe(8_000);
    h.avancer(14_000);
    expect(next()).toBe(6_000);
    h.avancer(4_000);
    expect(next()).toBe(2_000);
  });

  it("rend null sous le minimum d'un appel : le passage s'arrête au lieu d'échouer", () => {
    const h = horloge();
    const next = createCallBudget(h.now, 20_000, 8_000);
    h.avancer(18_501);
    expect(next()).toBeNull();
    h.avancer(10_000);
    expect(next()).toBeNull();
  });

  it("le minimum est réglable, et la borne exacte rend encore un délai", () => {
    const h = horloge();
    const next = createCallBudget(h.now, 10_000, 8_000, 3_000);
    h.avancer(7_000);
    expect(next()).toBe(3_000);
    h.avancer(1);
    expect(next()).toBeNull();
  });
});
