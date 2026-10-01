// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Un panier illisible n'est JAMAIS un panier vide : « Tu viaje está vacío » sur une panne ferait
// croire au client qu'il a perdu ses réservations, et l'inviterait à tout recommencer. L'erreur
// lève ; l'écran d'erreur de la zone (tunnel) prend le relais.

const state = vi.hoisted(() => ({
  reponse: { data: [] as unknown, error: null as unknown },
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => {
    const requete = {
      select: () => requete,
      order: () => requete,
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
        Promise.resolve(state.reponse).then(ok, ko),
    };
    return { from: () => requete };
  },
}));

const { getCartLines } = await import("./getCartLines");

describe("getCartLines — panne ≠ panier vide", () => {
  beforeEach(() => {
    state.reponse = { data: [], error: null };
  });

  it("rend [] pour un panier réellement vide", async () => {
    expect(await getCartLines("es")).toEqual([]);
  });

  it("lève si la lecture échoue", async () => {
    state.reponse = { data: null, error: { message: "panne" } };
    await expect(getCartLines("es")).rejects.toBeTruthy();
  });
});
