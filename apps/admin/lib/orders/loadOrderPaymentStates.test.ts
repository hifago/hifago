// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { loadOrderPaymentStates } from "./loadOrderPaymentStates";

// Lecture du paiement de chaque commande d'une page : `orders.payment_status` (lisible par l'admin,
// sans migration) croisé avec l'acompte dû de admin_order_line_ledger — seulement pour les commandes qui
// attendent un paiement. Une panne LÈVE : lue comme « payée » ou « impayée », ce serait faux.
function client(opts: {
  orders?: { id: string; payment_status: string }[];
  ordersError?: boolean;
  ledgers?: Record<string, { status: string; acompte_cop: number }[]>;
  ledgerError?: boolean;
}) {
  const rpc = vi.fn(async (_name: string, args: { p_order_id: string }) =>
    opts.ledgerError
      ? { data: null, error: { message: "panne" } }
      : { data: opts.ledgers?.[args.p_order_id] ?? [], error: null }
  );
  const supabase = {
    from: () => ({
      select: () => ({
        in: async () =>
          opts.ordersError ? { data: null, error: { message: "panne" } } : { data: opts.orders ?? [], error: null },
      }),
    }),
    rpc,
  };
  return { supabase: supabase as never, rpc };
}

describe("loadOrderPaymentStates", () => {
  it("une commande payée ou remboursée ne coûte AUCUNE lecture de ledger", async () => {
    const { supabase, rpc } = client({
      orders: [
        { id: "o1", payment_status: "paid" },
        { id: "o2", payment_status: "partially_refunded" },
        { id: "o3", payment_status: "refunded" },
      ],
    });
    const states = await loadOrderPaymentStates(supabase, ["o1", "o2", "o3"]);
    expect([...states]).toEqual([["o1", "paid"], ["o2", "paid"], ["o3", "refunded"]]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("impayée avec un acompte dû → unpaid ; paiement en cours → in_progress", async () => {
    const { supabase } = client({
      orders: [
        { id: "o1", payment_status: "unpaid" },
        { id: "o2", payment_status: "pending" },
      ],
      ledgers: {
        o1: [{ status: "reserved", acompte_cop: 17000 }],
        o2: [{ status: "reserved", acompte_cop: 17000 }],
      },
    });
    const states = await loadOrderPaymentStates(supabase, ["o1", "o2"]);
    expect(states.get("o1")).toBe("unpaid");
    expect(states.get("o2")).toBe("in_progress");
  });

  it("impayée SANS acompte dû (evento gratuit / sur place) → not_due, jamais « sin pagar »", async () => {
    const { supabase } = client({
      orders: [{ id: "o1", payment_status: "unpaid" }],
      ledgers: { o1: [{ status: "reserved", acompte_cop: 0 }] },
    });
    expect((await loadOrderPaymentStates(supabase, ["o1"])).get("o1")).toBe("not_due");
  });

  it("les lignes mortes ne comptent pas dans l'acompte dû", async () => {
    const { supabase } = client({
      orders: [{ id: "o1", payment_status: "unpaid" }],
      ledgers: {
        o1: [
          { status: "reserved", acompte_cop: 0 },
          { status: "expired", acompte_cop: 17000 },
        ],
      },
    });
    expect((await loadOrderPaymentStates(supabase, ["o1"])).get("o1")).toBe("not_due");
  });

  it("une même commande demandée plusieurs fois n'est lue qu'une fois ; aucune commande → aucune lecture", async () => {
    const { supabase, rpc } = client({
      orders: [{ id: "o1", payment_status: "unpaid" }],
      ledgers: { o1: [{ status: "reserved", acompte_cop: 100 }] },
    });
    await loadOrderPaymentStates(supabase, ["o1", "o1", "o1"]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect((await loadOrderPaymentStates(supabase, [])).size).toBe(0);
  });

  it("une panne de lecture LÈVE (jamais lue comme payée ou impayée)", async () => {
    await expect(loadOrderPaymentStates(client({ ordersError: true }).supabase, ["o1"])).rejects.toThrow(/orders/);
    await expect(
      loadOrderPaymentStates(
        client({ orders: [{ id: "o1", payment_status: "unpaid" }], ledgerError: true }).supabase,
        ["o1"]
      )
    ).rejects.toThrow(/admin_order_line_ledger/);
  });
});
