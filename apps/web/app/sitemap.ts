import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { buscarCategorias } from "@/lib/catalog/buscar";
import { leerCriterios } from "@/lib/catalog/criterios";
import { segmentoDeTipo } from "@/lib/catalog/segmentos";
import { ORDEN_SECCIONES } from "@/lib/catalog/tipos";
import { hasNativeContent } from "@/lib/seo/nativeContent";
import { getSiteUrl } from "@/lib/seo/siteUrl";
import { createPublicClient } from "@/lib/supabase/publicClient";

// ⚠️ OBLIGATOIRE, et ce n'est pas une optimisation. Les metadata routes sont compilées en un
// `GET()` PRÉRENDU AU BUILD (next-metadata-route-loader, `initialRevalidateSeconds: false`) :
// sans cette directive le sitemap serait figé au moment du build — l'inverse exact du « sitemap
// dynamique » de hifago/CLAUDE.md §5.5. `revalidate` ne suffirait pas : le premier rendu se
// ferait quand même au build, et un sitemap faux serait servi jusqu'à la première revalidation.
//
// ⚠️ postgrest-js ne LÈVE pas sur une erreur réseau : il rend `{ data: null, error }`. Une lecture
// en échec lève donc ICI, explicitement — la route répond 500 et le moteur réessaie. Un sitemap
// réduit serait indiscernable d'un catalogue réduit (décision du 2026-10-01, qui remplace la
// « réduction à l'accueil » de la spec 26 §5). Le smoke test de bascule reste le filet de la
// production : `curl <site>/sitemap.xml | grep -c "<loc>"` (spec 26 §5.2).
export const dynamic = "force-dynamic";

/** Ce que le sitemap a besoin de savoir d'une entité publiable. */
type PublishableRow = { slug: string; name: unknown; updated_at: string };

/**
 * Les entrées d'UNE page : une par locale native, toutes avec la même carte d'alternates. x-default
 * désigne l'espagnol dès qu'il est natif (§5.4) ; à défaut, la seule langue d'interface réellement
 * servie — jamais une URL qu'on vient de déclarer non indexable. Aucune locale native : aucune entrée.
 */
function entriesFor(
  nativeLocales: readonly string[],
  pathFor: (locale: string) => string,
  siteUrl: string,
  lastModified?: string
): MetadataRoute.Sitemap {
  if (nativeLocales.length === 0) return [];

  const xDefault = nativeLocales.includes(routing.defaultLocale)
    ? routing.defaultLocale
    : nativeLocales[0];

  const languages: Record<string, string> = {};
  for (const locale of nativeLocales) {
    languages[locale] = `${siteUrl}${pathFor(locale)}`;
  }
  languages["x-default"] = `${siteUrl}${pathFor(xDefault)}`;

  return nativeLocales.map((locale) => ({
    url: `${siteUrl}${pathFor(locale)}`,
    ...(lastModified ? { lastModified } : {}),
    alternates: { languages },
  }));
}

/**
 * Une entrée PAR LOCALE disposant d'un contenu réellement traduit, et non une seule entrée
 * espagnole portant ses alternates.
 *
 * Deux raisons, toutes deux constatées :
 *  - ne lister que `/es/…` priverait les URL `/en/…` de `<loc>` propre, motif classique de
 *    « hreflang : pas de balise de retour » en Search Console ;
 *  - un produit dont le `name` n'existe qu'en `en` a une page `/es` en `noindex` (§5.3) et une
 *    page `/en` parfaitement indexable : une entrée unique « es + alternates » la perdrait.
 *
 * Et jamais d'URL non indexable : le sitemap applique le MÊME prédicat que les
 * `generateMetadata`, sans quoi il listerait des pages que les métadonnées déclarent `noindex`.
 */
function localizedEntries(
  rows: PublishableRow[],
  pathFor: (locale: string, slug: string) => string,
  siteUrl: string
): MetadataRoute.Sitemap {
  return rows.flatMap((row) =>
    entriesFor(
      routing.locales.filter((locale) => hasNativeContent(row.name, locale)),
      (locale) => pathFor(locale, row.slug),
      siteUrl,
      row.updated_at
    )
  );
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const supabase = createPublicClient();

  // RLS anon, jamais le service_role : `products_select_public` (sellable) et
  // `establishments_select_public` (status actif + au moins un produit vendable) font déjà le
  // filtrage — les `.eq()` ci-dessous ne font que le rendre explicite et lisible.
  // Colonnes vérifiées accordées à `anon` sur les deux tables (migrations 20260819110000 et
  // 20260827200000) : une colonne non accordée ferait échouer TOUTE la requête (§11.1).
  //
  // Catégories (spec 29 §8.3) : `buscarCategorias`, la lecture des pages de catégorie elles-mêmes,
  // sans critère et à une carte par catégorie — elle ne rend que les catégories qui ont au moins
  // une offre (une page vide n'existe pas), et `localesNativas` est le prédicat que leurs
  // métadonnées appliquent déjà : jamais recalculé ici. La locale de l'appel ne joue que sur les
  // libellés et le tri, jamais sur `localesNativas`.
  const sinCriterios = leerCriterios({});
  const [products, establishments, ...categoriasPorTipo] = await Promise.all([
    supabase.from("products").select("slug, name, updated_at").eq("sellable", true),
    supabase.from("establishments").select("slug, name, updated_at").eq("status", "active"),
    ...ORDEN_SECCIONES.map((tipo) =>
      buscarCategorias(tipo, sinCriterios, { porCategoria: 1, locale: routing.defaultLocale })
    ),
  ]);

  if (products.error) throw products.error;
  if (establishments.error) throw establishments.error;

  // L'accueil et les cinq listings sont servis dans les deux locales : ce sont des libellés
  // d'INTERFACE (next-intl, jeu fermé et complet), pas du contenu partenaire soumis au repli JSONB.
  const home = entriesFor(routing.locales, (locale) => `/${locale}`, siteUrl);
  const listings = ORDEN_SECCIONES.flatMap((tipo) =>
    entriesFor(routing.locales, (locale) => `/${locale}/${segmentoDeTipo(tipo)}`, siteUrl)
  );
  const categorias = ORDEN_SECCIONES.flatMap((tipo, indice) =>
    categoriasPorTipo[indice].flatMap((categoria) =>
      entriesFor(
        categoria.localesNativas,
        (locale) => `/${locale}/${segmentoDeTipo(tipo)}/${categoria.slug}`,
        siteUrl
      )
    )
  );

  return [
    ...home,
    ...listings,
    ...localizedEntries(
      (products.data ?? []) as PublishableRow[],
      (locale, slug) => `/${locale}/productos/${slug}`,
      siteUrl
    ),
    ...localizedEntries(
      (establishments.data ?? []) as PublishableRow[],
      (locale, slug) => `/${locale}/establecimientos/${slug}`,
      siteUrl
    ),
    ...categorias,
  ];
}
