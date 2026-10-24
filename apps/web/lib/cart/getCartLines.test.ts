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
  // Prix Lobby (2026-10-23) : les nuits du miroir que lit l'estimation.
  miroir: { data: [] as unknown, error: null as unknown },
  rpc: vi.fn(),
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => {
    const requeteDe = (table: string) => {
      const requete = {
        select: () => requete,
        order: () => requete,
        in: () => requete,
        gte: () => requete,
        lt: () => requete,
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
          Promise.resolve(table === "pms_availability_mirror" ? state.miroir : state.reponse).then(ok, ko),
      };
      return requete;
    };
    return {
      from: (table: string) => requeteDe(table),
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

describe("getCartLines — une nuitée au prix Lobby (lobby_dynamic_pricing, 2026-10-23)", () => {
  // Deux nuits, 2 lits, établissement au prix Lobby.
  const nuitee = (id: string) => ({
    ...ligne(id),
    date: "2026-11-06",
    end_date: "2026-11-08",
    qty: 2,
    products: {
      ...ligne(id).products,
      type: "lodging",
      lobby_category_id: 9631,
      unit: "per_person",
      establishment: { id: "e-1", name: { es: "Casa" }, lobby_dynamic_pricing: true },
    },
  });
  const miroir = [
    { establishment_id: "e-1", lobby_category_id: 9631, date: "2026-11-06", prices: { 1: 45000 } },
    { establishment_id: "e-1", lobby_category_id: 9631, date: "2026-11-07", prices: { 1: 60000 } },
  ];

  beforeEach(() => {
    state.reponse = { data: [nuitee("a")], error: null };
    state.miroir = { data: miroir, error: null };
  });

  it("/mi-viaje : sans devis, la ligne reste disponible, au prix estimé du miroir (Σ nuits × qty)", async () => {
    state.verdicts = { data: [{ id: "a", available: false, reason: "pms_quote_missing" }], error: null };
    const [line] = await getCartLines("es");
    expect(line.availability).toEqual({ status: "available" });
    expect(line.pmsPrice).toEqual({ kind: "estimated", totalCop: 210000 });
  });

  it("/mi-viaje : une nuit absente du miroir — « precio confirmado en el pago », jamais un total partiel", async () => {
    state.verdicts = { data: [{ id: "a", available: false, reason: "pms_quote_expired" }], error: null };
    state.miroir = { data: miroir.slice(0, 1), error: null };
    const [line] = await getCartLines("es");
    expect(line.availability).toEqual({ status: "available" });
    expect(line.pmsPrice).toEqual({ kind: "pending" });
  });

  it("/mi-viaje : un refus qui n'est pas « pas encore de devis » reste un refus", async () => {
    state.verdicts = { data: [{ id: "a", available: false, reason: "pms_capacity_exceeded" }], error: null };
    const [line] = await getCartLines("es");
    expect(line.availability).toEqual({ status: "unavailable", reason: "pms_capacity_exceeded" });
  });

  it("/pago : le devis frais fait foi, avec ce que le miroir laissait attendre", async () => {
    state.verdicts = { data: [{ id: "a", available: true, reason: null }], error: null };
    const pmsQuotes = new Map([["a", { ok: true as const, totalCop: 230000, unitPriceCop: 115000, nightly: [] }]]);
    const [line] = await getCartLines("es", { pmsQuotes });
    expect(line.pmsPrice).toEqual({ kind: "quoted", totalCop: 230000, estimateCop: 210000 });
    expect(line.availability).toEqual({ status: "available" });
  });

  it("/pago : le devis a échoué — la ligne ferme l'envoi, même si la base a encore un ancien devis", async () => {
    state.verdicts = { data: [{ id: "a", available: true, reason: null }], error: null };
    const pmsQuotes = new Map([["a", { ok: false as const, reason: "pms_quote_missing" as const }]]);
    const lines = await getCartLines("es", { pmsQuotes });
    expect(lines[0].availability).toEqual({ status: "unavailable", reason: "pms_quote_missing" });
    expect(hasUnavailableLine(lines)).toBe(true);
  });

  it("/pago : une raison plus précise de la base est gardée", async () => {
    state.verdicts = { data: [{ id: "a", available: false, reason: "qty_cap_exceeded" }], error: null };
    const pmsQuotes = new Map([["a", { ok: false as const, reason: "pms_quote_missing" as const }]]);
    const [line] = await getCartLines("es", { pmsQuotes });
    expect(line.availability).toEqual({ status: "unavailable", reason: "qty_cap_exceeded" });
  });

  it("interrupteur éteint : aucun prix Lobby, le calcul habituel du panier", async () => {
    const fixe = nuitee("a");
    fixe.products.establishment.lobby_dynamic_pricing = false;
    state.reponse = { data: [fixe], error: null };
    state.verdicts = { data: [{ id: "a", available: true, reason: null }], error: null };
    const [line] = await getCartLines("es");
    expect(line.pmsPrice).toBeNull();
  });
});
