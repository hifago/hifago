"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@hifago/supabase/client";
import { cn } from "@hifago/ui";
import { Button } from "@/components/atoms/Button";
import { LinkButton } from "@/components/atoms/LinkButton";
import {
  PuceEstado,
  TONO_POR_ESTADO_PEDIDO,
  tonoDeLinea,
} from "@/components/atoms/PuceEstado";
// ⚠️ `useRouter` d'`@/i18n/navigation`, jamais de `next/navigation` (scripts/check-i18n-links.sh).
// Ici seul `refresh()` est utilisé — que next-intl conserve tel quel (il ne surcharge que
// push/replace/prefetch) — mais la règle ne souffre pas d'exception au cas par cas : un jour
// quelqu'un ajoutera un `push` dans ce fichier, et il perdrait le préfixe de langue en silence.
import { Link, useRouter } from "@/i18n/navigation";
import { Card } from "@/components/atoms/Card";
import { Price } from "@/components/atoms/Price";
import { Aviso } from "@/components/molecules/Aviso";
import { MontantsLigne } from "@/components/molecules/MontantsLigne";
import { Title } from "@/components/atoms/Title";
import { BandeauPagina } from "@/components/organisms/BandeauPagina";
import { formatLineSchedule } from "@/lib/orders/formatLineSchedule";
import { deriveOrderState, isDeadLine } from "@/lib/orders/orderState";
import { computeTripRange, formatTripLabel } from "@/lib/orders/tripRange";
import type { OrderForDisplay } from "@/lib/orders/getOrderByToken";
import type { Locale } from "@/messages";

// Spec 33 — l'écran de résultat, et la fermeture du tunnel.
//
// Colocalisé avec sa route, jamais dans `components/organisms/` : il ne sert qu'ici, et
// `components/README.md` réserve `components/` à ce qui est prouvé consommé par au moins deux
// endroits (`CartSummary` y est parce qu'il sert `/mi-viaje` ET `/pago`). Mêmes précédents :
// `pago/CheckoutForm.tsx`, `cuenta/reservas/OrdersList.tsx`.
//
// ⚠️ CE N'EST PAS `CartSummary`, et la tentation de fusionner est réelle : mêmes lignes, même mise
// en forme. Les deux divergent sur le FOND — `CartSummary` lit `products.price_cop` VIVANT et sait
// retirer une ligne ; celui-ci lit `order_lines.total_cop`/`acompte_cop` FIGÉS au moment de la
// commande. Les fusionner ferait afficher un prix courant sur une commande passée (spec 32
// invariant 3). Seule la mise en forme commune est partagée, via `formatLineSchedule`.
//
// ⚠️ `startPayment` vit ICI et non dans `CheckoutForm` : l'état de paiement doit survivre au
// retour de Mercado Pago, donc vivre sur une adresse rechargeable plutôt que dans un `useState`
// (le récit complet est dans `packages/e2e-support/src/payments.ts`).

// Vocabulaire propre à `create_payment_intent`, repris tel quel de `CheckoutForm` — un motif
// inattendu retombe sur "unknown" plutôt que de faire échouer next-intl sur une clé manquante.
const PAYMENT_ERROR_REASONS = [
  "payment_already_pending",
  "already_paid",
  "nothing_to_pay",
  "order_not_found",
  "mercadopago_unavailable",
  "order_expiring",
] as const;

type PaymentIntentResult = {
  ok: boolean;
  reason?: string;
  payment_id?: string;
};

