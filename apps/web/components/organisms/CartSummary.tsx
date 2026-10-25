"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { differenceInCalendarDays } from "date-fns";
import { formatCop, isoDateToLocalMidnight } from "@hifago/domain";
import { createClient } from "@hifago/supabase/client";
// ⚠️ Corrigé le 2026-09-10 (spec 33) : ce fichier importait `useRouter` de `next/navigation`,
// ce que `scripts/check-i18n-links.sh` refuse — le contrôle était rouge depuis la livraison de
// la spec 32 le matin même. Sans effet visible ici (seul `refresh()` est appelé, et next-intl
// le conserve tel quel), mais un contrôle rouge qu'on laisse rouge cesse d'en être un.
import { Link, useRouter } from "@/i18n/navigation";
import { useCart } from "@/lib/cart/CartContext";
import { Button } from "@/components/atoms/Button";
import { Card } from "@/components/atoms/Card";
import { LinkButton } from "@/components/atoms/LinkButton";
import { Aviso } from "@/components/molecules/Aviso";
import { Price } from "@/components/atoms/Price";
import { PuceEstado } from "@/components/atoms/PuceEstado";
import { formatLineSchedule, resolveDisplayEndDate } from "@/lib/orders/formatLineSchedule";
import { computeCartLineTotal } from "@/lib/cart/cartLineTotal";
import type { CartLineForDisplay } from "@/lib/cart/getCartLines";
import type { TripEventForDisplay } from "@/lib/cart/getTripEvents";
import { isLineScopedReason } from "@/lib/cart/lineReasons";
import type { Locale } from "@/messages";

// Spec 32 (panier en base) — remplace le rendu de lignes autrefois porté par `CheckoutForm.tsx`.
// Déjà cité comme exemple d'organism dans `apps/web/components/README.md` avant même d'exister :
// utilisé en mode ÉDITABLE sur `/mi-viaje` (retrait de ligne) et en LECTURE SEULE sur `/pago`
// (`create_order` revalidera de toute façon tout au checkout — aucun bouton de retrait là-bas).
//
// Les lignes arrivent déjà jointes en props (`getCartLines`, Server Component) : ce composant ne
// fait aucune requête `.from("products"...)` lui-même, seulement un `delete` direct sur sa propre
// ligne `cart_items` au retrait (RLS directe, aucune RPC nécessaire — spec 32 §0).
export type CartSummaryProps = {
  lines: CartLineForDisplay[];
  /**
   * Spec 42 — les eventos non réservables notés dans Mi viaje (`presentation="trip"` seulement ;
   * `/pago` ne les reçoit jamais : rien à payer). Mêlés aux lignes par date, sans prix ni
   * quantité, et hors du total.
   */
  eventos?: TripEventForDisplay[];
  editable: boolean;
  locale: Locale;
  presentation?: "trip" | "checkout";
  lodgingRequirement?: {
    message: string;
    chooseHref: string;
    chooseLabel: string;
  } | null;
};

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </svg>
  );
}

// Mi viaje dans l'ordre des dates (Jérôme, 2026-09-16 et 2026-10-19), lignes du panier et eventos
// notés mêlés. Les deux listes arrivent déjà triées par date : une fusion, jamais un tri — et à date
// égale, la réservation d'abord.
type ElementoViaje =
  | { tipo: "linea"; line: CartLineForDisplay; indice: number }
  | { tipo: "evento"; evento: TripEventForDisplay };

function fusionarPorFecha(lines: CartLineForDisplay[], eventos: TripEventForDisplay[]): ElementoViaje[] {
  const elementos: ElementoViaje[] = [];
  let i = 0;
  let j = 0;
  while (i < lines.length || j < eventos.length) {
    if (j >= eventos.length || (i < lines.length && lines[i].date <= eventos[j].date)) {
      elementos.push({ tipo: "linea", line: lines[i], indice: i });
      i += 1;
    } else {
      elementos.push({ tipo: "evento", evento: eventos[j] });
      j += 1;
    }
  }
  return elementos;
}

