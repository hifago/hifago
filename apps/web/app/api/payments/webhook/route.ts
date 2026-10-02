import { InvalidWebhookSignatureError, WebhookSignatureValidator } from "mercadopago";
import { mapMercadoPagoPaymentStatus } from "@hifago/domain";
import { createServiceRoleClient } from "@hifago/supabase/service";
import { getMercadoPagoPayment } from "@/lib/mercadopago/client";

export const runtime = "nodejs";

// Plafond de la plateforme : le GET de re-confirmation Mercado Pago est coupé à 15 s
// (`PAYMENT_LOOKUP_DEADLINE_MS`, lib/mercadopago/client.ts) — il reste de quoi écrire l'échec et
// répondre 502 (Mercado Pago retentera) plutôt qu'une coupure sans réponse, tant que la base répond
// (ses accès ne sont pas bornés ici : une base qui cale fait couper, et Mercado Pago retente).
export const maxDuration = 30;

// Miroir local du type Json généré par Supabase — même convention que
// apps/admin/app/admin/establishments/new/NewEstablishmentForm.tsx.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

// Spec 19 §0 Tranche 1 — webhook Mercado Pago. Le paiement s'applique par
// `apply_payment_webhook_checked` (service_role seulement), après (1) vérification HMAC de la
// signature x-signature ET (2) un GET serveur-à-serveur de re-confirmation /v1/payments/{id} —
// jamais sur la seule foi du corps du webhook (pattern anti-race-condition documenté par Mercado
// Pago). Toute étape qui échoue avant d'appeler la RPC écrit dans payment_reconciliation_entries
// plutôt que de laisser l'échec silencieux (même discipline que pms_reconciliation_entries).
//
// Le MONTANT se décide en base, dans la même fonction que le job de réconciliation (migration
// 20261002021045) : une seule autorité, sous les verrous de la commande. Cette route ne fait que
// lui transmettre un montant exploitable — ou null, que la fonction traite en échec fermé.

/**
 * Matériel de rejeu d'une livraison, conservé DÉFINITIVEMENT dans `raw_event` (incident du
 * 2026-09-20). Jusqu'ici seul le corps était stocké : les 8 livraisons réelles rejetées en
 * `SignatureMismatch` ce jour-là étaient donc invérifiables hors ligne — impossible de tester un
 * secret candidat sans redemander un vrai paiement. Rien ici n'est secret : `x-signature` ne porte
 * qu'un horodatage et une EMPREINTE HMAC, jamais la clé. Le secret lui-même n'est évidemment
 * jamais journalisé (CLAUDE.md §8.2).
 */
function deliveryEvidence(request: Request, url: URL): Json {
  return {
    signature: request.headers.get("x-signature"),
    request_id: request.headers.get("x-request-id"),
    query: url.search || null,
    // Pas d'horodatage ici : `payment_reconciliation_entries.created_at` le porte déjà
    // (default now()), et un `new Date()` applicatif tomberait sous le garde-fou fuseau.
  };
}

/**
 * `kind` (migration 20260920120000) : `webhook_failure` = bruit à diagnostiquer (signature,
 * re-confirmation, corrélation) ; `refund_required` = l'argent est encaissé chez Mercado Pago et
 * rien ne sera honoré — l'admin doit agir. C'est la seule valeur que l'écran de réconciliation
 * filtre pour distinguer les deux.
 */
async function recordFailure(params: {
  paymentId?: string | null;
  mpPaymentId?: string | null;
  externalReference?: string | null;
  body: Json;
  delivery: Json;
  failureReason: string;
  kind?: "webhook_failure" | "refund_required";
}) {
  const service = createServiceRoleClient();
  const { error } = await service.from("payment_reconciliation_entries").insert({
    payment_id: params.paymentId ?? null,
    mp_payment_id: params.mpPaymentId ?? null,
    external_reference: params.externalReference ?? null,
    // Enveloppe { body, delivery } : `body` garde exactement ce que MP a POSTé (forme historique),
    // `delivery` ajoute de quoi rejouer la vérification de signature plus tard.
    raw_event: { body: params.body, delivery: params.delivery },
    failure_reason: params.failureReason,
    kind: params.kind ?? "webhook_failure",
  });
  // 23505 = l'index unique partiel (mp_payment_id, failure_reason) des `webhook_failure` ouverts :
  // Mercado Pago retente une livraison en échec — une seule entrée (et une seule salve d'e-mails
  // admin) par paiement et par cause, les livraisons suivantes sont un no-op silencieux.
  if (error && error.code !== "23505") {
    console.error("payment_reconciliation_entries : insertion échouée", error);
  }
}

/** La réponse de GET /v1/payments/{id}, pour les seuls champs lus ici. */
type MercadoPagoPayment = Awaited<ReturnType<typeof getMercadoPagoPayment>>;

/**
 * Le montant que la base comparera à l'acompte — seulement s'il est exploitable : en COP (la seule
 * devise du compte) et numérique fini. Sinon null, qu'apply_payment_webhook_checked traite en échec
 * fermé pour un paiement approuvé (refund_required / amount_mismatch), jamais en approbation.
 */
function exploitableAmount(payment: MercadoPagoPayment): number | null {
  const amount = payment.transaction_amount;
  return payment.currency_id === "COP" && typeof amount === "number" && Number.isFinite(amount)
    ? amount
    : null;
}

