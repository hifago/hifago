import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getCartLines } from "@/lib/cart/getCartLines";
import {
  findCampMissingLodging,
  nochesRequeridas,
  ultimoDiaCampIso,
} from "@/lib/cart/campMissingLodging";
import { getPendingOrdersForViewer } from "@/lib/orders/getPendingOrdersForViewer";
import { CartSummary } from "@/components/organisms/CartSummary";
import { LinkButton } from "@/components/atoms/LinkButton";
import { Title } from "@/components/atoms/Title";
// Jamais `Button` du barrel `@hifago/ui` ici : ce fichier est un Server Component (apps.md) —
// seul l'atome `"use client"` peut être importé sans faire planter `next build`.
import { Button } from "@/components/atoms/Button";
import { hrefAlojamientosCompatibles } from "@/lib/catalog/criterios";
import { PendingOrdersNotice } from "../PendingOrdersNotice";
import type { Locale } from "@/messages";

// Spec 32 (panier en base) — route déjà prévue par la spec 27
// (`docs/specs/27-architecture-vitrine-et-routage.md:75`, « à créer »), jamais bâtie faute d'un
// panier qui survive assez longtemps pour mériter son propre écran. `SiteHeader.tsx` pointait vers
// `/pago` en l'attendant (`ROUTE_PANIER`, commentaire daté du 2026-09-02) — bascule dans ce même
// lot. Renommée `/mi-viaje` le 2026-09-15 (recadrage "Mi viaje").
export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/mi-viaje">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "CartPage" });
  // Panier propre à une session, rien d'indexable — même raisonnement que /pago (spec 26 §5.1).
  return { title: t("title"), robots: { index: false, follow: true } };
}

export default async function CartPage({ params }: PageProps<"/[locale]/mi-viaje">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("CartPage");
  const lines = await getCartLines(locale as Locale);

  // create_order vide cart_items dès qu'elle réussit (spec 32) : un panier vide peut donc cacher
  // une commande déjà réservée, pas encore payée. Lu SEULEMENT sur ce chemin déjà froid — jamais
  // sur le chemin chaud d'un panier normal.
  const pendingOrders = lines.length === 0 ? await getPendingOrdersForViewer() : [];

  // Retour Jérôme (2026-09-15, relayé par Gabriel) : le bloc « hébergement obligatoire » vit dans
  // le panier, pas sur l'écran de recherche — c'est ici, au moment de payer, qu'il faut bloquer.
  // Pur guidage (cf. `campMissingLodging.ts`) : la barrière réelle reste `create_order`.
  // UN seul objet dérivé, pas trois variables à retester ensemble dans le JSX : soit il y a un camp
  // sans hébergement et tout ce que le bloc affiche existe, soit il n'y en a pas. Les deux formules
  // (nuits requises, dernier jour) viennent du MÊME module que le finder, donc de la même source que
  // `create_order` — jamais recopiées ici. `durationDays` y est forcément > 1 : le finder ne rend
  // que des lignes camp multi-jours.
  const lineaCampSinAlojamiento = findCampMissingLodging(lines);
  const campSinAlojamiento = lineaCampSinAlojamiento
    ? {
        nuits: nochesRequeridas(lineaCampSinAlojamiento.durationDays ?? 1),
        href: hrefAlojamientosCompatibles({
          desde: lineaCampSinAlojamiento.date,
          hasta: ultimoDiaCampIso(lineaCampSinAlojamiento.date, lineaCampSinAlojamiento.durationDays ?? 1),
          personas: lineaCampSinAlojamiento.qty,
        }),
      }
    : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <Title as="h1">{t("title")}</Title>
      <CartSummary lines={lines} editable locale={locale as Locale} />
      {lines.length > 0 ? (
        campSinAlojamiento ? (
          <div
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface-secondary p-4 text-sm"
            data-testid="lodging-required-notice"
          >
            <p>{t("lodgingRequiredNotice", { count: campSinAlojamiento.nuits })}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {/* Rendu, jamais masqué : l'état "pas encore prêt à payer" doit rester visible,
                  pas disparaître (cf. le CTA juste à côté qui dit quoi faire). */}
              <Button isDisabled size="lg" width="auto" testId="go-to-checkout">
                {t("goToCheckout")}
              </Button>
              <LinkButton
                href={campSinAlojamiento.href}
                variant="outline"
                // `neutral` : contour bleu moyen. En `accent` (le défaut), le contour était l'or sur
                // fond clair, 1.96:1 pour 3:1 requis (plan 41, F4).
                color="neutral"
                width="auto"
                testId="choose-lodging-button"
              >
                {t("chooseLodging")}
              </LinkButton>
            </div>
          </div>
        ) : (
          <LinkButton href="/pago" size="lg" width="auto" testId="go-to-checkout">
            {t("goToCheckout")}
          </LinkButton>
        )
      ) : null}
      <PendingOrdersNotice
        orders={pendingOrders}
        title={t("pendingOrdersTitle")}
        linkLabel={(reference) => t("pendingOrderLink", { reference })}
      />
    </main>
  );
}
