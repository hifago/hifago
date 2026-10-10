// Un paiement Mercado Pago tel qu'hifago le CONSERVE et le TRANSMET aux RPC — partagé par la route
// du webhook (apps/web) et le job de réconciliation (Edge Function `payments-reconcile`), qui
// transmettaient jusqu'ici deux formes différentes : la route l'objet aplati, le job l'objet MP
// ENTIER (coordonnées du payeur comprises) et un montant sans contrôle de devise.
//
// Aucune dépendance (ni SDK, ni import nu) : le module tourne sous Node et sous Deno.

/** Les seuls champs lus d'une réponse GET /v1/payments/{id} ou /v1/payments/search. */
export interface MercadoPagoPaymentFields {
  id?: number | string | null;
  status?: string | null;
  status_detail?: string | null;
  transaction_amount?: number | null;
  currency_id?: string | null;
  date_created?: string | null;
  date_approved?: string | null;
  external_reference?: string | null;
  collector_id?: number | string | null;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Le montant que la base comparera à l'acompte — seulement s'il est exploitable : en COP (la seule
 * devise du compte) et numérique fini. Sinon null, qu'apply_payment_webhook_checked traite en échec
 * fermé pour un paiement approuvé (refund_required / amount_mismatch), jamais en approbation.
 */
export function exploitableAmount(payment: MercadoPagoPaymentFields): number | null {
  const amount = payment.transaction_amount;
  return payment.currency_id === "COP" && typeof amount === "number" && Number.isFinite(amount) ? amount : null;
}

/**
 * L'événement conservé (payments.raw_last_event, raw_event des entrées de réconciliation) : la
 * réponse de Mercado Pago APLATIE — jamais l'objet entier, qui porte les coordonnées du payeur
 * (CLAUDE.md §8) — plus le corps du webhook quand il y en a un. `transaction_amount` y est le
 * montant exploitable : c'est lui que l'e-mail au client et la demande de remboursement affichent
 * (le montant encaissé, pas l'acompte attendu) — s'il est null, ils retombent sur l'acompte attendu ;
 * `mp_transaction_amount` garde la valeur brute (diagnostic).
 */
export function toPaymentEvent(
  payment: MercadoPagoPaymentFields,
  amount: number | null,
  webhookBody: JsonValue | null
): { [key: string]: JsonValue } {
  return {
    mp_payment_id: payment.id == null ? null : String(payment.id),
    status: payment.status ?? null,
    status_detail: payment.status_detail ?? null,
    transaction_amount: amount,
    mp_transaction_amount: typeof payment.transaction_amount === "number" ? payment.transaction_amount : null,
    currency_id: payment.currency_id ?? null,
    date_created: payment.date_created ?? null,
    date_approved: payment.date_approved ?? null,
    external_reference: payment.external_reference ?? null,
    collector_id: payment.collector_id == null ? null : String(payment.collector_id),
    webhook_body: webhookBody,
  };
}
