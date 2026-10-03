// L'état d'une commande tel qu'on le DIT à un client, et le seul endroit où il se décide.
//
// Extrait le 2026-09-11 (spec 34) de `reserva/[token]/OrderResult.tsx`, où il vivait en cascade de
// ternaires dans un composant client — donc non testé, et invisible à qui écrit un second écran.
// La liste « Mis reservas » montre les mêmes commandes que l'écran du jeton : deux dérivations
// séparées auraient fini par dire deux choses différentes du même objet.
//
// ⚠️ CE MODULE NE CONNAÎT PAS L'INCIDENT DE PAIEMENT, et c'est la distinction que l'en-tête
// d'OrderResult avait déjà payée : « l'état de la COMMANDE et l'incident de PAIEMENT sont deux
// choses distinctes ; les mélanger rendait `isPayable` vrai sur une commande déjà payée dont un
// paiement de trop avait échoué ». `failed` reste donc un état d'ÉCRAN, superposé par celui qui
// vient de voir un appel échouer — jamais un état qu'on dérive d'une commande.
//
// Fonction pure, sans React ni Supabase : elle se teste sans monter quoi que ce soit.

/** Lignes qui ne comptent plus — MÊME liste que `order_for_client_jsonb`, qui exclut les mêmes des totaux. */
export const DEAD_LINE_STATUSES = [
  "cancelled_by_client",
  "cancelled_by_provider",
  "expired",
  "superseded",
];

/** Vrai pour une prestation qui n'arrivera plus : affichée barrée, jamais masquée. */
export function isDeadLine(status: string): boolean {
  return DEAD_LINE_STATUSES.includes(status);
}

/**
 * Les six états qu'une commande peut porter d'elle-même. `failed` n'en est pas un : cf. l'en-tête.
 *
 * `confirmed` (2026-09-15, evento réservable en ligne) — distinct d'`unpaid` : des lignes vivantes
 * existent, mais aucune n'a d'acompte réellement dû EN LIGNE (evento gratuit, ou payable sur place
 * — `acompte_cop` forcé à 0 par `create_order`). Sans cet état, `isPayable = orderState ===
 * "unpaid"` (reserva/[token]/OrderResult.tsx) affichait un bouton « Pagar » qui échouait au clic
 * avec `nothing_to_pay` (create_payment_intent) — un dead-end UX, jamais un vrai chemin prévu.
 */
export type OrderState =
  | "paid"
  | "refunded"
  | "paid_not_honored"
  | "awaiting"
  | "unpaid"
  | "confirmed"
  | "expired"
  | "cancelled";

/** La forme minimale dont la dérivation a besoin — compatible avec `OrderForDisplay` et la liste. */
export type OrderStateInput = {
  paymentStatus: string;
  lines: { status: string }[];
  /** Somme des `acompte_cop` des lignes actives (`order_for_client_jsonb`, agrégat déjà rendu). */
  acompteCop: number;
  /**
   * Spec 39 D3 (2026-09-22) — le client a PAYÉ et rien n'est honoré (payé après expiration ou
   * annulation, écart de montant ; nuit PMS sans booking, intent remplacé : migration
   * 20261002185102) : une entrée `refund_required` est ouverte côté admin. Un double paiement ne lève
   * PAS ce drapeau (sa réservation est honorée). Absent = faux.
   */
  paymentReceivedNotHonored?: boolean;
  /** Dernier remboursement lié : `pending` | `approved` | `rejected` | null. */
  refundStatus?: string | null;
};

/**
 * L'état d'une commande, dans l'ordre où un client le lirait : payée d'abord, puis en attente du
 * webhook, puis « il reste quelque chose de vivant » — à payer si un acompte est réellement dû en
 * ligne, confirmé sinon (evento gratuit/sur-place) —, puis les deux fins possibles — expirée (le
 * paiement n'est jamais arrivé) ou annulée.
 *
 * ⚠️ `orders.status` n'est JAMAIS consulté : la colonne vaut `'confirmed'` sur toute ligne, rien ne
 * l'écrit, et depuis la spec 34 elle ne sort même plus de la base (invariant 4). Ne pas confondre
 * avec l'état `"confirmed"` DÉRIVÉ ci-dessus, qui ne dépend jamais de cette colonne.
 */
export function deriveOrderState(order: OrderStateInput): OrderState {
  if (order.paymentStatus === "paid") return "paid";
  // Spec 39 D3 : l'argent est rendu (par le job ou hors hifago) — dit AVANT tout le reste.
  if (order.paymentStatus === "refunded" || order.refundStatus === "approved") return "refunded";
  // Spec 39 D3 : payé mais rien à honorer — jamais « esta reserva expiró, no se completó el pago ».
  if (order.paymentReceivedNotHonored) return "paid_not_honored";
  const hasLiveLine = order.lines.some((line) => !isDeadLine(line.status));
  // « Estamos confirmando tu pago… se actualiza sola » n'a de sens que s'il reste quelque chose à
  // confirmer : une commande morte avec un paiement local encore `pending` (client qui a tout
  // annulé pendant le paiement) tombait ici pour toujours (attaque retenue de la revue du 09-21).
  if (order.paymentStatus === "pending" && hasLiveLine) return "awaiting";
  if (hasLiveLine) {
    return order.acompteCop > 0 ? "unpaid" : "confirmed";
  }
  if (order.lines.some((line) => line.status === "expired")) return "expired";
  return "cancelled";
}
