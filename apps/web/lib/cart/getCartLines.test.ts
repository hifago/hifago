// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Un panier illisible n'est JAMAIS un panier vide : « Tu viaje está vacío » sur une panne ferait
// croire au client qu'il a perdu ses réservations, et l'inviterait à tout recommencer. L'erreur
// lève ; l'écran d'erreur de la zone (tunnel) prend le relais.
//
// La disponibilité, elle, n'est qu'un confort (create_order reste seul juge) : sa panne ne lève
// pas, mais ne rend jamais une ligne « disponible ».

const state = vi.hoisted(() => ({
  reponse: { data: [] as unknown, error: null as unknown },
  verdicts: { data: [] as unknown, error: null as unknown },
  rpc: vi.fn(),
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => {
    const requete = {
      select: () => requete,
      order: () => requete,
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
        Promise.resolve(state.reponse).then(ok, ko),
    };
    return {
      from: () => requete,
      rpc: (...args: unknown[]) => {
        state.rpc(...args);
        return Promise.resolve(state.verdicts);
      },
    };
  },
}));

const { getCartLines, hasUnavailableLine } = await import("./getCartLines");

const ligne = (id: string) => ({
  id,
  product_id: `p-${id}`,
  date: "2026-11-05",
  end_date: null,
  slot_start_time: null,
  qty: 1,
  created_at: "2026-10-14T10:00:00Z",
  products: {
    name: { es: `Servicio ${id}` },
    type: "actividad",
    slug: `servicio-${id}`,
    price_cop: 50000,
    price_tiers: null,
    establishment_id: "e-1",
    duration_days: null,
    establishment: { id: "e-1", name: { es: "Casa" } },
  },
});

describe("getCartLines — panne ≠ panier vide", () => {
  beforeEach(() => {
    state.reponse = { data: [], error: null };
    state.verdicts = { data: [], error: null };
    state.rpc.mockClear();
  });

  it("rend [] pour un panier réellement vide", async () => {
    expect(await getCartLines("es")).toEqual([]);
  });

  it("lève si la lecture échoue", async () => {
    state.reponse = { data: null, error: { message: "panne" } };
    await expect(getCartLines("es")).rejects.toBeTruthy();
  });
});

describe("getCartLines — disponibilité de chaque ligne", () => {
  beforeEach(() => {
    state.reponse = { data: [ligne("a"), ligne("b"), ligne("c")], error: null };
    state.rpc.mockClear();
  });

  it("demande le verdict de tout le panier, sans argument", async () => {
    state.verdicts = { data: [], error: null };
    await getCartLines("es");
    expect(state.rpc).toHaveBeenCalledWith("cart_lines_availability");
  });

  it("porte sur chaque ligne le verdict de SA ligne, raison comprise", async () => {
    state.verdicts = {
      data: [
        { id: "c", available: false, reason: "full" },
        { id: "a", available: true, reason: null },
        { id: "b", available: false, reason: "date_in_past" },
      ],
      error: null,
    };
    const lignes = await getCartLines("es");
    expect(lignes.map((l) => [l.id, l.availability])).toEqual([
      ["a", { status: "available" }],
      ["b", { status: "unavailable", reason: "date_in_past" }],
      ["c", { status: "unavailable", reason: "full" }],
    ]);
  });

  it("ligne absente du verdict (ajoutée entre les deux lectures) : inconnue, jamais disponible", async () => {
    state.verdicts = { data: [{ id: "a", available: true, reason: null }], error: null };
    const lignes = await getCartLines("es");
    expect(lignes.map((l) => l.availability.status)).toEqual(["available", "unknown", "unknown"]);
  });

  it("panne du verdict : le panier s'affiche, chaque ligne « inconnue »", async () => {
    // L'erreur prime, quoi que porte `data` : un verdict partiel n'est jamais un verdict.
    state.verdicts = { data: [{ id: "a", available: true, reason: null }], error: { message: "panne" } };
    const lignes = await getCartLines("es");
    expect(lignes).toHaveLength(3);
    expect(lignes.every((l) => l.availability.status === "unknown")).toBe(true);
  });
});

describe("getCartLines — produit masqué par la RLS (plus en vente)", () => {
  beforeEach(() => {
    state.reponse = { data: [{ ...ligne("a"), products: null }], error: null };
  });

  it.each([
    ["verdict en panne", { data: null, error: { message: "panne" } }],
    ["verdict absent", { data: [], error: null }],
    ["verdict « disponible »", { data: [{ id: "a", available: true, reason: null }], error: null }],
  ])("signalé not_sellable — %s", async (_cas, verdicts) => {
    state.verdicts = verdicts;
    expect((await getCartLines("es"))[0].availability).toEqual({ status: "unavailable", reason: "not_sellable" });
  });
});

describe("hasUnavailableLine — ce qui ferme l'envoi sur /pago", () => {
  const avec = (...statuts: ("available" | "unknown" | "unavailable")[]) =>
    statuts.map((status) => ({
      availability: status === "unavailable" ? { status, reason: "full" } : { status },
    })) as Parameters<typeof hasUnavailableLine>[0];

  it("une ligne signalée ferme l'envoi", () => {
    expect(hasUnavailableLine(avec("available", "unavailable"))).toBe(true);
  });

  it("une disponibilité illisible ne le ferme pas : create_order tranchera", () => {
    expect(hasUnavailableLine(avec("unknown", "unknown"))).toBe(false);
    expect(hasUnavailableLine(avec("available", "unknown"))).toBe(false);
  });

  it("tout disponible, ou panier vide : ouvert", () => {
    expect(hasUnavailableLine(avec("available"))).toBe(false);
    expect(hasUnavailableLine([])).toBe(false);
  });
});