/**
 * Que faire de la réponse de `/api/pms/reserve-nights`, appelée quand `create_payment_intent` refuse
 * avec `pms_booking_missing` (migration 20260930221837 : aucun paiement tant qu'une nuit PMS n'a pas
 * son booking — client parti avant la fin du tunnel, onglet fermé pendant l'appel à Lobby).
 *
 * - `booked` : redemander UN intent, une seule fois. S'il manque encore un booking, ce second refus
 *   tombe sur « unknown » : jamais de boucle.
 * - `stop` : on s'arrête, et l'écran est TOUJOURS relu — un autre onglet a pu défaire ou payer la
 *   commande pendant l'appel, et c'est l'état relu (annulée, expirée, payée, encore à payer) qui dit
 *   ce qu'elle est devenue. `notice` en donne la raison ; jamais l'état d'écran `failed`, dont le
 *   détail promet « Tu reserva sigue guardada ».
 *
 * « Relâchée » n'est cru que sur `released === true`, comme dans CheckoutForm. Quand la route devait
 * défaire la commande et n'a pas pu (`released: false` sur un échec PMS), `blockPayment` retire le
 * bouton : un nouvel essai rappellerait Lobby et rouvrirait une entrée de réconciliation (un e-mail à
 * chaque admin) pour une commande qui expirera de toute façon. « On ne sait pas »
 * (`pms_unknown_outcome`) n'est dit que sur un corps illisible ou un réseau coupé.
 *
 * Même lecture de `reason`/`released` que `reserveNightsErrorKey` (CheckoutForm), mais pas la même
 * fonction : ici une commande peut déjà être payée (`order_paid`), et l'écran sait se relire.
 */
export type PmsNoticeKey =
  | "pms_refused"
  | "pms_unavailable"
  | "pms_unreachable"
  | "pms_refused_pending"
  | "pms_release_pending"
  | "pms_claim_in_progress"
  | "pms_unknown_outcome"
  | "pms_unconfirmed"
  | "order_not_found"
  | "order_expiring";

export type BookingRecovery =
  | { kind: "booked" }
  | { kind: "stop"; notice: PmsNoticeKey | null; blockPayment: boolean };

type ReserveNightsBody = { ok?: boolean; reason?: string; released?: boolean };

/** Ce qu'une notice peut expliquer : un arrêt de la reprise PMS, ou un intent devenu sans objet. */
type NoticeKey = PmsNoticeKey | "nothing_to_pay" | "already_paid";

/**
 * États où un paiement a progressé (ici ou dans un autre onglet) : une notice d'arrêt n'y a plus
 * rien à dire — « vuelve a reservar » sous « Pago confirmado » pousserait à une seconde réservation.
 */
const PAYMENT_PROGRESSED_STATES: readonly string[] = ["paid", "awaiting", "refunded", "paid_not_honored"];

const stop = (notice: PmsNoticeKey | null, blockPayment = false): BookingRecovery => ({
  kind: "stop",
  notice,
  blockPayment,
});

export function bookingRecovery(
  httpOk: boolean,
  body: ReserveNightsBody | null,
): BookingRecovery {
  if (httpOk) return { kind: "booked" };
  if (body === null) return stop("pms_unknown_outcome"); // 500/504 de la plateforme, corps illisible
  if (body.reason === "order_paid") return stop(null);
  // Trop tard pour payer (limite de paiement − bail, migration 20261001194704) : rien n'a été réservé,
  // et un nouvel essai ne ferait que répéter le refus — bouton retiré.
  if (body.reason === "order_expiring") return stop("order_expiring", true);
  if (body.reason === "pms_claim_in_progress") return stop("pms_claim_in_progress");
  if (body.released === true) {
    if (body.reason === "pms_refused" || body.reason === "pms_unavailable")
      return stop(body.reason);
    // order_not_active : la commande était déjà défaite (expirée) — l'écran relu le dit seul.
    if (body.reason === "order_not_active") return stop(null);
    return stop("pms_unreachable");
  }
  if (body.reason === "pms_refused") return stop("pms_refused_pending", true);
  if (body.reason === "pms_unavailable" || body.reason === "pms_unreachable") {
    return stop("pms_release_pending", true);
  }
  if (body.reason === "order_not_found") return stop("order_not_found");
  // Erreur de base avant tout appel à Lobby (db_error), corps refusé : rien n'a été tenté.
  return stop("pms_unconfirmed");
}

