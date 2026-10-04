import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getEstablecimientoPorSlug } from "@/lib/catalog/establecimiento";
import { PageShell } from "@/components/atoms/PageShell";
import { Migas, type MigaItem } from "@/components/molecules/Migas";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildPageMetadata } from "@/lib/seo/pageMetadata";
import { getSiteUrl } from "@/lib/seo/siteUrl";
import { buildEstablishmentJsonLd } from "@/lib/seo/jsonld/establishment";
import { buildBreadcrumbJsonLd } from "@/lib/seo/jsonld/breadcrumb";
import { segmentoDeTipo } from "@/lib/catalog/segmentos";
import { migasParaJsonLd } from "@/lib/seo/migas";
import type { Locale } from "@/messages";
import { FichaEstablecimiento } from "./FichaEstablecimiento";

// LA FICHE D'UN LIEU (spec 30 §5d) — le dernier écran hérité de la vitrine.
//
// ⚠️ Cette route N'APPELLE PLUS SUPABASE : ses quatre requêtes vivent dans
// `lib/catalog/establecimiento.ts`. Avec elle, la liste d'exemptions de `check-data-layer.sh`
// tombe à DEUX entrées, toutes deux hors vitrine (le compte client, le tunnel de paiement) — et
// l'objectif que la spec 30 s'était fixé (« quatre à deux ») est atteint.

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/establecimientos/[slug]">, "searchParams">
): Promise<Metadata> {
  const { locale, slug } = await props.params;
  const ficha = await getEstablecimientoPorSlug(slug, { locale });
  if (!ficha) return {};

  return buildPageMetadata({
    locale,
    pathFor: (candidate) => `/${candidate}/establecimientos/${ficha.slug}`,
    title: ficha.nombre,
    description: ficha.descripcion ?? undefined,
    nativeLocales: ficha.localesNativas,
  });
}

export default async function EstablecimientoPage({
  params,
}: PageProps<"/[locale]/establecimientos/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const ficha = await getEstablecimientoPorSlug(slug, { locale });
  if (!ficha) notFound();

  const tCommon = await getTranslations("Common");
  const tHome = await getTranslations("HomePage");
  const t = await getTranslations("EstablishmentPage");

  const rutaCanonica = `/establecimientos/${ficha.slug}`;

  // Le fil suit le parcours réel : on arrive sur un établissement depuis le listing des
  // hébergements. Trois niveaux — c'est l'écran qui EST le niveau intermédiaire d'une fiche de
  // chambre (spec 30 §3.10).
  // ⚠️ `segmentoDeTipo` et pas « /alojamientos » en dur : c'est le MÊME maillon que celui de la
  // fiche produit (`productos/[slug]/page.tsx:76`), qui lui passe déjà par la table. `segmentos.ts`
  // se déclare « SEULE source de vérité » du couple type ↔ segment d'URL — un segment renommé là-bas
  // aurait laissé cette fiche pointer vers un 404, et seule l'autre fiche aurait suivi.
  const migas: MigaItem[] = [
    { nombre: tCommon("breadcrumbHome"), href: "/" },
    { nombre: tHome("secciones.lodging"), href: `/${segmentoDeTipo("lodging")}` },
    { nombre: ficha.nombre },
  ];

  // Plan 41, P4 : le gabarit des pages intérieures (`pagina`, la colonne de l'accueil). La fiche
  // s'ouvre sur son bandeau or à fond perdu, que `FichaEstablecimiento` rend en premier enfant du
  // `<main>`.
  return (
    <PageShell variant="pagina">
      <JsonLd
        data={buildEstablishmentJsonLd({
          siteUrl: getSiteUrl(),
          locale,
          slug: ficha.slug,
          name: ficha.nombre,
          description: ficha.descripcion,
          imageUrls: ficha.fotos.map((foto) => foto.url),
          address: ficha.direccion,
          latitude: ficha.lat,
          longitude: ficha.lon,
          mode: ficha.modo,
          // ⚠️ Les horaires DU LIEU. Un `checkinTime` emprunté à un produit déclarerait aux moteurs
          // un horaire que la page n'affiche pas (règle SEO 6).
          checkInTime: ficha.horaEntrada,
          checkOutTime: ficha.horaSalida,
        })}
      />

      {/* Construit depuis LA MÊME liste que le fil visible. Cette page déclarait jusqu'ici un
          `BreadcrumbList` de deux entrées sans afficher le moindre fil. */}
      <JsonLd data={buildBreadcrumbJsonLd(getSiteUrl(), migasParaJsonLd(migas, locale, rutaCanonica))} />

      {/* Le fil visible part dans le bandeau de la fiche, déjà rendu : c'est toujours la liste
          `migas` du JSON-LD ci-dessus. */}
      <FichaEstablecimiento
        ficha={ficha}
        locale={locale as Locale}
        migas={<Migas items={migas} etiqueta={t("migasEtiqueta")} locale={locale as Locale} testId="migas" />}
      />
    </PageShell>
  );
}
