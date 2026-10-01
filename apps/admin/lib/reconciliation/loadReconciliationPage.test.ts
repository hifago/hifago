// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// L'écran de réconciliation affichait deux listes VIDES sur une panne — « rien à réconcilier »,
// exactement le message qu'il ne faut jamais donner à tort : une exception de paiement ou de PMS
// non traitée, c'est un client payé sans réservation. Chaque lecture en erreur lève.

const state = vi.hoisted(() => ({ erreurs: {} as Record<string, { message: string }> }));

const ENTREE_PAIEMENT = {
  id: "pe1",
  kind: "webhook_rejected",
  status: "open",
  failure_reason: "amount_mismatch",
  mp_payment_id: "123",
  created_at: "2026-09-30T10:00:00Z",
  payment: { order_id: "o1", amount_cop: 17000, order: { reference: "HFG-000001", holder_name: "Ana" } },
  refunds: [],
};
const ENTREE_PMS = { id: "e1", status: "open", attempts: 2, detail: null, order_line_id: "l1" };
const RESUME = { order_line_id: "l1", order_id: "o1", holder_name: "Ana", establishment_name: { es: "Casa" } };

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const resultat = () => {
        const error = state.erreurs[table] ?? null;
        if (error) return { data: null, error };
        return {
          data: table === "payment_reconciliation_entries" ? [ENTREE_PAIEMENT] : [ENTREE_PMS],
          error: null,
        };
      };
      const requete: Record<string, unknown> = {};
      for (const m of ["select", "order", "returns"]) requete[m] = () => requete;
      requete.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
        Promise.resolve(resultat()).then(ok, ko);
      return requete;
    },
    rpc: async (nom: string) => {
      const error = state.erreurs[nom] ?? null;
      return error ? { data: null, error } : { data: [RESUME], error: null };
    },
  }),
}));

const { loadReconciliationPage } = await import("./loadReconciliationPage");

describe("loadReconciliationPage — panne ≠ rien à réconcilier", () => {
  beforeEach(() => {
    state.erreurs = {};
  });

  it("rend les deux listes", async () => {
    const page = await loadReconciliationPage();
    expect(page.paymentRows).toHaveLength(1);
    expect(page.paymentRows[0]).toMatchObject({ orderReference: "HFG-000001", amountCop: 17000 });
    expect(page.rows).toEqual([
      { id: "e1", detail: null, status: "open", attempts: 2, orderId: "o1", holderName: "Ana", establishmentName: "Casa" },
    ]);
  });

  it.each([["payment_reconciliation_entries"], ["pms_reconciliation_entries"], ["admin_order_line_summaries"]])(
    "lève si la lecture %s échoue",
    async (cle) => {
      state.erreurs = { [cle]: { message: "panne" } };
      await expect(loadReconciliationPage()).rejects.toBeTruthy();
    }
  );
});
