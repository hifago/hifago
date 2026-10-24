import { acompteDue, orderPaymentState, type OrderPaymentState } from "@hifago/domain";
import type { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// L'état de paiement de chaque commande d'une page de liste, SANS migration : `orders.payment_status`
// est lisible par l'admin (policy orders_select), et l'acompte dû — nécessaire pour ne pas marquer
// « impayée » une commande ferme sans paiement en ligne (evento gratuit / sur place), dont le
// payment_status reste `unpaid` pour toujours — vient de admin_order_line_ledger, UNIQUEMENT pour les
// commandes qui attendent un paiement (une commande payée ou remboursée n'en a pas besoin).
//
// Chaque lecture LÈVE sur une panne (checkedRead) : une panne lue comme « payée » ou « impayée » serait
// une réponse plausible et fausse.
export async function loadOrderPaymentStates(
  supabase: Supabase,
  orderIds: string[]
): Promise<Map<string, OrderPaymentState>> {
  const ids = [...new Set(orderIds)];
  const states = new Map<string, OrderPaymentState>();
  if (ids.length === 0) return states;

  const { data: orders } = checkedRead(
    await supabase.from("orders").select("id, payment_status").in("id", ids),
    "orders"
  );

  const awaiting: { id: string; paymentStatus: string }[] = [];
  for (const order of orders ?? []) {
    const settled = orderPaymentState(order.payment_status, null);
    if (settled === "paid" || settled === "refunded") states.set(order.id, settled);
    else awaiting.push({ id: order.id, paymentStatus: order.payment_status });
  }

  // Une lecture par commande en attente (en parallèle) : leur nombre est borné par la page.
  const dues = await Promise.all(
    awaiting.map(async (order) => {
      const { data: ledgerLines } = checkedRead(
        await supabase.rpc("admin_order_line_ledger", { p_order_id: order.id }),
        "admin_order_line_ledger"
      );
      return { order, due: acompteDue(ledgerLines ?? []) };
    })
  );
  for (const { order, due } of dues) {
    states.set(order.id, orderPaymentState(order.paymentStatus, due));
  }

  // Une commande introuvable sous RLS (ne devrait pas arriver pour un admin) n'a pas d'état : l'appelant
  // retombe sur le statut brut de la ligne, jamais sur « payée ».
  return states;
}
