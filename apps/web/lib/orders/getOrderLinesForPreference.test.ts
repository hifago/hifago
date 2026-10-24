// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Le détail des lignes n'enrichit que la préférence Mercado Pago : sa lecture est AU MIEUX. Là où
// `getOrderByToken` lève sur une panne (l'écran de commande ne doit jamais devenir un 404), celle-ci
// rend `null` — la route retombe alors sur l'item agrégé au même montant, et le client paie quand même.

const state = vi.hoisted(() => ({
  reponse: { data: null as unknown, error: null as unknown } as { data: unknown; error: unknown },
  leve: null as Error | null,
  appels: [] as { fn: string; args: unknown; signal: AbortSignal | undefined }[],
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    rpc: (fn: string, args: unknown) => ({
      abortSignal: async (signal?: AbortSignal) => {
        state.appels.push({ fn, args, signal });
        if (state.leve) throw state.leve;
        return state.reponse;
      },
    }),
  }),
}));

const { getOrderLinesForPreference } = await import("./getOrderLinesForPreference");

const LIGNE_RPC = {
  id: "line-1",
  product_name: { es: "Kayak" },
  product_type: "activity",
  product_slug: "kayak",
  establishment_name: { es: "Casa Kayam" },
  establishment_slug: "casa-kayam",
  establishment_contact_phone: null,
  date: "2026-11-12",
  end_date: null,
  duration_days: null,
  slot_start_time: "09:00:00",
  qty: 2,
  price_cop: 50000,
  total_cop: 100000,
  acompte_cop: 40000,
  status: "reserved",
};

describe("getOrderLinesForPreference", () => {
  beforeEach(() => {
    state.reponse = { data: { ok: true, order: { lines: [LIGNE_RPC] } }, error: null };
    state.leve = null;
    state.appels = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("lit la commande par son jeton, via la RPC get_order_by_token, avec le délai demandé", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await getOrderLinesForPreference("jeton", 3_000);
    const delais = timeout.mock.calls.map(([ms]) => ms);
    timeout.mockRestore();
    expect(state.appels).toHaveLength(1);
    expect(state.appels[0]).toMatchObject({ fn: "get_order_by_token", args: { p_token: "jeton" } });
    expect(state.appels[0].signal).toBeInstanceOf(AbortSignal);
    expect(delais).toEqual([3_000]);
  });

  it("rend les lignes avec les noms BRUTS (la résolution de langue se fait dans le constructeur)", async () => {
    const lignes = await getOrderLinesForPreference("jeton", 3_000);
    expect(lignes).toEqual([
      {
        id: "line-1",
        productName: { es: "Kayak" },
        productType: "activity",
        establishmentName: { es: "Casa Kayam" },
        date: "2026-11-12",
        endDate: null,
        durationDays: null,
        slotStartTime: "09:00:00",
        qty: 2,
        acompteCop: 40000,
        status: "reserved",
      },
    ]);
  });

  it("rend null quand la RPC répond en erreur (dont le délai dépassé) — jamais ne lève", async () => {
    state.reponse = { data: null, error: { message: "This operation was aborted" } };
    expect(await getOrderLinesForPreference("jeton", 3_000)).toBeNull();
  });

  it("rend null quand l'appel lève (client de session impossible, réseau)", async () => {
    state.leve = new Error("boom");
    expect(await getOrderLinesForPreference("jeton", 3_000)).toBeNull();
  });

  it("rend null pour un jeton refusé par la RPC ({ ok: false })", async () => {
    state.reponse = { data: { ok: false }, error: null };
    expect(await getOrderLinesForPreference("jeton", 3_000)).toBeNull();
  });

  it("rend null devant une réponse inattendue (pas de tableau de lignes)", async () => {
    for (const data of [null, {}, { ok: true }, { ok: true, order: {} }, { ok: true, order: { lines: "x" } }]) {
      state.reponse = { data, error: null };
      expect(await getOrderLinesForPreference("jeton", 3_000)).toBeNull();
    }
  });
});
