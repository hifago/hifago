// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPmsFixtureCalls,
  resetPmsFixtureCalls,
  setPmsFixtureScenario,
  startPmsFixtureServer,
} from "@hifago/e2e-support";
import { addDaysIso, todayInBogota } from "@hifago/domain";

// LE DEVIS DE /pago, exercé contre le VRAI serveur HTTP de fixtures Lobby (packages/e2e-support) ;
// seule la base est simulée, en reproduisant les trois requêtes que quoteCart émet.
const PORT = 34581;
const DORM = 9631;
const TENTE = 29376;
const ACCOUNT = "a0000000-0000-4000-8000-000000000001";

interface CartRow {
  id: string;
  product_id: string;
  date: string;
  end_date: string | null;
  qty: number;
  products: { type: string; lobby_category_id: number | null; unit: string | null; establishment_id: string } | null;
}
let cart: CartRow[] = [];
let establishments: { id: string; lobby_connector_active: boolean; lobby_api_token: string | null; lobby_dynamic_pricing: boolean }[] = [];
let rpcCalls: { name: string; args: { p_account_id: string; p_quotes: Record<string, unknown>[] } }[] = [];
let rpcAnswer: { data: unknown; error: unknown } | null = null;

vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        in(column: string, values: unknown[]) {
          filters[column] = values;
          return builder;
        },
        returns: async () =>
          table === "cart_items"
            ? { data: filters.account_id === ACCOUNT ? cart : [], error: null }
            : { data: establishments.filter((row) => (filters.id as string[]).includes(row.id)), error: null },
      };
      return builder;
    },
    rpc: async (name: string, args: { p_account_id: string; p_quotes: Record<string, unknown>[] }) => {
      rpcCalls.push({ name, args });
      return rpcAnswer ?? { data: { ok: true, recorded: args.p_quotes.length, rejected: 0 }, error: null };
    },
  }),
}));

let close: () => Promise<void>;
let quoteCart: typeof import("./quoteCart").quoteCart;

// Un séjour de deux nuits dans 40 jours : vendredi-samedi n'importe, seules les DATES comptent.
const d0 = addDaysIso(todayInBogota(), 40);
const d1 = addDaysIso(d0, 1);
const d2 = addDaysIso(d0, 2);

function ligne(id: string, over: Partial<CartRow> = {}, category = DORM, unit = "per_person"): CartRow {
  return {
    id,
    product_id: `p-${id}`,
    date: d0,
    end_date: d2,
    qty: 2,
    products: { type: "lodging", lobby_category_id: category, unit, establishment_id: "e1" },
    ...over,
  };
}

beforeAll(async () => {
  const server = await startPmsFixtureServer(PORT);
  process.env.LOBBY_API_BASE_URL = server.url;
  close = server.close;
  ({ quoteCart } = await import("./quoteCart"));
});

afterAll(async () => {
  delete process.env.LOBBY_API_BASE_URL;
  await close();
});

beforeEach(() => {
  resetPmsFixtureCalls();
  rpcCalls = [];
  rpcAnswer = null;
  establishments = [{ id: "e1", lobby_connector_active: true, lobby_api_token: "tok", lobby_dynamic_pricing: true }];
  cart = [ligne("c1")];
  // Le premier soir 45 000 le lit, le second 60 000 (en chaîne, comme Lobby l'écrit parfois).
  setPmsFixtureScenario({
    catalogCategoryIds: [DORM, TENTE],
    pricesByCategory: { [DORM]: [{ people: 1, value: 45000 }], [TENTE]: [{ people: 1, value: 120000 }, { people: 2, value: 180000 }] },
    nightAvailabilityByDate: { [d1]: { availableByCategory: { [DORM]: 5, [TENTE]: 3 }, pricesByCategory: { [DORM]: [{ people: 1, value: "60000.00" }], [TENTE]: [{ people: 2, value: 210000 }] } } },
  });
});

