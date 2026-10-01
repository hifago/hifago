// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// L'écran de commande est relu en boucle (`router.refresh()`) au retour de Mercado Pago : une
// panne passagère n'y est JAMAIS une commande inexistante. Seule la réponse `{ ok: false }` de la
// RPC — jeton inconnu, malformé ou absent — rend `null` (donc 404) ; une erreur lève (500).

const state = vi.hoisted(() => ({
  reponse: { data: null as unknown, error: null as unknown },
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({ rpc: async () => state.reponse }),
}));

const { getOrderByToken } = await import("./getOrderByToken");

const COMMANDE = {
  id: "o1",
  reference: "HFG-000001",
  payment_status: "pending",
  holder_name: "Ana",
  holder_phone: null,
  holder_email: "ana@test.local",
  total_cop: 100000,
  acompte_cop: 17000,
  lines: [],
};

describe("getOrderByToken — panne ≠ jeton inconnu", () => {
  beforeEach(() => {
    state.reponse = { data: { ok: true, order: COMMANDE }, error: null };
  });

  it("rend la commande", async () => {
    expect((await getOrderByToken("t", "es"))?.reference).toBe("HFG-000001");
  });

  it("rend null pour un jeton refusé par la RPC (404 voulu)", async () => {
    state.reponse = { data: { ok: false }, error: null };
    expect(await getOrderByToken("t", "es")).toBeNull();
  });

  it("lève si la RPC échoue — jamais « cette page n'existe pas » chez un client qui vient de payer", async () => {
    state.reponse = { data: null, error: { message: "panne" } };
    await expect(getOrderByToken("t", "es")).rejects.toBeTruthy();
  });
});
