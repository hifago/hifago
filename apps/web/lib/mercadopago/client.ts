import { MercadoPagoConfig, Payment, Preference } from "mercadopago";

// Spec 19 §0 Tranche 1 — wrapper SDK Mercado Pago. Reste dans apps/web (jamais @hifago/domain, qui
// n'a aucune dépendance runtime aujourd'hui) : appelle un service externe avec un secret serveur,
// même patron que `sharp` dans apps/admin/app/api/upload/[entity]/route.ts (bibliothèque à effets
// de bord gardée dans l'app qui l'utilise, pas mutualisée dans un package partagé). Un seul compte
// marchand (Hifago) — aucun split natif, aucun OAuth établissement/référent ici (spec §1/§3).
function getAccessToken(): string {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("MERCADOPAGO_ACCESS_TOKEN manquant — impossible d'appeler Mercado Pago.");
  }
  return accessToken;
}


/**
 * Bornes de la création de préférence. Le SDK 3.4.0 attend par défaut 60 s par tentative et retente
 * 3 fois (attentes de 1, 2 puis 4 s, et jusqu'à 30 s sur un `Retry-After` de 429) — ses propres types
 * annoncent 10 s, à tort. Sans bornes, un Mercado Pago lent faisait couper la route par la
 * plateforme : le client recevait une 504 sans corps au lieu de `mercadopago_unavailable`.
 *
 * Une création de préférence répond en moins d'une seconde quand Mercado Pago va bien : 8 s par
 * tentative ne coupe que l'anormal. Une seule nouvelle tentative (erreur réseau, délai dépassé, 429,
 * 5xx — `retryOn` du SDK), après 1 s, ou après le `Retry-After` d'un 429 plafonné à 2 s : 18 s au
 * pire tant que les en-têtes arrivent. La clé d'idempotence envoyée est notre `payments.id` ; que
 * Mercado Pago la respecte sur les préférences n'est pas documenté. Au pire, une préférence créée
 * pendant une tentative abandonnée reste orpheline : son lien n'est jamais remis au client.
 */
export const PREFERENCE_REQUEST_BOUNDS = {
  timeout: 8_000,
  maxRetries: 1,
  maxDelay: 2_000,
} as const;

/**
 * Échéance GLOBALE de la création de préférence, au-dessus des bornes du SDK : son délai s'arrête à
 * l'arrivée des en-têtes (`clearTimeout` dès que `fetch` rend la main, `restClient/index.js:142`), la
 * lecture du corps n'est bornée par rien, et le SDK écrase tout `signal` qu'on lui passerait. Un
 * corps qui cale aurait donc encore fait couper la route par la plateforme. 20 s : au-delà du pire cas
 * des bornes ci-dessus (18 s), sous le `maxDuration` de `/api/payments/create` (avec ses deux accès base).
 */
export const PREFERENCE_DEADLINE_MS = 20_000;

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Mercado Pago n'a pas répondu en ${ms} ms.`)), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Marge sous la fenêtre d'expiration des commandes (30 min après `orders.created_at`, cf.
 * `expire_stale_payment_orders`, migration 20260915130000). La préférence doit mourir AVANT que la
 * base n'annule la commande — jamais l'inverse.
 *
 * POURQUOI (incident du 2026-09-20) : une préférence Checkout Pro sans date d'expiration reste
 * payable indéfiniment. Le lien `init_point` survivait donc à l'annulation de la commande : un
 * client qui laissait l'onglet Mercado Pago ouvert puis payait 40 minutes plus tard voyait son
 * argent encaissé pour une réservation déjà détruite, sans qu'aucun chemin de remboursement
 * n'existe. Deux minutes de marge suffisent : elles couvrent l'écart entre l'acceptation chez
 * Mercado Pago et l'arrivée de la notification.
 */
export const PREFERENCE_EXPIRY_MARGIN_MINUTES = 2;
export const ORDER_EXPIRY_MINUTES = 30;

export interface CreateCheckoutPreferenceInput {
  /** payments.id — sert à la fois d'external_reference ET de clé d'idempotence SDK. */
  paymentId: string;
  amountCop: number;
  payerEmail: string | null;
  successUrl: string;
  pendingUrl: string;
  failureUrl: string;
  notificationUrl: string;
  /**
   * Instant (ISO 8601 avec décalage explicite) au-delà duquel Mercado Pago refuse le paiement.
   * Calculé depuis `orders.created_at`, jamais depuis « maintenant » : la préférence est créée au
   * clic sur « Payer », qui peut survenir vingt minutes après la commande — une fenêtre glissante
   * dépasserait alors l'expiration côté base, ce qui est exactement le trou à fermer.
   */
  expiresAt: string;
}

export interface CheckoutPreferenceResult {
  initPoint: string;
  /** `id` de la préférence — de quoi la retrouver dans le panel MP (spec 39). */
  preferenceId: string | null;
  /**
   * `collector_id` : le compte MP qui ENCAISSE. Le job de réconciliation compare `GET /users/me`
   * à cette valeur avant de décider quoi que ce soit — une recherche vide avec le token d'un autre
   * compte est exactement l'incident du 2026-09-20 (piège 19).
   */
  collectorId: string | null;
}

