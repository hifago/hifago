import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import type { ReconciliationEntryRow } from "@/app/admin/reconciliation/ReconciliationList";
import type { PaymentReconciliationEntryRow } from "@/app/admin/reconciliation/PaymentReconciliationList";

// Lecture de l'écran /admin/reconciliation — extraite de sa page pour être prouvée : sur une panne,
// l'écran affichait deux listes VIDES, « rien à réconcilier », le seul message qu'il ne faut jamais
// donner à tort (une exception de paiement ou de PMS non traitée, c'est un client payé sans
// réservation). Chaque lecture en erreur LÈVE ; la frontière app/error.tsx prend le relais.

type ReconciliationEntryQueryRow = {
  id: string;
  status: string;
  attempts: number;
  detail: string | null;
  order_line_id: string;
};

// payment_reconciliation_entries.payment_id → payments.id → orders.id (payment_id NULLABLE : un
// webhook rejeté avant corrélation n'a pas de paiement — l'entrée existe quand même, spec 19).
type PaymentReconciliationQueryRow = {
  id: string;
  kind: string;
  status: string;
  failure_reason: string;
  mp_payment_id: string | null;
  created_at: string;
  payment: {
    order_id: string;
    amount_cop: number;
    order: { reference: string; holder_name: string } | null;
  } | null;
  /** payment_refunds.entry_id → cette entrée (spec 39 D3) — au plus un vivant, l'historique reste. */
  refunds: { status: string; last_error: string | null; mp_refund_id: string | null; created_at: string }[];
};

/** Le remboursement à montrer : approved > pending > rejected (même priorité que le contrat client). */
function latestRefund(refunds: PaymentReconciliationQueryRow["refunds"]) {
  const rank = (s: string) => (s === "approved" ? 0 : s === "pending" ? 1 : 2);
  const chosen = [...refunds].sort(
    (a, b) => rank(a.status) - rank(b.status) || b.created_at.localeCompare(a.created_at)
  )[0];
  return {
    refundStatus: chosen?.status ?? null,
    refundError: chosen?.last_error ?? null,
    refundMpId: chosen?.mp_refund_id ?? null,
  };
}

export async function loadReconciliationPage(): Promise<{
  paymentRows: PaymentReconciliationEntryRow[];
  rows: ReconciliationEntryRow[];
}> {
  const supabase = await createClient();

  // Durcissement 20260920120000 : les exceptions de PAIEMENT enfin visibles ici (RLS
  // payment_reconciliation_entries_select_admin, payments_select_admin — lecture seule). Les plus
  // récentes d'abord : c'est l'entrée qui vient d'être créée que l'e-mail annonce.
  const { data: paymentEntries, error: paymentError } = await supabase
    .from("payment_reconciliation_entries")
    .select(
      `id, kind, status, failure_reason, mp_payment_id, created_at,
       payment:payments(order_id, amount_cop, order:orders(reference, holder_name)),
       refunds:payment_refunds(status, last_error, mp_refund_id, created_at)`
    )
    .order("created_at", { ascending: false })
    .returns<PaymentReconciliationQueryRow[]>();
  if (paymentError) throw paymentError;

  const paymentRows: PaymentReconciliationEntryRow[] = (paymentEntries ?? []).map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    status: entry.status,
    failureReason: entry.failure_reason,
    mpPaymentId: entry.mp_payment_id,
    createdAt: entry.created_at,
    orderId: entry.payment?.order_id ?? null,
    orderReference: entry.payment?.order?.reference ?? null,
    holderName: entry.payment?.order?.holder_name ?? null,
    amountCop: entry.payment?.amount_cop ?? null,
    ...latestRefund(entry.refunds ?? []),
  }));

  // pms_reconciliation_entries_select_admin (feature 22) : seule policy, lecture seule, déjà
  // réservée admin — la garde de AdminLayout (feature 1) suffit ici, aucun filtre supplémentaire.
  const { data: entries, error: entriesError } = await supabase
    .from("pms_reconciliation_entries")
    .select("id, status, attempts, detail, order_line_id")
    .order("created_at", { ascending: true })
    .returns<ReconciliationEntryQueryRow[]>();
  if (entriesError) throw entriesError;

  // Identité de la commande/produit : jamais un embed PostgREST direct vers order_lines (fuite des
  // colonnes de commission, docs/backlog.md) — une RPC admin étroite, partagée avec la page
  // ressource d'établissement (admin_order_line_summaries, 20260922140000).
  const orderLineIds = [...new Set((entries ?? []).map((entry) => entry.order_line_id))];
  const { data: summaries, error: summariesError } = await supabase.rpc("admin_order_line_summaries", {
    p_order_line_ids: orderLineIds,
  });
  if (summariesError) throw summariesError;
  const summaryByLineId = new Map((summaries ?? []).map((summary) => [summary.order_line_id, summary]));

  const rows: ReconciliationEntryRow[] = (entries ?? []).map((entry) => {
    const summary = summaryByLineId.get(entry.order_line_id);
    return {
      id: entry.id,
      detail: entry.detail,
      status: entry.status,
      attempts: entry.attempts,
      orderId: summary?.order_id ?? "",
      holderName: summary?.holder_name ?? "—",
      establishmentName: resolveLocalizedField(asLocalizedField(summary?.establishment_name), "es") ?? "—",
    };
  });

  return { paymentRows, rows };
}
