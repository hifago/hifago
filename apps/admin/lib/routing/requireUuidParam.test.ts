// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { isUuid } from "@/lib/uuid";

// Un segment d'URL qui n'est pas un UUID est un « introuvable », jamais une panne : sans ce garde,
// la lecture échouait (22P02) et les pages, qui lèvent désormais sur une erreur de lecture,
// affichaient l'écran d'erreur pour une faute de frappe.

class Introuvable extends Error {}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Introuvable("404");
  },
}));

const { requireUuidParam } = await import("./requireUuidParam");

const UUID = "b0000000-0000-4000-8000-000000000006";

describe("isUuid", () => {
  it("accepte un UUID, en minuscules comme en majuscules", () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid(UUID.toUpperCase())).toBe(true);
  });

  it.each([[""], ["abc"], [`${UUID}x`], [` ${UUID}`], [null], [undefined], [42]])(
    "refuse %j",
    (valeur) => {
      expect(isUuid(valeur)).toBe(false);
    }
  );
});

describe("requireUuidParam", () => {
  it("rend un UUID tel quel", () => {
    expect(requireUuidParam(UUID)).toBe(UUID);
  });

  it("répond introuvable pour un segment qui n'est pas un UUID", () => {
    expect(() => requireUuidParam("pas-un-uuid")).toThrow(Introuvable);
  });
});
