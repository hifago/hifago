// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkedRead } from "./checkedRead";

describe("checkedRead", () => {
  it("rend le résultat d'une lecture réussie, data et count compris", () => {
    const resultat = { data: [{ id: "a" }], count: 3, error: null };
    expect(checkedRead(resultat, "products")).toBe(resultat);
  });

  it("une absence (data null, sans erreur) reste une absence", () => {
    expect(checkedRead({ data: null, error: null }, "products").data).toBeNull();
  });

  it("lève sur une erreur, en nommant la source", () => {
    expect(() =>
      checkedRead({ data: null, error: { message: "connection refused" } }, "establishment_media")
    ).toThrow("Lecture impossible (establishment_media) : connection refused");
  });
});