async function reserveMissingBookings(
  orderId: string,
): Promise<BookingRecovery> {
  let response: Response;
  try {
    response = await fetch("/api/pms/reserve-nights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
  } catch {
    return stop("pms_unknown_outcome");
  }
  const body = (await response
    .json()
    .catch(() => null)) as ReserveNightsBody | null;
  return bookingRecovery(response.ok, body);
}

/** Cadence et plafond du rafraîchissement pendant l'attente du webhook (≈ 1 minute au total). */
const REFRESH_INTERVAL_MS = 3000;
const MAX_REFRESH_TICKS = 20;

export type OrderResultProps = {
  order: OrderForDisplay;
  locale: Locale;
  /** Un compte RÉEL, jamais une identité anonyme (spec 33 invariant 8, résolu par la page). */
  isRealAccount: boolean;
  /** `?payment=` de la page — lu là-bas (searchParams serveur), jamais ici (cf. son en-tête). */
  paymentOutcome: "approved" | "pending" | "rejected" | null;
};

export function OrderResult({
  order,
  locale,
  isRealAccount,
  paymentOutcome,
}: OrderResultProps) {
  const t = useTranslations("OrderResultPage");
  const router = useRouter();
  // Retour de Mercado Pago (réel ou simulé) avec un paiement rejeté : la page s'est entièrement
  // remontée depuis le serveur (spec 33, adresse rechargeable), donc rien du `useState` local de
  // `startPayment` n'a survécu — c'est `?payment=rejected` qui porte l'information jusqu'ici, lue en
  // initialiseur (jamais posée depuis un effet : `react-hooks/set-state-in-effect` l'interdit, et ça
  // évite de toute façon un rendu intermédiaire sans le message). Elle superpose le même état d'écran
  // `failed` qu'un échec détecté avant le départ (cf. en-tête du fichier).
  const [paymentError, setPaymentError] = useState<string | null>(() =>
    paymentOutcome === "rejected" ? t("errors.payment_rejected") : null,
  );
  const [isPaying, setIsPaying] = useState(false);
  // Pendant l'appel à reserve-nights (jusqu'à près d'une minute chez Lobby) : le bouton ne dit pas
  // « Redirigiendo a Mercado Pago » tant que rien n'est parti vers Mercado Pago.
  const [isConfirmingBooking, setIsConfirmingBooking] = useState(false);
  // La raison d'un arrêt, affichée PAR-DESSUS l'état relu (annulée, expirée) — jamais l'état d'écran
  // `failed`, dont le détail dit « Tu reserva sigue guardada ». Cf. `bookingRecovery`. Gardée en
  // CLÉ, et filtrée au rendu selon l'état relu (cf. `visibleNotice`).
  const [noticeKey, setNoticeKey] = useState<NoticeKey | null>(null);
  // Relâchement impossible, ou trop tard pour payer : plus de bouton sur cette page.
  const [isPaymentBlocked, setIsPaymentBlocked] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();

  // Efface `?payment=` une fois lu, pour qu'un simple rechargement de cette page n'affiche pas
  // indéfiniment un rejet déjà vu. Ne pose aucun état — seulement l'URL — donc pas concerné par
  // `react-hooks/set-state-in-effect`.
  useEffect(() => {
    if (paymentOutcome !== "rejected") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("payment");
    window.history.replaceState(null, "", url);
  }, [paymentOutcome]);

  // L'état de la COMMANDE et l'incident de PAIEMENT sont deux choses distinctes : les mélanger
  // faisait réécrire trois fois les mêmes conditions (et rendait `isPayable` vrai sur une commande
  // déjà payée dont un paiement de trop avait échoué).
  const orderState = deriveOrderState(order);
  // Spec 39 : on ne sonde que s'il reste réellement quelque chose à confirmer (`awaiting`), jamais
  // une commande morte dont le paiement local est resté `pending`.
  const isAwaiting = orderState === "awaiting";

  const state = paymentError ? "failed" : orderState;
  // Une notice se tait dès qu'un paiement a progressé, et celle de `order_expiring` ne parle que d'une
  // commande encore à payer : expirée ou annulée entre-temps, l'état relu dit déjà tout (« Esta
  // reserva expiró… las fechas quedaron liberadas » sous « se liberarán » se contredisait).
  const visibleNotice =
    noticeKey !== null &&
    !PAYMENT_PROGRESSED_STATES.includes(orderState) &&
    (noticeKey !== "order_expiring" || orderState === "unpaid")
      ? t(`errors.${noticeKey}`)
      : null;
  const isPayable = orderState === "unpaid" && !isPaymentBlocked;

  // Le webhook Mercado Pago peut arriver APRÈS la redirection du client : tant que la commande est
  // 'pending', on relit l'écran pour qu'il se mette à jour tout seul.
  //
  // ⚠️ L'ÉTAT affiché se relit par `router.refresh()`, jamais par une route qui le renverrait en
  // `service_role` sur la seule possession de l'`order_id` — l'autre modèle d'autorisation, celui que
  // la spec 33 a écarté (§3 décision ② : l'identifiant et le secret ne doivent pas être le même
  // objet). Sonder une telle route d'ici aurait donné DEUX modèles d'accès au même écran, et rendu
  // faux l'invariant 2 (« aucune lecture directe de la commande depuis l'écran : tout passe par
  // `get_order_by_token` »). Un refresh relit `get_order_by_token` — même jeton, même garde.
  //
  // ⚠️ BORNÉ. Sans plafond, un paiement abandonné ferait sonder toutes les 3 s jusqu'à ce que le job
  // de réconciliation expire la commande, une demi-heure plus tard : des centaines de rendus serveur
  // pour une information qui arrive en quelques secondes. On s'arrête après MAX_TICKS, et on ne
  // sonde pas un onglet que personne ne regarde.
  //
  // ⚠️ Le corps est écrit INLINE dans l'effet, jamais délégué à une fonction nommée : la règle
  // `react-hooks/set-state-in-effect` (eslint-plugin-react-hooks 7.1.1) trace statiquement qu'un
  // identifiant appelé dans un effet pose de l'état. Même patron que `CoquillaVitrine`.
  useEffect(() => {
    if (!isAwaiting) return;
    let ticks = 0;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      ticks += 1;
      if (ticks > MAX_REFRESH_TICKS) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isAwaiting, router]);

  async function startPayment() {
    setPaymentError(null);
    setNoticeKey(null);
    setIsPaying(true);

    // Trop tard pour payer (`order_expiring`) : la commande n'est pas défaite, elle expirera seule.
    // Notice, plus de bouton (un nouvel essai répéterait le refus), écran relu — jamais
    // `failed`, dont le détail promet « Tu reserva sigue guardada. Puedes intentar el pago de nuevo ».
    const stopExpiring = () =>
      startRefresh(() => {
        setNoticeKey("order_expiring");
        setIsPaymentBlocked(true);
        router.refresh();
      });

    const supabase = createClient();
    const requestIntent = async () => {
      const { data, error } = await supabase.rpc("create_payment_intent", {
        p_order_id: order.id,
      });
      return {
        intentResult: data as PaymentIntentResult | null,
        intentError: error,
      };
    };
    let { intentResult, intentError } = await requestIntent();

    if (!intentError && intentResult?.reason === "pms_booking_missing") {
      setIsConfirmingBooking(true);
      const recovery = await reserveMissingBookings(order.id);
      setIsConfirmingBooking(false);
      if (recovery.kind === "stop") {
        setIsPaying(false);
        // Dans la transition : la notice n'apparaît qu'avec l'état relu, jamais au-dessus de
        // l'ancien (« Paga el anticipo » sous « la reserva quedó anulada »).
        startRefresh(() => {
          setNoticeKey(recovery.notice);
          if (recovery.blockPayment) setIsPaymentBlocked(true);
          router.refresh();
        });
        return;
      }
      // Une seule fois : un second `pms_booking_missing` retombe sur « unknown » ci-dessous.
      ({ intentResult, intentError } = await requestIntent());
    }

    if (intentError || !intentResult?.ok) {
      setIsPaying(false);
      const raw = intentResult?.reason;
      const reason =
        raw !== undefined &&
        (PAYMENT_ERROR_REASONS as readonly string[]).includes(raw)
          ? raw
          : "unknown";
      if (reason === "order_expiring") {
        stopExpiring();
        return;
      }
      // Plus rien à payer, ou déjà payé : la commande a changé sous cet écran (expirée, défaite ou
      // payée depuis un autre onglet). On relit au lieu d'afficher `failed` et « Tu reserva sigue
      // guardada » sur une commande qui ne l'est plus.
      if (reason === "nothing_to_pay" || reason === "already_paid") {
        startRefresh(() => {
          setNoticeKey(reason === "nothing_to_pay" ? "nothing_to_pay" : "already_paid");
          router.refresh();
        });
        return;
      }
      setPaymentError(t(`errors.${reason}`));
      return;
    }

    let createResponse: Response;
    try {
      createResponse = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId: intentResult.payment_id }),
      });
    } catch {
      setIsPaying(false);
      setPaymentError(t("errors.mercadopago_unavailable"));
      return;
    }
    const createResult = (await createResponse.json().catch(() => null)) as
      | { ok: boolean; init_point?: string; reason?: string }
      | null;
    // La même limite, vue par payments/create (horloge du serveur, à la seconde près de celle de la
    // base) : jamais affichée comme une panne de Mercado Pago. ⚠️ L'intent vient d'être accepté juste
    // avant la limite : il a DÉJÀ passé la commande en `pending`, et l'écran relu dit « confirmando »
    // (notice tue) jusqu'à l'expiration — fenêtre de quelques secondes, limite connue.
    if (createResult?.reason === "order_expiring") {
      setIsPaying(false);
      stopExpiring();
      return;
    }
    if (!createResponse.ok || !createResult?.ok || !createResult.init_point) {
      setIsPaying(false);
      setPaymentError(t("errors.mercadopago_unavailable"));
      return;
    }

    // Redirection réelle vers Checkout Pro — la page se démonte ici, `isPaying` volontairement
    // jamais remis à false (rien à afficher après un unmount). Mercado Pago renverra sur CETTE
    // adresse, quelle que soit l'issue.
    window.location.href = createResult.init_point;
  }

  const tripLabel = formatTripLabel(computeTripRange(order.lines), locale, t);
  const tonoEstado = TONO_POR_ESTADO_PEDIDO[state];
  // `Aviso` n'a pas de ton neutre : une annulation est une information, sans la peindre en erreur.
  const tonoAviso = tonoEstado === "neutro" ? "info" : tonoEstado;
  // Paiement bloqué (relâchement PMS impossible, trop tard pour payer) : ne plus promettre un
  // paiement qu'on a justement retiré. La notice dans l'`Aviso` devient alors l'unique détail, comme avant P7.
  const detalleEstado =
    isPaymentBlocked && state === "unpaid"
      ? undefined
      : t(`status.${state}Detail`);

  return (
    <>
      <BandeauPagina
        variante="contenido"
        titulo={t("title", { reference: order.reference })}
        conPunto={false}
        complementoTitulo={
          <PuceEstado tono={tonoEstado} testId={`order-status-${state}`}>
            {t(`status.${state}`)}
          </PuceEstado>
        }
        chapo={detalleEstado}
        testId="order-result-banner"
      />

      <div
        className="mx-auto flex w-full max-w-2xl flex-col gap-6"
        data-testid="order-result"
      >
        <Aviso
          tono={tonoAviso}
          titulo={t(`status.${state}`)}
          rol="status"
          testId={`order-state-${state}`}
        >
          {/* Paiement retiré (relâchement impossible, trop tard pour payer) : le détail d'`unpaid`
            dirait encore « Paga el anticipo » sous une page sans bouton — la notice dit seule ce qui
            va se passer. */}
          {detalleEstado ? <p>{detalleEstado}</p> : null}
          {paymentError ? (
            <p
              role="alert"
              data-testid="payment-error"
              className="mt-2 text-danger"
            >
              {paymentError}
            </p>
          ) : null}
          {visibleNotice ? (
            <p role="alert" data-testid="pms-notice" className="mt-2">
              {visibleNotice}
            </p>
          ) : null}
        </Aviso>

        {isPayable ? (
          <Button
            type="button"
            size="lg"
            onPress={startPayment}
            isDisabled={isPaying || isRefreshing}
            testId={paymentError ? "retry-payment-button" : "pay-button"}
          >
            {isConfirmingBooking
              ? t("confirmingBooking")
              : isPaying
                ? t("paying")
                : paymentError
                  ? t("retryPayment")
                  : t("pay")}
          </Button>
        ) : null}

        <Card
          title={tripLabel}
          titleAs="h2"
          titleSize="bloque"
          contentGap="md"
          padding="lg"
          testId="trip-summary"
        >
          {/* Plan 41, F6 : rangées séparées par le filet `--separator`, plus des boîtes bordées de
            marine dans la carte bordée de marine — même balisage que `CartSummary`/`OrderCard`. */}
          <ul className="flex flex-col divide-y divide-separator">
            {order.lines.map((line) => {
              const isDead = isDeadLine(line.status);
              return (
                <li
                  key={line.id}
                  data-testid={`order-line-${line.id}`}
                  data-status={line.status}
                  className={cn(
                    // Sous `sm`, le montant passe SOUS le libellé plutôt qu'à sa droite : rien n'est
                    // masqué selon la largeur, on réorganise (.claude/rules/ui.md) — même patron que
                    // OrderCard.tsx (`/cuenta/reservas`), nécessaire depuis que ce `<li>` porte un
                    // `<dl>` à deux montants et pas un seul `<Price>` court.
                    "flex flex-col gap-2 py-4 text-sm first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between",
                    isDead && "text-muted",
                  )}
                >
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span
                        className={cn("font-medium", isDead && "line-through")}
                      >
                        {line.productName}
                      </span>
                      <PuceEstado
                        tono={tonoDeLinea(line.status)}
                        testId={`line-status-${line.id}`}
                      >
                        {t(`lineStatus.${line.status}`)}
                      </PuceEstado>
                    </div>
                    <span className="text-muted">
                      {/* Spec 34 décision ③ — l'établissement devient un lien vers sa fiche. Rendu
                        même s'il est dépublié : le 404 est rare, et recopier ici le prédicat de
                        `establishments_select_public` créerait une seconde définition de
                        « publiquement visible » (spec 34 §9). */}
                      {line.establishmentSlug ? (
                        <Link
                          href={`/establecimientos/${line.establishmentSlug}`}
                          data-testid={`establishment-link-${line.id}`}
                          className="underline underline-offset-2"
                        >
                          {line.establishmentName}
                        </Link>
                      ) : (
                        line.establishmentName
                      )}{" "}
                      · {formatLineSchedule(line, locale)} ·{" "}
                      {t("lineQty", { count: line.qty })}
                    </span>
                    {/* Spec 34 décision ⑥ — écrire à l'établissement, message pré-rempli avec le
                      numéro de réservation : la forme exacte du portail en production
                      (`reservar.js`, « Hola, soy {name}, reserva #{id} »), à ceci près que
                      `reference` porte déjà son préfixe HFG-. L'URL de base est construite côté
                      serveur (`getOrderByToken`) ; seul le TEXTE est ajouté ici, parce qu'il est
                      localisé. Aucun bouton si l'établissement n'a pas de numéro.

                      ⚠️ Le libellé NOMME l'établissement, et ce n'est pas cosmétique : le pied de
                      page de la zone vitrine porte déjà « Escríbenos por WhatsApp », le canal
                      Hifago. Deux boutons WhatsApp quasi homonymes sur le même écran, dont l'un
                      écrit au prestataire et l'autre à la plateforme — constaté en capturant le
                      rendu réel le 2026-09-11. Le cahier §2c prévoit bien les deux canaux ; c'est
                      au libellé de dire lequel. */}
                    {line.establishmentContactUrl ? (
                      <a
                        href={`${line.establishmentContactUrl}?text=${encodeURIComponent(
                          t("contactMessage", {
                            name: order.holderName,
                            reference: order.reference,
                          }),
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`contact-whatsapp-${line.id}`}
                        className="text-xs underline underline-offset-2"
                      >
                        {t("contactWhatsApp", {
                          establishment: line.establishmentName,
                        })}
                      </a>
                    ) : null}
                  </div>
                  {/* Décision Gabriel (2026-09-16) : le reste dû sur place se lit par article, jamais
                    en un seul total agrégé en bas de carte — une commande peut toucher plusieurs
                    établissements, un montant unique induit en erreur. Le balisage est celui
                    d'`OrderCard.tsx` (`/cuenta/reservas`) parce que c'est LE MÊME composant : seule
                    la paire de montants change. */}
                  <MontantsLigne
                    locale={locale}
                    montants={[
                      {
                        label: t("total"),
                        amountCop: line.totalCop,
                        testId: `line-total-${line.id}`,
                      },
                      {
                        label: t("remainder"),
                        amountCop: line.totalCop - line.acompteCop,
                        testId: `line-remainder-${line.id}`,
                      },
                    ]}
                  />
                </li>
              );
            })}
          </ul>

          <dl className="flex flex-col gap-2 rounded-[16px] bg-[var(--default)] p-4">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm font-medium">{t("total")}</dt>
              <dd className="text-right font-semibold tabular-nums">
                <Price
                  amountCop={order.totalCop}
                  locale={locale}
                  testId="order-total"
                />
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm font-medium text-muted">{t("acompte")}</dt>
              <dd className="text-right font-semibold tabular-nums">
                <Price
                  amountCop={order.acompteCop}
                  locale={locale}
                  testId="order-acompte"
                />
              </dd>
            </div>
          </dl>
        </Card>

        <section className="flex flex-col gap-3">
          <Title as="h2" size="bloque">
            {t("holder")}
          </Title>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)]">
            <dt className="text-sm font-medium text-muted">
              {t("holderName")}
            </dt>
            <dd>{order.holderName}</dd>
            {order.holderPhone ? (
              <>
                <dt className="text-sm font-medium text-muted">
                  {t("holderPhone")}
                </dt>
                <dd>{order.holderPhone}</dd>
              </>
            ) : null}
            <dt className="text-sm font-medium text-muted">
              {t("holderEmail")}
            </dt>
            <dd className="break-words">{order.holderEmail}</dd>
          </dl>
        </section>

        <Aviso tono="info" testId="keep-link">
          {t("keepLink")}
        </Aviso>

        {isRealAccount ? (
          <LinkButton
            href="/cuenta/reservas"
            variant="soft"
            color="neutral"
            testId="view-orders-link"
          >
            {t("viewOrders")}
          </LinkButton>
        ) : (
          // Le rattachement des commandes par email est fait par `attach_orders_to_account`, appelée
          // depuis /auth/callback une fois l'email VÉRIFIÉ (spec 33 Tranche 3). L'email est pré-rempli
          // pour que le client ne rattache pas par erreur une adresse différente de sa commande.
          <div className="flex flex-col items-start gap-3">
            <LinkButton
              href={`/registro?next=/cuenta/reservas&email=${encodeURIComponent(order.holderEmail)}`}
              variant="soft"
              color="neutral"
              testId="create-account-link"
            >
              {t("createAccount")}
            </LinkButton>
            {/* Spec 34 décision ⑨ — un visiteur sans compte n'annule pas lui-même : la RPC refuse
                une session anonyme, et ouvrir « Anular » sur cette adresse donnerait un droit
                destructif à quiconque détient le lien (il circule par email, se transfère, et une
                annulation n'est ni remboursée ni réversible — spec 33 invariant 4). Son chemin est
                le bouton de contact posé plus haut, sur la prestation concernée. */}
            <p className="text-sm text-muted" data-testid="guest-cancel-hint">
              {t("guestCancelHint")}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
