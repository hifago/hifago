import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { formatOccurrenceLabel } from "@/lib/products/formatOccurrenceLabel";
import { getProductoPorSlug } from "@/lib/catalog/producto";
import { segmentoDeTipo } from "@/lib/catalog/segmentos";
import { PageShell } from "@/components/atoms/PageShell";
import { Migas, type MigaItem } from "@/components/molecules/Migas";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildPageMetadata } from "@/lib/seo/pageMetadata";
import { getSiteUrl } from "@/lib/seo/siteUrl";
import { buildProductJsonLd } from "@/lib/seo/jsonld/product";
import { buildBreadcrumbJsonLd } from "@/lib/seo/jsonld/breadcrumb";
import { migasParaJsonLd } from "@/lib/seo/migas";
import type { Locale } from "@/messages";
import { FichaProducto } from "./FichaProducto";

// LA FICHE D'UNE OFFRE (spec 30 §5a).
//
// ⚠️ Cette route N'APPELLE PLUS SUPABASE. Ses six requêtes vivent dans `lib/catalog/producto.ts`,
// et son entrée a été retirée de la liste d'exemptions de `scripts/check-data-layer.sh` — la liste
// dont l'en-tête dit qu'elle « doit RÉTRÉCIR à chaque lot ». Elle passe de quatre à trois ici, et
// à deux avec la fiche établissement.
//
// ⚠️ Elle n'importe rien de `@hifago/ui` non plus : le barrel tire app-nav-shell/lucide-react et
// fait planter `next build` depuis un Server Component (CLAUDE.md §11.16). Tout le rendu HeroUI
// vit dans `FichaProducto.tsx` ("use client").

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/productos/[slug]">, "searchParams">
): Promise<Metadata> {
  const { locale, slug } = await props.params;
  // Même appel que le rendu ci-dessous, mémoïsé par `cache` : une seule lecture par requête.
  const ficha = await getProductoPorSlug(slug, { locale });
  if (!ficha) return {};

  // Une fiche saisie sans traduction pour cette locale (repli JSONB, CLAUDE.md §5) reste noindex +
  // canonical vers la langue source, et ne s'annonce pas comme une version linguistique distincte.
  // Ces trois décisions se prennent ENSEMBLE, d'où `buildPageMetadata`, partagé avec l'accueil et
  // la fiche établissement.
  return buildPageMetadata({
    locale,
    pathFor: (candidate) => `/${candidate}/productos/${ficha.slug}`,
    title: ficha.nombre,
    description: ficha.descripcion ?? undefined,
    nativeLocales: ficha.localesNativas,
  });
}

export default async function ProductoPage({ params }: PageProps<"/[locale]/productos/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const ficha = await getProductoPorSlug(slug, { locale });
  if (!ficha) notFound();

  // Ces deux traducteurs restent CÔTÉ SERVEUR parce que leur résultat est une chaîne finie, passée
  // en prop : une fonction traducteur next-intl n'est pas sérialisable à travers la frontière
  // Server → Client Component.
  const tOccurrence = await getTranslations("ProductPage.occurrence");
  const tCommon = await getTranslations("Common");
  const tHome = await getTranslations("HomePage");
  const t = await getTranslations("ProductPage");

  const rutaCanonica = `/productos/${ficha.slug}`;

  // ⚠️ LE FIL SUIT LE PARCOURS RÉEL (spec 30 §3.10) : pour une chambre, on passe par le listing du
  // type PUIS par l'établissement, parce que c'est le chemin qu'on fait prendre au visiteur — et
  // parce que l'établissement est l'écran qui montre les AUTRES chambres du même lieu.
  //
  // ⚠️ Une activité ne porte PAS sa catégorie : un produit peut avoir plusieurs tags, en choisir
  // un arbitrairement rendrait le fil non déterministe et ferait déclarer aux moteurs un chemin
  // qui n'existe pas. Le niveau établissement, lui, est unique (§10.4).
  const migas: MigaItem[] = [
    { nombre: tCommon("breadcrumbHome"), href: "/" },
    { nombre: tHome(`secciones.${ficha.tipo}`), href: `/${segmentoDeTipo(ficha.tipo)}` },
    ...(ficha.tipo === "lodging" && ficha.establecimiento?.slug
      ? [
          {
            nombre: ficha.establecimiento.nombre,
            href: `/establecimientos/${ficha.establecimiento.slug}`,
          },
        ]
      : []),
    { nombre: ficha.nombre },
  ];

  const ocurrencia = ficha.ocurrencia
    ? formatOccurrenceLabel(
        {
          occurrenceType: ficha.ocurrencia.tipo,
          occurrenceDate: ficha.ocurrencia.fecha,
          recurrenceFrequencyDays: ficha.ocurrencia.frecuenciaDias,
          recurrenceEndDate: ficha.ocurrencia.finFecha,
          recurrenceEndCount: ficha.ocurrencia.finConteo,
        },
        locale,
        // Cast : le Translator scopé au namespace n'accepte que ses clés littérales, plus étroit
        // que `OccurrenceTranslator` (key: string) — même besoin et même justification que dans
        // `formatOccurrenceLabel.test.ts`.
        tOccurrence as unknown as (key: string, values?: Record<string, string | number>) => string
      )
    : null;

  // Plan 41, P3 : le gabarit des pages intérieures (`pagina`, la colonne de l'accueil). La fiche
  // s'ouvre sur son bandeau or à fond perdu, que `FichaProducto` rend en premier enfant du `<main>`.
  return (
    <PageShell variant="pagina">
      {/* Le JSON-LD est rendu ICI, côté serveur, jamais dans un composant : le composant affiche,
          la route décrit (règle SEO 6). */}
      <JsonLd
        data={buildProductJsonLd({
          siteUrl: getSiteUrl(),
          locale,
          slug: ficha.slug,
          name: ficha.nombre,
          description: ficha.descripcion,
          imageUrls: ficha.fotos.map((foto) => foto.url),
          productType: ficha.tipo,
          // ⚠️ Le prix STRUCTURÉ seulement : un `price_label` (« Consultar ») n'est pas un montant,
          // et l'annoncer comme tel à Google déclarerait une offre chiffrée qui n'existe pas.
          priceCop: ficha.precio?.tipo === "monto" ? ficha.precio.cop : null,
          occurrenceDate: ficha.ocurrencia?.fecha ?? null,
          startTime: ficha.ocurrencia?.hora ?? null,
          location: ficha.establecimiento
            ? { name: ficha.establecimiento.nombre, address: ficha.establecimiento.direccion }
            : null,
          reservableEnLinea: ficha.alojamiento?.reservableEnLinea ?? true,
        })}
      />

      {/* ⚠️ Construit depuis LA MÊME liste que le fil visible — c'est la seule façon de garantir
          qu'ils ne divergent pas, et c'est exactement ce que la règle SEO 6 exige. Jusqu'ici cette
          page déclarait un `BreadcrumbList` de deux entrées SANS afficher le moindre fil. */}
      <JsonLd data={buildBreadcrumbJsonLd(getSiteUrl(), migasParaJsonLd(migas, locale, rutaCanonica))} />

      {/* Le fil visible part dans le bandeau de la fiche, déjà rendu : c'est toujours la liste
          `migas` du JSON-LD ci-dessus. */}
      <FichaProducto
        ficha={ficha}
        etiquetas={{ ocurrencia }}
        locale={locale as Locale}
        migas={<Migas items={migas} etiqueta={t("migasEtiqueta")} locale={locale as Locale} testId="migas" />}
      />
    </PageShell>
  );
}
