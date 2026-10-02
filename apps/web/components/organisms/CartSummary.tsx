"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@hifago/supabase/client";
// ⚠️ Corrigé le 2026-09-10 (spec 33) : ce fichier importait `useRouter` de `next/navigation`,
// ce que `scripts/check-i18n-links.sh` refuse — le contrôle était rouge depuis la livraison de
// la spec 32 le matin même. Sans effet visible ici (seul `refresh()` est appelé, et next-intl
// le conserve tel quel), mais un contrôle rouge qu'on laisse rouge cesse d'en être un.
import { useRouter } from "@/i18n/navigation";
import { useCart } from "@/lib/cart/CartContext";
import { Button, cn } from "@hifago/ui";
import { Card } from "@/components/atoms/Card";
import { Price } from "@/components/atoms/Price";
import { formatLineSchedule } from "@/lib/orders/formatLineSchedule";
import { computeTripRange, formatTripLabel } from "@/lib/orders/tripRange";
import { computeCartLineTotal } from "@/lib/cart/cartLineTotal";
import type { CartLineForDisplay } from "@/lib/cart/getCartLines";
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
  editable: boolean;
  locale: Locale;
};

export function CartSummary({ lines, editable, locale }: CartSummaryProps) {
  const t = useTranslations("CartPage");
  // Le titre "Tu viaje del X al X" est partagé avec l'écran de résultat — mêmes clés
  // `OrderResultPage.trip.*`, jamais recopiées (cf. `lib/orders/tripRange.ts`).
  const tTrip = useTranslations("OrderResultPage");
  const router = useRouter();
  const { refresh } = useCart();
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function handleRemove(id: string) {
    setRemovingId(id);
    const supabase = createClient();
    await supabase.from("cart_items").delete().eq("id", id);
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
  // peut descendre à 7 % sur un cas rare d'auto-parrainage) — même principe « panier = estimation
  // affichée » que le reste de ce composant, cf. cartLineTotal.ts.
  const totalNow = Math.round(total * 0.17);

  if (lines.length === 0) {
    return (
      <p data-testid="empty-cart" className="text-sm text-muted">
        {t("emptyCart")}
      </p>
    );
  }

  // Calculé APRÈS la garde ci-dessus : `computeTripRange` suppose `lines` non vide (même
  // invariant que côté commande, tenu ici par l'embranchement plutôt que par `create_order`).
  const tripLabel = formatTripLabel(computeTripRange(lines), locale, tTrip);

  return (
    <Card title={tripLabel} titleAs="h2" titleSize="bloque" contentGap="md" testId="trip-summary">
      <ul className="flex flex-col gap-3">
        {lines.map((line, i) => (
          <li
            key={line.id}
            data-testid={`cart-line-${line.id}`}
            data-unavailable={line.unavailable}
            className={cn(
              "flex items-center justify-between gap-4 rounded-lg border p-3 text-sm",
              line.unavailable ? "border-danger bg-danger/10" : "border"
            )}
          >
            <div className="flex flex-col">
              <span className="font-medium">{line.productName}</span>
              <span className="text-muted">
                {line.establishmentName} · {formatLineSchedule(line)} ·{" "}
                {t("lineQty", { count: line.qty })}
              </span>
              {line.unavailable ? (
                <span role="alert" data-testid={`unavailable-${line.id}`} className="text-xs text-danger">
                  {t("lineUnavailable")}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <Price amountCop={totalesPorLinea[i]} locale={locale} />
              {editable ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onPress={() => handleRemove(line.id)}
                  isDisabled={removingId === line.id}
                  data-testid={`remove-line-${line.id}`}
                >
                  {t("removeLine")}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <p className="text-lg font-medium" data-testid="cart-total">
        {t("total")}: <Price amountCop={total} locale={locale} />
      </p>
      <p className="text-sm text-muted" data-testid="cart-total-now">
        {t("totalNow")}: <Price amountCop={totalNow} locale={locale} />
      </p>
    </Card>
  );
}
