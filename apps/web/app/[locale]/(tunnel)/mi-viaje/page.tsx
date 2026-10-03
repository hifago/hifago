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
import { BackLink } from "@/components/atoms/BackLink";
import { EnlaceGo } from "@/components/atoms/EnlaceGo";
import { PageShell } from "@/components/atoms/PageShell";
import { EstadoVacio } from "@/components/molecules/EstadoVacio";
import { BandeauPagina } from "@/components/organisms/BandeauPagina";
import {
  hrefAlojamientosCompatibles,
  hrefRetornoCarrito,
  leerCriterios,
} from "@/lib/catalog/criterios";
import { computeTripRange, formatTripLabel } from "@/lib/orders/tripRange";
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

export default async function CartPage({ params, searchParams }: PageProps<"/[locale]/mi-viaje">) {
  const [{ locale }, paramsBrutos] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const t = await getTranslations("CartPage");
  const lines = await getCartLines(locale as Locale);
  const tripLabel =
    lines.length > 0
      ? formatTripLabel(computeTripRange(lines), locale, (key, values) =>
          t(key === "trip.range" ? "tripRange" : "tripSingle", values)
        )
      : undefined;

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
    <PageShell variant="pagina" testId="mi-viaje-page">
      <BandeauPagina
        variante="contenido"
        titulo={t("title")}
        chapo={tripLabel}
        volver={
          <BackLink
            href={hrefRetornoCarrito(leerCriterios(paramsBrutos))}
            label={t("continueExploring")}
            testId="continue-exploring"
          />
        }
        testId="mi-viaje-banner"
      />

      {lines.length > 0 ? (
        <CartSummary
          lines={lines}
          editable
          locale={locale as Locale}
          presentation="trip"
          lodgingRequirement={
            campSinAlojamiento
              ? {
                  message: t("lodgingRequiredNotice", { count: campSinAlojamiento.nuits }),
                  chooseHref: campSinAlojamiento.href,
                  chooseLabel: t("chooseLodging"),
                }
              : null
          }
        />
      ) : (
        <EstadoVacio
          titulo={t("emptyCart")}
          descripcion={t("emptyCartDescription")}
          accion={<EnlaceGo href="/" label={t("exploreActivities")} tamano="normal" />}
          testId="empty-cart"
        />
      )}
      <PendingOrdersNotice
        orders={pendingOrders}
        title={t("pendingOrdersTitle")}
        linkLabel={(reference) => t("pendingOrderLink", { reference })}
      />
    </PageShell>
  );
}
