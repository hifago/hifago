// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// L'écran de réconciliation affichait deux listes VIDES sur une panne — « rien à réconcilier »,
// exactement le message qu'il ne faut jamais donner à tort : une exception de paiement ou de PMS
// non traitée, c'est un client payé sans réservation. Chaque lecture en erreur lève.

const state = vi.hoisted(() => ({
  erreurs: {} as Record<string, { message: string }>,
  demandes: [] as { request_id: string; order_id: string; status: string; lines?: unknown }[],
}));

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
      if (error) return { data: null, error };
      if (nom === "admin_pms_booking_requests") return { data: state.demandes, error: null };
      return { data: [RESUME], error: null };
    },
  }),
}));

const { loadReconciliationPage } = await import("./loadReconciliationPage");

describe("loadReconciliationPage — panne ≠ rien à réconcilier", () => {
  beforeEach(() => {
    state.erreurs = {};
    state.demandes = [];
  });

  it("rend les deux listes", async () => {
    const page = await loadReconciliationPage();
    expect(page.paymentRows).toHaveLength(1);
    expect(page.paymentRows[0]).toMatchObject({ orderReference: "HFG-000001", amountCop: 17000 });
    expect(page.rows).toEqual([
      {
        id: "e1", detail: null, status: "open", attempts: 2, orderId: "o1", orderLineId: "l1",
        holderName: "Ana", establishmentName: "Casa", pmsRequest: null,
      },
    ]);
  });

  it.each([["failed"], ["needs_human"]])("joint la demande de booking BLOQUÉE (%s) à l'entrée de sa commande", async (status) => {
    state.demandes = [{ request_id: "r1", order_id: "o1", status }];
    const page = await loadReconciliationPage();
    expect(page.rows[0].pmsRequest).toEqual({ id: "r1", status, lines: [] });
  });

  it("rend les nuits sans booking de la demande bloquée (un champ de saisie chacune), lecture défensive", async () => {
    state.demandes = [
      {
        request_id: "r1", order_id: "o1", status: "failed",
        lines: [
          { order_line_id: "l1", product_name: { es: "Noche A" }, date: "2030-01-10", end_date: "2030-01-12" },
          { order_line_id: 12 },
          "n'importe quoi",
        ],
      },
    ];
    const page = await loadReconciliationPage();
    expect(page.rows[0].pmsRequest?.lines).toEqual([
      { orderLineId: "l1", productName: "Noche A", date: "2030-01-10", endDate: "2030-01-12" },
    ]);
  });

  it.each([["pending"], ["done"], ["cancelled"]])("une demande %s n'ouvre aucun levier admin", async (status) => {
    state.demandes = [{ request_id: "r1", order_id: "o1", status }];
    const page = await loadReconciliationPage();
    expect(page.rows[0].pmsRequest).toBeNull();
  });

  it.each([["payment_reconciliation_entries"], ["pms_reconciliation_entries"], ["admin_order_line_summaries"], ["admin_pms_booking_requests"]])(
    "lève si la lecture %s échoue",
    async (cle) => {
      state.erreurs = { [cle]: { message: "panne" } };
      await expect(loadReconciliationPage()).rejects.toBeTruthy();
    }
  );
});
