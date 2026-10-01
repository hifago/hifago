import { createServiceRoleClient } from "@hifago/supabase/service";
import { resolveOrigin } from "@hifago/domain";
import {
  createCheckoutPreference,
  ORDER_EXPIRY_MINUTES,
  PREFERENCE_EXPIRY_MARGIN_MINUTES,
} from "@/lib/mercadopago/client";
import { isPaymentsMockEnabled } from "@/lib/mercadopago/mock";

// Spec 19 §0 Tranche 1 — création de la préférence Checkout Pro. Le CLIENT appelle d'abord
// create_payment_intent(order_id) directement via son propre client Supabase (RPC anon/
// authenticated, même patron que create_order aujourd'hui — cf. CheckoutForm.tsx), PUIS ce Route
// Handler avec le seul payment_id obtenu. Ne fait JAMAIS confiance à un amount_cop/payer_email
// envoyé par le client : re-lit l'état AUTORITATIF de `payments` via service_role (RLS admin-only,
// même un compte propriétaire de la commande ne peut pas la lire en direct — cf. migration
// 20260818200000) — un client compromis ou buggé qui mentirait sur le montant n'a donc aucune
// prise ici, contrairement à un design qui relaierait bêtement les valeurs reçues du navigateur.
//
// N'appelle PAS auth.getUser()/vérification de propriété ici : create_payment_intent a déjà
// entièrement statué sur l'autorisation (invité compris) au moment de sa propre exécution — ce
// Route Handler ne fait qu'emballer l'appel SDK externe (le secret MERCADOPAGO_ACCESS_TOKEN ne
// peut jamais quitter le serveur, d'où l'existence même de ce Route Handler).
export async function POST(request: Request) {
  let body: { paymentId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const paymentId = body.paymentId;
  if (typeof paymentId !== "string" || paymentId.length === 0) {
    return Response.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  // Spec 33 — le jeton de retour est lu dans la MÊME requête, par l'embed PostgREST sur la FK
  // `payments.order_id → orders.id` : le navigateur n'a jamais à le transmettre, et cette étape ne
  // coûte pas un second aller-retour sur un chemin où le client attend déjà Mercado Pago.
  const service = createServiceRoleClient();
  const { data: payment, error: readError } = await service
    .from("payments")
    .select("id, order_id, amount_cop, payer_email, status, orders(access_token, created_at)")
    .eq("id", paymentId)
    .maybeSingle();

  if (readError || !payment) {
    return Response.json({ ok: false, reason: "payment_not_found" }, { status: 404 });
  }

  if (payment.status !== "pending") {
    return Response.json({ ok: false, reason: "payment_not_pending" }, { status: 409 });
  }

  const order = payment.orders;
  if (!order?.access_token) {
    // Ne devrait jamais arriver (colonne NOT NULL depuis 20260910170000) — mais échouer ici est
    // préférable à fabriquer une back_url qui ramènerait le client sur une page introuvable après
    // avoir payé.
    return Response.json({ ok: false, reason: "order_not_found" }, { status: 404 });
  }

  // Spec 33 — RETOUR VERS L'ADRESSE PROPRE À LA COMMANDE, et non plus vers l'écran de checkout.
  //
  // Ce que ça corrige : les trois back_urls pointaient sur `${origin}/es/pago`, un écran qui ne
  // rend `<CheckoutForm>` que si le panier n'est pas vide. Depuis que `create_order` vide
  // `cart_items` dans sa propre transaction (spec 32, 2026-09-10), le client revenait de Mercado
  // Pago sur une PAGE VIDE — un `<h1>` et « ton panier est vide », sans numéro, sans confirmation,
  // sans message d'échec. Le repli assumé par la spec 19 (« réutilise l'écran checkout ») était
  // devenu faux sans que rien ne le relise.
  //
  // ⚠️ AUCUN PRÉFIXE DE LOCALE, et c'est le correctif entier de la locale forcée. `resolveLocale`
  // de next-intl résout dans l'ordre : préfixe du chemin → cookie NEXT_LOCALE → Accept-Language →
  // `es`. Un chemin SANS préfixe tombe donc sur la langue réelle du visiteur. Et c'est le `/es` en
  // dur qui CASSAIT ce repli, pas son absence : un chemin préfixé fait résoudre `es` par la
  // première branche, et `syncCookie` réécrit alors NEXT_LOCALE à `es` — un anglophone qui payait
  // ne revenait pas seulement sur une page espagnole, TOUTE LA SUITE de sa session basculait.
  // Aucune colonne `orders.locale` n'est nécessaire : le mécanisme existait déjà, il était
  // neutralisé.
  // Feature 32 — bug réel trouvé en testant via tunnel (docs/journal/2026-08.md, 2026-08-21) :
  // `new URL(request.url).origin` seul retombe sur l'adresse locale du serveur dès que la requête
  // traverse un reverse proxy/tunnel qui ne réécrit pas request.url lui-même — `back_urls`/
  // `notification_url` construits dessus pointaient vers une adresse injoignable depuis Mercado
  // Pago, silencieusement. Extrait dans @hifago/domain (packages/domain/src/http/resolveOrigin.ts) :
  // le même besoin existe ailleurs (apps/web/app/auth/callback/route.ts).
  const origin = resolveOrigin({
    requestUrl: request.url,
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
  });
  const returnUrl = `${origin}/reserva/${order.access_token}`;

  // EXPIRATION DE LA PRÉFÉRENCE — ancrée sur la création de la COMMANDE (incident du 2026-09-20).
  //
  // `expire_stale_payment_orders` annule la commande 30 minutes après `orders.created_at`. Si la
  // préférence expirait 30 minutes après ce clic-ci, un client entré dans le tunnel il y a 25
  // minutes obtiendrait un lien valable 55 minutes au total : il paierait une réservation déjà
  // annulée. L'ancre doit donc être la même des deux côtés.
  const expiresAtMs =
    new Date(order.created_at).getTime() +
    (ORDER_EXPIRY_MINUTES - PREFERENCE_EXPIRY_MARGIN_MINUTES) * 60_000;
  const remainingMs = expiresAtMs - Date.now();
  if (remainingMs <= 0) {
    // Échec fermé (CLAUDE.md §4.4) : plutôt refuser d'ouvrir un paiement que d'encaisser pour une
    // commande que le cron va détruire dans les secondes qui suivent.
    return Response.json({ ok: false, reason: "order_expiring" }, { status: 409 });
  }
  // Mercado Pago attend un décalage explicite ; `toISOString()` rend « Z », que l'API n'accepte pas
  // partout. Instant absolu, jamais une date civile — hors périmètre du garde-fou fuseau.
  const expiresAt = new Date(expiresAtMs).toISOString().replace("Z", "+00:00");

  // Mode dev — voir apps/web/lib/mercadopago/mock.ts. Remplace UNIQUEMENT ce dernier geste (l'appel
  // SDK externe) : l'autorisation et le montant au-dessus restent validés côté serveur exactement
  // comme en prod, et /api/payments/mock-checkout relit lui aussi payments.amount_cop en base —
  // jamais un montant fabriqué dans cette URL.
  if (isPaymentsMockEnabled()) {
    const mockUrl = new URL(`${origin}/api/payments/mock-checkout`);
    mockUrl.searchParams.set("paymentId", payment.id);
    mockUrl.searchParams.set("returnUrl", returnUrl);
    return Response.json({ ok: true, init_point: mockUrl.toString() });
  }

  // Les trois back_urls pointaient jusqu'ici vers la MÊME adresse, quelle que soit l'issue — Mercado
  // Pago redirige vers celle qui correspond au résultat réel, donc les distinguer par un paramètre
  // suffit à le savoir à l'arrivée sur `/reserva/<jeton>` (`OrderResult.tsx` lit `?payment=`, jamais
  // pour DÉCIDER de l'état de la commande — dérivé de la base, cf. `orderState.ts` — seulement pour
  // superposer le message "paiement rejeté" au bon moment).
  const withPaymentOutcome = (outcome: "approved" | "pending" | "rejected") => {
    const url = new URL(returnUrl);
    url.searchParams.set("payment", outcome);
    return url.toString();
  };

  try {
    const { initPoint, preferenceId, collectorId } = await createCheckoutPreference({
      paymentId: payment.id,
      amountCop: payment.amount_cop,
      payerEmail: payment.payer_email,
      successUrl: withPaymentOutcome("approved"),
      pendingUrl: withPaymentOutcome("pending"),
      failureUrl: withPaymentOutcome("rejected"),
      // `source_news=webhooks` : sans lui, Mercado Pago peut livrer à cette URL au format IPN
      // (`?topic=payment&id=…`), dont le `x-signature` n'est PAS vérifiable avec la clé secrète
      // (doc MP « IPN ») — la route le rejetait en SignatureMismatch, ouvrait une entrée de
      // réconciliation et e-mailait tous les admins, le paiement n'étant rattrapé que par le job
      // 2 à 4 min plus tard (vécu le 2026-09-30, première préprod du compte hifago). Le paramètre
      // restreint les livraisons au format Webhooks (`?type=payment&data.id=…`), le seul signé.
      notificationUrl: `${origin}/api/payments/webhook?source_news=webhooks`,
      expiresAt,
    });
    // Spec 39 (2026-09-21) : la préférence et le compte qui ENCAISSE sont persistés. Le job de
    // réconciliation refuse de décider quoi que ce soit si le token qu'il porte n'appartient pas à
    // `mp_collector_id` (piège 19 : deux comptes MP, une recherche vide ≠ « pas payé »). Meilleur
    // effort : un échec d'écriture n'empêche jamais le client de payer, il se voit en log.
    const { error: persistError } = await service
      .from("payments")
      .update({ mp_preference_id: preferenceId, mp_collector_id: collectorId })
      .eq("id", payment.id);
    if (persistError) {
      console.error("payments.mp_preference_id/mp_collector_id : écriture échouée", persistError);
    }
    return Response.json({ ok: true, init_point: initPoint });
  } catch (error) {
    // Échec fermé (spec §0 Tranche 1) : Mercado Pago indisponible/mal configuré n'annule jamais la
    // commande déjà réservée par create_order — la ligne reste 'reserved', payment reste 'pending',
    // le client peut retenter (le job d'expiration reste le seul filet en dernier recours).
    console.error("createCheckoutPreference a échoué", error);
    return Response.json({ ok: false, reason: "mercadopago_unavailable" }, { status: 503 });
  }
}
