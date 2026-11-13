import { describe, expect, it } from "vitest";
import { planPayAll } from "./payAll";

describe("planPayAll", () => {
  it("envoie toutes les entrées chargées et leur total", () => {
    expect(
      planPayAll(
        [
          { id: "a", amountCop: 33150 },
          { id: "b", amountCop: 8000 },
        ],
        2
      )
    ).toEqual({ ok: true, ids: ["a", "b"], totalCop: 41150 });
  });

  it("refuse une liste tronquée : payer « tout » n'en paierait qu'une partie", () => {
    expect(planPayAll([{ id: "a", amountCop: 1000 }], 101)).toEqual({ ok: false, reason: "too_many" });
  });

  it("rien à payer", () => {
    expect(planPayAll([], 0)).toEqual({ ok: false, reason: "empty" });
  });
});