/**
 * L'événement conservé (payments.raw_last_event, raw_event des entrées de réconciliation) : la
 * réponse de Mercado Pago APLATIE — jamais l'objet entier, qui porte les coordonnées du payeur
 * (CLAUDE.md §8) — plus le corps du webhook. `transaction_amount` y est le montant exploitable :
 * c'est lui que l'e-mail au client et la demande de remboursement affichent (le montant encaissé,
 * pas l'acompte attendu) — s'il est null, ils retombent sur l'acompte attendu ;
 * `mp_transaction_amount` garde la valeur brute (diagnostic).
 */
function paymentEvent(payment: MercadoPagoPayment, amount: number | null, webhookBody: Json): Json {
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

export async function POST(request: Request) {
  const url = new URL(request.url);
  const dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id");
  const notificationType = url.searchParams.get("type") ?? url.searchParams.get("topic");
  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id");

  let rawBody: Json = null;
  try {
    rawBody = await request.json();
  } catch {
    // Corps vide/non-JSON : pas bloquant en soi (certaines notifications n'ont qu'une query string),
    // la vérification de signature ci-dessous reste la vraie porte.
  }

  // ⚠️ ORDRE VOULU : le tri par type passe AVANT la vérification de signature (inversé le
  // 2026-09-20). Mercado Pago envoie pour un même paiement des notifications `merchant_order` que
  // nous n'exploitons pas : les valider d'abord les faisait tomber en 401 et écrire une entrée de
  // réconciliation — donc un e-mail à TOUS les admins (trigger 20260824060000 ; les échecs de
  // signature sont regroupés depuis la migration 20261002125023) pour du bruit pur.
  // Sur l'incident du 2026-09-20, 2 des 8 entrées étaient exactement ça. Ne rien authentifier ici
  // est sans risque : la branche ne fait rien, ne lit rien, n'écrit rien.
  if (notificationType !== "payment" || !dataId) {
    return new Response(null, { status: 200 });
  }

  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("MERCADOPAGO_WEBHOOK_SECRET manquant — webhook refusé par sécurité.");
    return new Response(null, { status: 500 });
  }

  try {
    WebhookSignatureValidator.validate({
      xSignature,
      xRequestId,
      dataId,
      secret,
    });
  } catch (error) {
    const reason =
      error instanceof InvalidWebhookSignatureError ? error.reason : "signature_validation_error";
    // ⚠️ Cause déjà rencontrée en réel, à vérifier AVANT de soupçonner le manifeste (2026-09-20,
    // piège 19 enfin élucidé) : un `SignatureMismatch` systématique signifie presque toujours que
    // MERCADOPAGO_WEBHOOK_SECRET et MERCADOPAGO_ACCESS_TOKEN n'appartiennent pas à la même
    // application/au même mode Mercado Pago. Le secret est propre au couple (application, mode) ;
    // le simulateur du panel signe avec celui du compte où l'on est connecté, les livraisons
    // réelles avec celui du compte qui ENCAISSE. Deux comptes = mismatch permanent.
    await recordFailure({
      mpPaymentId: dataId,
      body: rawBody,
      delivery: deliveryEvidence(request, url),
      // ⚠️ Ce préfixe « signature invalide ( » est LU par le trigger
      // notify_admin_new_reconciliation_exception (migration 20261002125023) : c'est lui qui désigne
      // la classe d'entrées dont les e-mails admin sont étranglés. Ne pas le reformuler seul.
      failureReason: `signature invalide (${reason})`,
    });
    return new Response(null, { status: 401 });
  }

  let mpPayment;
  try {
    mpPayment = await getMercadoPagoPayment(dataId);
  } catch (error) {
    console.error("Re-confirmation GET /v1/payments/{id} a échoué", error);
    await recordFailure({
      mpPaymentId: dataId,
      body: rawBody,
      delivery: deliveryEvidence(request, url),
      failureReason: "échec de la re-confirmation serveur-à-serveur GET /v1/payments/{id}",
    });
    return new Response(null, { status: 502 }); // Mercado Pago retentera.
  }

  const externalReference = mpPayment.external_reference ?? null;
  if (!externalReference) {
    await recordFailure({
      mpPaymentId: dataId,
      body: rawBody,
      delivery: deliveryEvidence(request, url),
      failureReason: "external_reference absent de la réponse Mercado Pago re-confirmée",
    });
    return new Response(null, { status: 200 }); // Rien à corréler, pas la peine de faire retenter.
  }

  const service = createServiceRoleClient();
  const amount = exploitableAmount(mpPayment);
  const { data: result, error: rpcError } = await service.rpc("apply_payment_webhook_checked", {
    p_mp_payment_id: dataId,
    p_external_reference: externalReference,
    p_status: mapMercadoPagoPaymentStatus(mpPayment.status),
    // Les types générés déclarent `number` : ils ignorent qu'un argument SQL accepte NULL, et NULL
    // est ici voulu (montant inexploitable → échec fermé dans la fonction).
    p_transaction_amount: amount as number,
    p_raw_event: paymentEvent(mpPayment, amount, rawBody),
  });

  if (rpcError || !(result as { ok: boolean } | null)?.ok) {
    await recordFailure({
      mpPaymentId: dataId,
      externalReference,
      body: rawBody,
      delivery: deliveryEvidence(request, url),
      failureReason: rpcError?.message ?? JSON.stringify(result),
    });
    return new Response(null, { status: 500 }); // Mercado Pago retentera.
  }

  return new Response(null, { status: 200 });
}
