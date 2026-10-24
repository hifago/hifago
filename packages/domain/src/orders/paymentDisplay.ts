// Ce qu'une LIGNE de commande doit DIRE quand sa commande n'est pas payée (2026-10-24).
//
// LA CONFUSION. `order_lines.status = 'reserved'` n'est pas une confirmation : c'est le statut qui TIENT
// LA PLACE pendant le paiement (create_order le pose avant tout encaissement). Un paiement refusé ou
// jamais fait laisse la ligne `reserved` jusqu'à l'expiration (30 min) — et les listes d'admin
// l'affichaient « Reservada », sans rien dire d'une commande impayée. Le statut de la LIGNE et le
// paiement de la COMMANDE sont deux choses distinctes : ce module les croise, sans jamais réécrire le
// statut stocké (filtres, changement de statut et agenda continuent de lire `status`).
//
// UN ACOMPTE PEUT NE PAS ÊTRE DÛ. Un evento gratuit ou payable sur place a `acompte_cop = 0` : sa
// commande ne passe jamais `paid` (aucun paiement n'existe) et reste `unpaid` pour toujours. Elle est
// pourtant confirmée. L'état de paiement dépend donc de l'acompte dû SUR LA COMMANDE (somme des lignes
// vivantes), pas du seul `payment_status` — même règle que `deriveOrderState` côté client
// (apps/web/lib/orders/orderState.ts : « unpaid » seulement si acompteCop > 0, sinon « confirmed »).

/** Lignes qui comptent encore (les mêmes que `order_for_client_jsonb`, qui exclut les autres des totaux). */
const LIVE_LINE_STATUSES = ["reserved", "fulfilled", "no_show"];

export type OrderPaymentState =
  | "paid" // encaissé (y compris remboursé en partie)
  | "in_progress" // un paiement est en cours chez Mercado Pago
  | "unpaid" // un acompte est dû et rien n'est encaissé
  | "refunded" // remboursé
  | "not_due"; // aucun acompte dû en ligne (evento gratuit / sur place) : la commande est ferme

/** La somme des acomptes des lignes VIVANTES d'une commande. */
export function acompteDue(lines: { status: string; acompte_cop?: number | null; acompteCop?: number | null }[]): number {
  return lines
    .filter((line) => LIVE_LINE_STATUSES.includes(line.status))
    .reduce((total, line) => total + (line.acompte_cop ?? line.acompteCop ?? 0), 0);
}

/**
 * L'état de paiement d'une commande. `acompteDueCop` n'est lu que pour une commande non payée ;
 * `null` (acompte inconnu) vaut « dû » — échec fermé : mieux vaut afficher « pendiente de pago » à tort
 * qu'une réservation impayée comme confirmée.
 */
export function orderPaymentState(paymentStatus: string, acompteDueCop: number | null): OrderPaymentState {
  if (paymentStatus === "paid" || paymentStatus === "partially_refunded") return "paid";
  if (paymentStatus === "refunded") return "refunded";
  if (acompteDueCop !== null && acompteDueCop <= 0) return "not_due";
  return paymentStatus === "pending" ? "in_progress" : "unpaid";
}

/** Un montant est-il attendu avant que la réservation soit ferme ? */
export function isAwaitingPayment(state: OrderPaymentState): boolean {
  return state === "unpaid" || state === "in_progress";
}

/**
 * Le statut à AFFICHER pour une ligne : `reserved` d'une commande qui attend son paiement devient
 * `pending_payment` ; tout autre statut (annulée, expirée, réalisée…) est affiché tel quel — une ligne
 * annulée d'une commande impayée est annulée, pas « pendiente de pago ».
 */
export function displayLineStatus(lineStatus: string, paymentState: OrderPaymentState): string {
  return lineStatus === "reserved" && isAwaitingPayment(paymentState) ? "pending_payment" : lineStatus;
}
