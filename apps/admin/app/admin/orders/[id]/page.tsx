import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { requireUuidParam } from "@/lib/routing/requireUuidParam";
import { LedgerLinesTable } from "./LedgerLinesTable";
import { formatDateInBogota } from "@hifago/domain";

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
        "id, holder_name, holder_email, holder_phone, created_at, referrer:partners(display_name)"
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
        <h1 className="text-2xl font-semibold">{order.holder_name}</h1>
        <p className="text-sm text-muted" data-testid="order-meta">
          Referente: {order.referrer?.display_name ?? "Directo"} · Creado el{" "}
          {formatDateInBogota(order.created_at, "es")}
        </p>
        {hasReconciliationEntry ? (
          <Link
            href="/admin/reconciliation"
            className="text-sm text-accent hover:underline"
            data-testid="reconciliation-entry-link"
          >
            Ver entrada en la cola de reconciliación PMS
          </Link>
        ) : null}
      </div>

      <LedgerLinesTable lines={lines ?? []} />
    </div>
  );
}
