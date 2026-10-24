import type { OrderPaymentState } from "@hifago/domain";
import type { ChipStyle } from "@/components/status-chip";
import { STATUS_CHIP_COLOR, STATUS_LABELS } from "@/app/admin/orders/statusLabels";

// Le statut de ligne AFFICHÉ (`displayLineStatus`, packages/domain) : tous les statuts stockés
// (STATUS_LABELS) plus `pending_payment`, qui n'existe PAS en base — une `reserved` dont la commande
// attend son paiement. Séparé de STATUS_LABELS exprès : cette table sert de vocabulaire fermé au
// filtre de /admin/orders (Object.keys), où « pending_payment » n'est pas une valeur de colonne.
export const PENDING_PAYMENT_LABEL = "Pendiente de pago";

export function lineStatusLabel(displayStatus: string): string {
  return displayStatus === "pending_payment" ? PENDING_PAYMENT_LABEL : (STATUS_LABELS[displayStatus] ?? displayStatus);
}

export function lineStatusChipColor(displayStatus: string): "default" | "accent" | "success" | "warning" | "danger" {
  return displayStatus === "pending_payment" ? "warning" : (STATUS_CHIP_COLOR[displayStatus] ?? "default");
}

// L'état de paiement d'une COMMANDE (colonne « Pago » de /admin/orders et en-tête du détail). Même
// vocabulaire que la fiche client (clients/paymentStatusLabels.ts), réduit à ce que la liste a besoin
// de dire : l'état « sans anticipo » est une commande ferme sans paiement en ligne (evento gratuit / sur
// place), jamais une commande impayée.
export const PAYMENT_STATE_LABELS: Record<OrderPaymentState, string> = {
  paid: "Pagado",
  in_progress: "Pago en curso",
  unpaid: "Sin pagar",
  refunded: "Reembolsado",
  not_due: "Sin anticipo",
};

export const PAYMENT_STATE_CHIP_STYLE: Record<OrderPaymentState, ChipStyle> = {
  paid: { color: "success", variant: "soft" },
  in_progress: { color: "warning", variant: "soft" },
  unpaid: { color: "warning", variant: "soft" },
  refunded: { color: "danger", variant: "soft" },
  not_due: { color: "default", variant: "soft" },
};