describe("quoteCart — le prix Lobby lu à chaud sur /pago", () => {
  it("le prix de CHAQUE nuit × qty, enregistré pour create_order (ventilation, places cotées)", async () => {
    const quotes = await quoteCart(ACCOUNT);
    expect(quotes.get("c1")).toEqual({
      ok: true,
      unitPriceCop: 105_000,
      totalCop: 210_000,
      nightly: [
        { date: d0, unitPriceCop: 45_000 },
        { date: d1, unitPriceCop: 60_000 },
      ],
    });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("record_pms_cart_quotes");
    expect(rpcCalls[0].args.p_account_id).toBe(ACCOUNT);
    expect(rpcCalls[0].args.p_quotes).toEqual([
      {
        cart_item_id: "c1",
        product_id: "p-c1",
        date: d0,
        end_date: d2,
        nightly_unit_prices: [
          { date: d0, unit_price_cop: 45_000 },
          { date: d1, unit_price_cop: 60_000 },
        ],
        min_available_cupos: 5,
      },
    ]);
  });

  it("toujours FRAIS : deux rendus de /pago, deux lectures Lobby — jamais le cache de la fiche", async () => {
    await quoteCart(ACCOUNT);
    await quoteCart(ACCOUNT);
    expect(getPmsFixtureCalls("/api/v2/available-rooms")).toBe(2);
  });

  it("un appel par établissement et par plage : deux lignes aux mêmes dates n'en coûtent qu'un", async () => {
    cart = [ligne("c1"), ligne("c2", { qty: 1 }, TENTE, "per_two")];
    const quotes = await quoteCart(ACCOUNT);
    expect(getPmsFixtureCalls("/api/v2/available-rooms")).toBe(1);
    // per_two : le prix à deux personnes de la tente, 180 000 puis 210 000.
    expect(quotes.get("c2")).toMatchObject({ ok: true, totalCop: 390_000 });
  });

  it("2 lits libres une nuit, 3 demandés : pms_capacity_exceeded, et le devis est QUAND MÊME enregistré", async () => {
    cart = [ligne("c1", { qty: 3 })];
    setPmsFixtureScenario({
      catalogCategoryIds: [DORM],
      pricesByCategory: { [DORM]: [{ people: 1, value: 45000 }] },
      nightAvailabilityByDate: { [d1]: { availableByCategory: { [DORM]: 2 } , pricesByCategory: { [DORM]: [{ people: 1, value: 45000 }] } } },
    });
    const quotes = await quoteCart(ACCOUNT);
    expect(quotes.get("c1")).toEqual({ ok: false, reason: "pms_capacity_exceeded" });
    expect(rpcCalls[0].args.p_quotes[0]).toMatchObject({ min_available_cupos: 2 });
  });

  it("une nuit cotée sans prix : pms_quote_missing, rien d'enregistré — jamais un prix fabriqué", async () => {
    setPmsFixtureScenario({
      catalogCategoryIds: [DORM],
      pricesByCategory: {},
      nightAvailabilityByDate: { [d0]: { availableByCategory: { [DORM]: 5 }, pricesByCategory: { [DORM]: [{ people: 1, value: 45000 }] } } },
    });
    const quotes = await quoteCart(ACCOUNT);
    expect(quotes.get("c1")).toEqual({ ok: false, reason: "pms_quote_missing" });
    expect(rpcCalls).toHaveLength(0);
  });

  it.each([
    ["un 500", 500],
    ["un 429 (quota)", 429],
  ])("Lobby répond %s : échec fermé, pms_quote_missing, rien d'enregistré", async (_cas, status) => {
    setPmsFixtureScenario({ catalogCategoryIds: [DORM], nightAvailabilityByDate: { [d0]: { status } } });
    const quotes = await quoteCart(ACCOUNT);
    expect(quotes.get("c1")).toEqual({ ok: false, reason: "pms_quote_missing" });
    expect(rpcCalls).toHaveLength(0);
  });

  it("Lobby ne répond pas à temps : échec fermé, la page n'attend pas indéfiniment", async () => {
    setPmsFixtureScenario({
      catalogCategoryIds: [DORM],
      pricesByCategory: { [DORM]: [{ people: 1, value: 45000 }] },
      availableRoomsDelayMs: 500,
    });
    const quotes = await quoteCart(ACCOUNT, { timeoutMs: 100 });
    expect(quotes.get("c1")).toEqual({ ok: false, reason: "pms_quote_missing" });
    expect(rpcCalls).toHaveLength(0);
  });

  it("l'écriture du devis échoue : la ligne est rendue pms_quote_missing, jamais « devisée »", async () => {
    rpcAnswer = { data: null, error: { message: "panne" } };
    const quotes = await quoteCart(ACCOUNT);
    expect(quotes.get("c1")).toEqual({ ok: false, reason: "pms_quote_missing" });
  });

  it("interrupteur éteint, connecteur coupé ou ligne hors Lobby : non concernée, aucun appel", async () => {
    establishments = [{ id: "e1", lobby_connector_active: true, lobby_api_token: "tok", lobby_dynamic_pricing: false }];
    cart = [ligne("c1"), ligne("c3", { products: { type: "activity", lobby_category_id: null, unit: null, establishment_id: "e1" } })];
    expect((await quoteCart(ACCOUNT)).size).toBe(0);
    establishments = [{ id: "e1", lobby_connector_active: false, lobby_api_token: "tok", lobby_dynamic_pricing: true }];
    expect((await quoteCart(ACCOUNT)).size).toBe(0);
    expect(getPmsFixtureCalls("/api/v2/available-rooms")).toBe(0);
  });
});