export function CartSummary({
  lines,
  eventos = [],
  editable,
  locale,
  presentation = editable ? "trip" : "checkout",
  lodgingRequirement = null,
}: CartSummaryProps) {
  const t = useTranslations("CartPage");
  const tCheckout = useTranslations("CheckoutPage");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const { refresh } = useCart();
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function handleRemove(id: string, tabla: "cart_items" | "trip_events" = "cart_items") {
    setRemovingId(id);
    const supabase = createClient();
    await supabase.from(tabla).delete().eq("id", id);
    // `refresh()` resynchronise la pastille du header (CartContext, compte seul) ; `router.refresh()`
    // relit `getCartLines` côté serveur pour que CETTE liste reflète le retrait.
    await refresh();
    router.refresh();
  }

  // UN seul passage : `computeCartLineTotal` parcourt les nuits une par une (date-fns `format`
  // par nuit) pour une ligne d'hébergement — le recalculer dans le `map` d'affichage doublait ce
  // travail à chaque rendu, donc à chaque retrait de ligne.
  const totalesPorLinea = lines.map(computeCartLineTotal);
  const total = totalesPorLinea.reduce((sum, montant) => sum + montant, 0);
  // Estimation FIXE à 17 %, jamais le pourcentage exact selon commission_case (create_order, qui
  // peut descendre à 9 % sur un cas rare d'auto-parrainage) — même principe « panier = estimation
  // affichée » que le reste de ce composant, cf. cartLineTotal.ts.
  const totalNow = Math.round(total * 0.17);

  if (lines.length === 0 && eventos.length === 0) {
    return (
      <p data-testid="empty-cart" className="text-sm text-muted">
        {t("emptyCart")}
      </p>
    );
  }

  // Ligne signalée par `cart_lines_availability` : le texte de SA raison, le même que celui d'un
  // refus de create_order — jamais retirée d'office, le client choisit. Une raison hors de la liste
  // fermée (dérive future) garde le texte générique plutôt qu'une clé manquante.
  const motifIndisponible = (reason: string | null) =>
    isLineScopedReason(reason) ? tCheckout(`errors.${reason}`) : t("lineUnavailable");
  // Disponibilité illisible (panne, ligne ajoutée entre deux lectures) : UN avis pour tout le
  // panier, jamais une ligne présentée comme disponible — create_order tranchera à l'envoi.
  const disponibiliteInconnue = lines.some((line) => line.availability.status === "unknown");

  const liste = (
    <>
      {disponibiliteInconnue ? (
        <Aviso tono="info" compacto testId="availability-unknown">
          {t("availabilityUnknown")}
        </Aviso>
      ) : null}
      <ul className="flex flex-col divide-y divide-separator">
        {fusionarPorFecha(lines, eventos).map((elemento) => {
          if (elemento.tipo === "evento") {
            const { evento } = elemento;
            return (
              <li
                key={evento.id}
                data-testid={`trip-event-${evento.id}`}
                className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <Link
                      href={`/productos/${evento.productSlug}`}
                      className="text-base font-semibold underline-offset-4 hover:underline sm:text-[17px]"
                    >
                      {evento.productName}
                    </Link>
                    <span className="text-sm text-muted">
                      {evento.establishmentName} ·{" "}
                      {formatLineSchedule(
                        { date: evento.date, slotStartTime: evento.startTime?.slice(0, 5) ?? null },
                        locale
                      )}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                    <PuceEstado tono="neutro" testId={`trip-event-badge-${evento.id}`}>
                      {t("eventoSinReserva")}
                    </PuceEstado>
                    {editable ? (
                      <Button
                        type="button"
                        variant="outline"
                        color="neutral"
                        size="sm"
                        onPress={() => handleRemove(evento.id, "trip_events")}
                        isDisabled={removingId === evento.id}
                        iconBefore={<TrashIcon />}
                        testId={`remove-trip-event-${evento.id}`}
                      >
                        {t("removeLine")}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {evento.onOccurrence ? null : (
                  <Aviso tono="error" compacto rol="alert" testId={`trip-event-off-date-${evento.id}`}>
                    {t("eventoNoLongerOnDate")}
                  </Aviso>
                )}
              </li>
            );
          }
          const { line, indice: i } = elemento;
          return (
            <li
              key={line.id}
              data-testid={`cart-line-${line.id}`}
              data-availability={line.availability.status}
              className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-base font-semibold sm:text-[17px]">{line.productName}</span>
                  <span className="text-sm text-muted">
                    {line.establishmentName} · {formatLineSchedule(line, locale)}
                    {resolveDisplayEndDate(line)
                      ? ` · ${t("lineNights", {
                          count: differenceInCalendarDays(
                            isoDateToLocalMidnight(resolveDisplayEndDate(line)!),
                            isoDateToLocalMidnight(line.date)
                          ),
                        })}`
                      : ""}
                    {/* Spec 43 : ce que compte la quantité d'une activité (heures, activité entière). */}
                    {` · ${
                      line.pricingUnit === "per_hour"
                        ? t("lineHours", { count: line.qty })
                        : line.pricingUnit === "per_activity"
                          ? t("lineActivity")
                          : t("lineQty", { count: line.qty })
                    }`}
                  </span>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                  <span className="font-semibold tabular-nums">
                    {/* Prix Lobby non estimable (2026-10-23) : jamais un 0 affiché comme un prix. */}
                    {line.pmsPrice?.kind === "pending" ? (
                      <span className="text-sm font-normal text-muted" data-testid={`pms-price-pending-${line.id}`}>
                        {t("pmsPricePending")}
                      </span>
                    ) : (
                      <Price amountCop={totalesPorLinea[i]} locale={locale} />
                    )}
                  </span>
                  {editable ? (
                    <Button
                      type="button"
                      variant="outline"
                      color="neutral"
                      size="sm"
                      onPress={() => handleRemove(line.id)}
                      isDisabled={removingId === line.id}
                      iconBefore={<TrashIcon />}
                      testId={`remove-line-${line.id}`}
                    >
                      {t("removeLine")}
                    </Button>
                  ) : null}
                </div>
              </div>
              {/* Prix Lobby : le devis de /pago diffère de ce que le miroir laissait attendre — le client
                  voit le nouveau prix AVANT de payer ; sur /mi-viaje, l'estimation est dite comme telle. */}
              {line.pmsPrice?.kind === "quoted" &&
              line.pmsPrice.estimateCop !== null &&
              line.pmsPrice.estimateCop !== line.pmsPrice.totalCop ? (
                <Aviso tono="info" compacto testId={`pms-price-updated-${line.id}`}>
                  {t("pmsPriceUpdated", { before: formatCop(line.pmsPrice.estimateCop) })}
                </Aviso>
              ) : line.pmsPrice?.kind === "estimated" ? (
                <p className="text-sm text-muted" data-testid={`pms-price-estimated-${line.id}`}>
                  {t("pmsPriceEstimated")}
                </p>
              ) : null}
              {line.availability.status === "unavailable" ? (
                <Aviso
                  tono="error"
                  compacto
                  rol="alert"
                  testId={`unavailable-${line.id}`}
                >
                  {motifIndisponible(line.availability.reason)}
                </Aviso>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );

  const totaux = (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4" data-testid="cart-total">
        <span className="titre-bloc">{t("total")}</span>
        <span className="text-lg font-semibold tabular-nums">
          <Price amountCop={total} locale={locale} />
        </span>
      </div>
      {lines.some((line) => line.pmsPrice?.kind === "pending") ? (
        <p className="text-sm text-muted" data-testid="pms-total-pending">
          {t("pmsTotalPending")}
        </p>
      ) : null}
      <div className="rounded-[16px] bg-[var(--default)] p-4" data-testid="cart-total-now">
        <p className="meta">{t("depositToday")}</p>
        <p className="prix-fort mt-1 tabular-nums">
          <Price amountCop={totalNow} locale={locale} />
        </p>
      </div>
      <p className="text-sm text-muted">{t("depositExplanation")}</p>
    </div>
  );

  if (presentation === "checkout") {
    return (
      <Card contentGap="md" padding="lg" testId="trip-summary">
        {liste}
        <div className="border-t border-separator pt-4">{totaux}</div>
      </Card>
    );
  }

  // Spec 42 : des eventos notés et aucune ligne de panier — rien à payer, ni total ni « Ir a
  // pagar » : la liste seule.
  if (lines.length === 0) {
    return (
      <Card contentGap="md" padding="lg" testId="trip-summary">
        {liste}
      </Card>
    );
  }

  const action = lodgingRequirement ? (
    <Aviso
      tono="alerta"
      testId="lodging-required-notice"
      accion={
        <>
          <Button isDisabled size="lg" width="full" testId="go-to-checkout">
            {t("goToCheckout")}
          </Button>
          <LinkButton
            href={lodgingRequirement.chooseHref}
            variant="outline"
            color="neutral"
            width="full"
            testId="choose-lodging-button"
          >
            {lodgingRequirement.chooseLabel}
          </LinkButton>
        </>
      }
    >
      {lodgingRequirement.message}
    </Aviso>
  ) : (
    <div className="fixed inset-x-5 bottom-4 z-20 rounded-[12px] bg-background/95 p-2 shadow-lg backdrop-blur lg:static lg:rounded-none lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
      <LinkButton href="/pago" size="lg" width="full" testId="go-to-checkout">
        <span className="lg:hidden">
          {t("goToCheckout")} · <Price amountCop={totalNow} locale={locale} />
        </span>
        <span className="hidden lg:inline">{t("goToCheckout")}</span>
      </LinkButton>
    </div>
  );

  return (
    <div className="flex flex-col gap-6 pb-16 lg:pb-0">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <Card contentGap="md" padding="lg" testId="trip-summary">
          {liste}
        </Card>
        {/* `top-24` : sous le header collant (`SiteHeader`, `h-16`), avec 32 px d'air. */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
          <Card contentGap="md" padding="lg" testId="trip-recap">
            {totaux}
            {action}
            <p className="meta">{tCommon("cancellationPolicy")}</p>
          </Card>
        </aside>
      </div>

    </div>
  );
}