// Checkout Pro par simple redirection (pas de bouton/brique intégrée) : aucun besoin du SDK client
// @mercadopago/sdk-js/sdk-react ni de NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY — un lien/redirect vers
// init_point suffit entièrement. Simplification par rapport à l'intuition initiale de la spec
// (§0 Tranche 1, « SDK client pour Checkout Pro ») : la brique intégrée n'apporte rien ici, un seul
// compte marchand, pas de personnalisation de paiement in-page nécessaire pour ce périmètre.
export async function createCheckoutPreference(
  input: CreateCheckoutPreferenceInput
): Promise<CheckoutPreferenceResult> {
  // Config PROPRE à cet appel, jamais une config partagée : `Preference.create` fusionne ses
  // `requestOptions` DANS `this.config.options` (SDK 3.4.0, `clients/preference/index.js:49`). Sur
  // un objet partagé, ces bornes et la clé d'idempotence resteraient collées aux appels suivants.
  const preference = new Preference(
    new MercadoPagoConfig({ accessToken: getAccessToken(), options: { ...PREFERENCE_REQUEST_BOUNDS } })
  );
  const response = await withDeadline(preference.create({
    body: {
      items: [
        {
          id: input.paymentId,
          title: "Anticipo de reserva Hifago",
          quantity: 1,
          currency_id: "COP",
          unit_price: input.amountCop,
        },
      ],
      external_reference: input.paymentId,
      // Voir PREFERENCE_EXPIRY_MARGIN_MINUTES : sans ces deux champs, le lien de paiement survit à
      // l'annulation de la commande et produit un encaissement irrattrapable.
      expires: true,
      expiration_date_to: input.expiresAt,
      payer: input.payerEmail ? { email: input.payerEmail } : undefined,
      back_urls: {
        success: input.successUrl,
        pending: input.pendingUrl,
        failure: input.failureUrl,
      },
      auto_return: "approved",
      // ⚠️ DÉCISION JÉRÔME 2026-09-10 (spec 33 §3 décision ③) — les moyens de paiement HORS LIGNE
      // sont retirés du tunnel, et ce n'est pas une optimisation : c'était une impasse mesurée.
      // Mercado Pago rend `pending` pour un paiement en espèces (Efecty, Baloto), c'est-à-dire un
      // bon à régler en point de vente SOUS 1 À 3 JOURS. Or `expire_stale_payment_orders` annule
      // toute commande `pending` de plus de 30 MINUTES : le client repartait avec un bon inutile et
      // une réservation annulée avant même d'avoir pu payer, sans que rien ne le lui dise.
      //
      // Allonger la fenêtre d'expiration a été écarté d'emblée : immobiliser des places trois jours
      // aggraverait le « Trou (a) » du backlog (rien ne libère un cupo quand une commande expire),
      // lui-même en attente d'arbitrage. On ne construit pas sur un trou ouvert.
      //
      // Conséquence assumée : un client sans carte ni PSE ne peut plus réserver. `pending` reste
      // possible (revue anti-fraude), mais redevient rare et court — d'où le bandeau d'attente de
      // `OrderResult`, qui reste nécessaire.
      payment_methods: {
        excluded_payment_types: [{ id: "ticket" }, { id: "atm" }],
      },
      notification_url: input.notificationUrl,
    },
    // Clé liée à NOTRE paiement interne, pas une clé aléatoire par appel SDK : si Mercado Pago la
    // respecte, un nouvel essai sur le MÊME payment_id ne crée pas une seconde préférence (cf.
    // PREFERENCE_REQUEST_BOUNDS sur ce qui n'est pas garanti).
    requestOptions: { idempotencyKey: input.paymentId },
  }), PREFERENCE_DEADLINE_MS);

  if (!response.init_point) {
    throw new Error("Mercado Pago n'a renvoyé aucun init_point pour cette préférence.");
  }
  return {
    initPoint: response.init_point,
    preferenceId: response.id ?? null,
    collectorId: response.collector_id === undefined || response.collector_id === null
      ? null
      : String(response.collector_id),
  };
}

/**
 * Bornes du GET de re-confirmation (webhook). Mêmes raisons que PREFERENCE_REQUEST_BOUNDS — le SDK
 * attend sinon 60 s par tentative, 4 tentatives —, plus serrées : Mercado Pago n'attend pas
 * longtemps la réponse d'un webhook, et un 502 rapide le fait retenter proprement. 6 s par
 * tentative, une seule nouvelle tentative après 1 s au plus : 13 s tant que les en-têtes arrivent.
 */
export const PAYMENT_LOOKUP_BOUNDS = {
  timeout: 6_000,
  maxRetries: 1,
  maxDelay: 1_000,
} as const;

/** Échéance globale du GET (le délai du SDK ne couvre pas le corps), sous le maxDuration du webhook. */
export const PAYMENT_LOOKUP_DEADLINE_MS = 15_000;

// Re-confirmation serveur-à-serveur GET /v1/payments/{id} — jamais sur la seule foi du corps du
// webhook (spec §0 Tranche 1, pattern anti-race-condition recommandé par Mercado Pago). Config
// propre à l'appel, comme createCheckoutPreference : rien ne fuit d'un appel à l'autre.
export async function getMercadoPagoPayment(mpPaymentId: string) {
  const payment = new Payment(
    new MercadoPagoConfig({ accessToken: getAccessToken(), options: { ...PAYMENT_LOOKUP_BOUNDS } })
  );
  return withDeadline(payment.get({ id: mpPaymentId }), PAYMENT_LOOKUP_DEADLINE_MS);
}
