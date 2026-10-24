import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { requireUuidParam } from "@/lib/routing/requireUuidParam";
import { LedgerLinesTable } from "./LedgerLinesTable";
import { acompteDue, formatDateInBogota, orderPaymentState } from "@hifago/domain";
import { StatusChip } from "@/components/status-chip";
import { PAYMENT_STATE_CHIP_STYLE, PAYMENT_STATE_LABELS } from "@/lib/orders/paymentDisplayLabels";

export default async function AdminOrderDetailPage({
  params,
}: PageProps<"/admin/orders/[id]">) {
  const id = requireUuidParam((await params).id);
  const supabase = await createClient();

  // order et lines ne dépendent que de `id`, pas l'un de l'autre — un seul aller-retour réseau au
  // lieu de deux séquentiels. Aucune nouvelle policy : orders_select/order_lines_select (feature 6)
  // laissent déjà l'admin tout lire, cf. plan feature 12 ("aucun backend nouveau, comme la feature 9").
  const [orderResult, linesResult] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, holder_name, holder_email, holder_phone, created_at, payment_status, referrer:partners(display_name)"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.rpc("admin_order_line_ledger", { p_order_id: id }),
  ]);
  // Chaque lecture LÈVE sur une panne (lib/supabase/checkedRead.ts) : lue comme une absence, elle
  // répondait « introuvable », ou une commande sans lignes ni réconciliation.
  const { data: order } = checkedRead(orderResult, "orders");
  const { data: lines } = checkedRead(linesResult, "admin_order_line_ledger");

  if (!order) {
    notFound();
  }

  // Le paiement de la commande, croisé avec l'acompte dû : le statut `reserved` d'une ligne tient la
  // place pendant le paiement, il ne dit pas que la commande est payée.
  const paymentState = orderPaymentState(order.payment_status, acompteDue(lines ?? []));

  // Feature 22 : une éventuelle entrée de la file de réconciliation liée à cette commande, via ses
  // order_lines (pas de colonne order_id directe sur pms_reconciliation_entries). Silencieux si
  // aucune entrée — pas une anomalie pour la plupart des commandes.
  const lineIds = (lines ?? []).map((line) => line.id);
  const { data: reconciliationEntries } = checkedRead(
    lineIds.length > 0
      ? await supabase
          .from("pms_reconciliation_entries")
          .select("id")
          .in("order_line_id", lineIds)
          .limit(1)
      : { data: null, error: null },
    "pms_reconciliation_entries",
  );
  const hasReconciliationEntry = (reconciliationEntries?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/admin/orders" className="text-sm text-muted hover:underline">
          ← Pedidos
        </Link>
        <h1 className="titre-page">{order.holder_name}</h1>
        <p className="text-sm text-muted" data-testid="order-meta">
          Referente: {order.referrer?.display_name ?? "Directo"} · Creado el{" "}
          {formatDateInBogota(order.created_at, "es")}
        </p>
        <div className="flex items-center gap-2" data-testid="order-payment">
          <span className="text-sm text-muted">Pago:</span>
          <StatusChip
            status={paymentState}
            map={PAYMENT_STATE_CHIP_STYLE}
            labels={PAYMENT_STATE_LABELS}
            testId="order-payment-state"
          />
        </div>
        {hasReconciliationEntry ? (
          <Link
            href="/admin/reconciliation"
            className="text-sm text-link underline"
            data-testid="reconciliation-entry-link"
          >
            Ver entrada en la cola de reconciliación PMS
          </Link>
        ) : null}
      </div>

      <LedgerLinesTable lines={lines ?? []} paymentState={paymentState} />
    </div>
  );
}
