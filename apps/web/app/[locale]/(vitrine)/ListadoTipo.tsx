import { cache } from "react";
import type { Metadata } from "next";
import NextImage from "next/image";
import { getTranslations } from "next-intl/server";
import { todayInBogota } from "@hifago/domain";
import { JsonLd } from "@/components/seo/JsonLd";
import { LinkButton } from "@/components/atoms/LinkButton";
import { PageShell } from "@/components/atoms/PageShell";
import { Migas } from "@/components/molecules/Migas";
import { EstadoVacio } from "@/components/molecules/EstadoVacio";
import { BandeauPagina } from "@/components/organisms/BandeauPagina";
import { ListadoInfinito } from "@/components/organisms/ListadoInfinito";
import { SLUG_SIN_TAG, buscarCategorias, buscarTipo } from "@/lib/catalog/buscar";
import {
  TAMANO_PAGINA,
  escribirCriterios,
  hayCriterios,
  leerCriterios,
  leerPagina,
  type ParamsBrutos,
} from "@/lib/catalog/criterios";
import { segmentoDeTipo } from "@/lib/catalog/segmentos";
import type { FotoTarjeta, TipoOferta } from "@/lib/catalog/tipos";
import { buildBreadcrumbJsonLd } from "@/lib/seo/jsonld/breadcrumb";
import { migasConCriterios, migasParaJsonLd } from "@/lib/seo/migas";
import { buildPageMetadata } from "@/lib/seo/pageMetadata";
import { getSiteUrl } from "@/lib/seo/siteUrl";
import type { Locale } from "@/messages";
import { BuscadorInicio } from "./BuscadorInicio";
import { labelsBuscador } from "./labelsBuscador";

// LE CORPS DES QUATRE PAGES DE LISTING (2026-09-08, spec 29 §5c/§5d).
//
// ⚠️ POURQUOI UN FICHIER PARTAGÉ PLUTÔT QUE QUATRE PAGES. `/alojamientos`, `/transportes`,
// `/camps` et `/eventos` ne diffèrent que par UNE valeur : le type. Écrire quatre fois le même
// écran mettrait la taille de page, le fil d'Ariane, le choix de l'état vide et la construction de
// l'URL du pont à quatre endroits — et la première divergence ne casserait aucun test, elle
// rendrait juste une des quatre pages subtilement différente des autres.
//
// Il n'est PAS dans `components/` : il appelle `lib/catalog/` (réservé au serveur), il traduit, et
// il pose le JSON-LD. C'est un morceau de route, colocalisé dans son groupe — même statut que
// `BuscadorInicio`, à côté duquel il vit.
//
// ⚠️ `page.tsx` n'appelle donc AUCUNE requête et n'importe rien de `@hifago/ui` : les deux règles
// vérifiées par `scripts/check-data-layer.sh` sont tenues par construction pour les quatre routes.

/** Le fil d'Ariane et le titre partagent la même source — jamais deux libellés parallèles. */
async function libelles(tipo: TipoOferta, locale: Locale) {
  const tHome = await getTranslations({ locale, namespace: "HomePage" });
  const tCommon = await getTranslations({ locale, namespace: "Common" });
  // ⚠️ La MÊME clé que la section correspondante de l'accueil. Un second jeu de titres divergerait
  // à la première retouche, et le visiteur lirait « Alojamientos » sur l'accueil et autre chose en
  // arrivant sur la page que ce lien annonce.
  return {
    seccion: tHome(`secciones.${tipo}`),
    inicio: tCommon("breadcrumbHome"),
  };
}

/**
 * Ce qu'il faut savoir d'une catégorie pour rendre SA page (spec 29 §5b, généralisée à tout type
 * le 2026-09-14).
 *
 * ⚠️ `esSinTag` change la REQUÊTE, pas seulement l'affichage : la catégorie de rattrapage ne
 * filtre pas sur un tag, elle demande les offres qui n'en portent AUCUN (`p_sin_tag` de
 * `search_catalog`).
 */
export type CategoriaDeListado = {
  slug: string;
  /** Déjà résolu : le nom de la catégorie, ou celui de `messages/` pour la catégorie de rattrapage. */
  nombre: string;
  /** Déjà résolu, `null` si la catégorie n'est pas rédigée. */
  descripcion: string | null;
  /**
   * L'image saisie dans l'admin (`catalog_tags.image_path`), `null` sans image et pour la catégorie
   * de rattrapage. Décor du bandeau (plan 41, D16) : elle ne s'affichait nulle part avant P2.
   */
  foto: FotoTarjeta | null;
  esSinTag: boolean;
  /** cf. `CategoriaConTarjetas.localesNativas` — portée jusqu'ici pour `metadataCategoria`. */
  localesNativas: string[];
};

/**
 * Résout un segment d'URL en catégorie affichable, `null` si la page ne doit pas exister —
 * catégorie inconnue, ou qui ne porte plus aucune offre (spec 29 §5b, décisions 1/2).
 *
 * ⚠️ SANS CRITÈRES, à dessein : « cette catégorie existe-t-elle ? » ne dépend pas de la recherche
 * en cours — une catégorie vivante dont aucune offre ne correspond aux critères doit rendre 200 et
 * un état vide, jamais 404. `cache()` déduplique entre `generateMetadata` et la page (même motif
 * que les deux fiches, `productos/[slug]`/`establecimientos/[slug]`).
 */
const getCategorias = cache(async (tipo: TipoOferta, locale: string) =>
  buscarCategorias(tipo, {}, { porCategoria: 1, locale })
);

export async function resolverCategoria(
  tipo: TipoOferta,
  slug: string,
  locale: Locale
): Promise<CategoriaDeListado | null> {
  const categorias = await getCategorias(tipo, locale);
  const encontrada = categorias.find((c) => c.slug === slug);
  if (!encontrada) return null;

  if (encontrada.esSinTag) {
    // Ses libellés viennent de next-intl, jamais de la base : ce n'est pas une ligne de
    // `catalog_tags`. `buscarCategorias` les laisse vides à dessein (elle ne traduit rien).
    const t = await getTranslations({ locale, namespace: "ListadoPage" });
    return {
      slug: SLUG_SIN_TAG,
      nombre: t(`sinTag.${tipo}.nombre`),
      descripcion: t(`sinTag.${tipo}.descripcion`),
      foto: null,
      esSinTag: true,
      localesNativas: encontrada.localesNativas,
    };
  }

  return {
    slug: encontrada.slug,
    nombre: encontrada.nombre,
    descripcion: encontrada.descripcion,
    foto: encontrada.foto,
    esSinTag: false,
    localesNativas: encontrada.localesNativas,
  };
}

/** Les métadonnées d'une page de listing — appelée par le `generateMetadata` de chaque route. */
export async function metadataListado(tipo: TipoOferta, locale: Locale): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "ListadoPage" });
  const { seccion } = await libelles(tipo, locale);

  // Pas de `nativeLocales` : ces textes viennent de next-intl (jeu d'interface fermé et complet
  // dans les deux locales), pas du contenu partenaire soumis au repli JSONB.
  //
  // ⚠️ `pathFor` ne reçoit AUCUN paramètre — le canonical ignore donc `?q=`, `?personas=` et
  // surtout `?pagina=` (spec 29 §0, invariant 4). Sans ça, chaque profondeur de défilement
  // fabriquerait une URL indexable distincte de la même page.
  return buildPageMetadata({
    locale,
    pathFor: (candidate) => `/${candidate}/${segmentoDeTipo(tipo)}`,
    title: t("meta.title", { seccion }),
    description: t("meta.description", { seccion: seccion.toLowerCase() }),
  });
}

/**
 * Les métadonnées d'une page de CATÉGORIE, pour tout type (généralisée 2026-09-14 — `pathFor`
 * était câblé en dur sur `/actividades/`, bug latent invisible tant qu'une seule route l'appelait).
 *
 * ⚠️ `nativeLocales` n'est PAS laissé au défaut ici, contrairement aux listings : le nom et le texte
 * d'une catégorie sont du CONTENU PARTENAIRE (JSONB), pas de l'interface. Une page servie en repli
 * — nom espagnol sous une URL `/en/` — doit rester `noindex` avec un canonical vers la langue
 * source (règle SEO 2), sinon Google indexe deux URL portant le même texte espagnol.
 *
 * L'exception est la catégorie de rattrapage, dont les libellés viennent de next-intl : elle est
 * native dans les deux locales, comme n'importe quel écran d'interface — `resolverCategoria` le
 * reflète déjà dans `categoria.localesNativas`.
 */
export async function metadataCategoria(
  categoria: CategoriaDeListado,
  tipo: TipoOferta,
  locale: Locale
): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "ListadoPage" });
  return buildPageMetadata({
    locale,
    pathFor: (candidate) => `/${candidate}/${segmentoDeTipo(tipo)}/${categoria.slug}`,
    title: t("meta.title", { seccion: categoria.nombre }),
    description: categoria.descripcion ?? t("meta.description", { seccion: categoria.nombre }),
    nativeLocales: categoria.localesNativas,
  });
}

export async function ListadoTipo({
  tipo,
  locale,
  searchParams,
  categoria,
}: {
  tipo: TipoOferta;
  locale: Locale;
  searchParams: ParamsBrutos;
  /** Présente uniquement sur `/actividades/[tag]` — les quatre listings n'en ont pas. */
  categoria?: CategoriaDeListado;
}) {
  const t = await getTranslations({ locale, namespace: "ListadoPage" });
  const { seccion, inicio } = await libelles(tipo, locale);

  // ⚠️ `tipo` de l'URL est IGNORÉ (spec 29 §0) : le type vient du segment, qui fait foi. Un
  // `/es/camps?tipo=lodging` liste des camps — l'adresse dit ce que la page montre.
  //
  // ⚠️ `delete` plutôt qu'un `tipo: undefined` : `hayCriterios` compte les CLÉS présentes, et une
  // clé posée à `undefined` compte pour un filtre. La page choisirait alors « ta recherche ne
  // donne rien » là où il faut « cette section est encore vide » — sur une route où personne n'a
  // rien cherché.
  const criterios = { ...leerCriterios(searchParams) };
  delete criterios.tipo;
  const pagina = leerPagina(searchParams);

  // ⚠️ LA seule requête de la page, et elle ne part pas d'un fichier de route.
  //
  // Ouvrir `?pagina=3` rend les TROIS pages d'un coup, pas la seule troisième tranche : le cas
  // d'usage de ce paramètre est le retour depuis une fiche, et une liste tronquée par le haut
  // n'aurait aucun sens. `leerPagina` a déjà plafonné — c'est ce qui empêche cette multiplication
  // de devenir un vecteur de charge.
  // ⚠️ Sur une page de catégorie, le filtre vient du SEGMENT, jamais d'un `?tag=` : c'est l'adresse
  // qui décide de ce que la page montre. Un `?tag=buceo` sur `/actividades/kayak` est donc écrasé,
  // exactement comme `?tipo=` l'est sur un listing.
  const criteriosDeConsulta = categoria?.esSinTag
    ? { ...criterios, tag: undefined }
    : categoria
      ? { ...criterios, tag: categoria.slug }
      : criterios;

  const { tarjetas, total, hayMas } = await buscarTipo(tipo, criteriosDeConsulta, {
    limite: pagina * TAMANO_PAGINA,
    desplazamiento: 0,
    locale,
    sinTag: categoria?.esSinTag,
  });

  const segmento = segmentoDeTipo(tipo);

  // Deux ou trois niveaux selon l'écran, et le titre de la page est TOUJOURS le dernier — c'est ce
  // qui garantit que le fil et le `<h1>` ne peuvent pas se contredire : ils sortent d'ici tous les
  // deux (décision 13).
  const titulo = categoria ? categoria.nombre : seccion;
  const migas = categoria
    ? [
        { nombre: inicio, href: "/" },
        { nombre: seccion, href: `/${segmento}` },
        { nombre: titulo },
      ]
    : [{ nombre: inicio, href: "/" }, { nombre: titulo }];
  const rutaCanonica = categoria ? `/${segmento}/${categoria.slug}` : `/${segmento}`;

  // `migasConCriterios` et pas un `map` local : le raisonnement (pourquoi le JSON-LD garde `migas`
  // nu) vit dans le helper, à côté de `migasParaJsonLd`, jamais recopié écran par écran.
  const sufijoCriterios = escribirCriterios(criterios);
  const migasVisibles = migasConCriterios(migas, sufijoCriterios);

  const labels = await labelsBuscador(locale as Locale);

  // L'URL du pont, critères compris et SANS `pagina` : `ListadoInfinito` y ajoute la sienne.
  //
  // ⚠️ Les critères sont sérialisés par `escribirCriterios`, et pas par six `if` écrits ici : c'est
  // l'ÉCRIVAIN symétrique du `leerCriterios` que le pont utilise pour les relire
  // (`api/catalogo/listado/route.ts`), et `criterios.ts` s'annonce en tête comme le seul endroit
  // qui connaît le nom des paramètres, leur format et leur normalisation. La copie qui vivait ici
  // avait déjà perdu une de ces règles — la garde `personas >= 1` — sans qu'aucun test ne rougisse.
  //
  // Les trois paramètres restants ne sont PAS des critères : ils décrivent quelle page appelle le
  // pont, et n'ont donc rien à faire dans l'URL publique que `escribirCriterios` construit.
  const parametros = new URLSearchParams(escribirCriterios(criteriosDeConsulta).slice(1));
  parametros.set("tipo", tipo);
  parametros.set("locale", locale);
  if (categoria?.esSinTag) parametros.set("sinTag", "1");

  return (
    // LA PAGE OR ENTIÈRE, comme l'index par type (plan 41, P2 ; arbitrage D1 = A : on parcourt sur
    // l'or). `pagina` : la colonne de l'accueil (F7, 960 px) ; `acento` : la surface or, header
    // compris.
    <PageShell variant="pagina" fondo="acento">
      {/* ⚠️ Le JSON-LD est rendu ICI, côté serveur, et jamais dans `Migas` : règle SEO 6 du dépôt —
          le composant affiche, la route décrit. Les deux sortent de la MÊME liste `migas` — jamais
          recalculés séparément, ce qui garantit qu'ils ne peuvent pas diverger en STRUCTURE (chemin,
          libellé, ordre). `migasVisibles`, juste au-dessus, n'en est qu'une décoration dérivée (voir
          son commentaire) : `migas` reste la seule source, `migasVisibles` ne fait qu'y ajouter un
          suffixe de critères avant affichage. */}
      <JsonLd
        // ⚠️ `migasParaJsonLd` et pas un `map` local : ces quatre lignes étaient recopiées ici, et
        // c'est cette copie même que l'extraction du 2026-09-08 devait supprimer — elle y avait
        // survécu. Le dernier élément n'a pas de `href` (c'est la page courante) ; le helper lui
        // donne la route canonique, celle-là même que `generateMetadata` déclare.
        data={buildBreadcrumbJsonLd(getSiteUrl(), migasParaJsonLd(migas, locale, rutaCanonica))}
      />

      {/* Le bandeau (S2), variante `navegacion` : la page est déjà or, il n'a pas de fond propre.
          Il porte le SEUL `<h1>`, à point, VISIBLE, contrairement à l'ancien `<h1>` masqué de
          l'accueil (décision 5) : la règle « rien au-dessus du bloc de recherche » du cahier §2a ne
          valait que pour l'accueil. Sur une page de listing, un titre masqué laisserait le visiteur
          deviner où il a atterri. */}
      <BandeauPagina
        variante="navegacion"
        migas={<Migas items={migasVisibles} etiqueta={t("migasEtiqueta")} locale={locale} testId="migas" />}
        titulo={titulo}
        // ⚠️ Le texte de la catégorie est le SEUL contenu rédactionnel indexable de cette page
        // (décision 7) : sans lui elle n'aurait que des cartes, comme des milliers d'autres. Il est
        // le chapô du bandeau, et garde le `data-testid` que lit `e2e/categorias.spec.ts`. Absent
        // d'une catégorie non encore rédigée : le titre se suffit, aucun bloc vide ne s'ouvre.
        chapo={categoria?.descripcion ?? undefined}
        chapoTestId="categoria-descripcion"
        // L'image de la catégorie (D16), saisie dans l'admin et affichée nulle part jusqu'ici : un
        // décor à droite à partir de `lg` (`alt=""`, le bandeau la masque dessous), carré et
        // arrondi comme une tuile. Sans image, rien : aucun emplacement vide.
        imagen={
          categoria?.foto ? (
            <div className="relative size-40 overflow-hidden rounded-[16px] bg-[var(--default)]">
              <NextImage src={categoria.foto.url} alt="" fill sizes="160px" className="object-cover" />
            </div>
          ) : undefined
        }
        accion={
          // ⚠️ `atajosTipo={[]}` : les raccourcis de type n'ont aucun sens ici — la page ne connaît
          // qu'un type et n'a pas compté les autres. Un raccourci vers une section qu'elle n'a pas
          // mesurée mènerait peut-être à une page vide, ce que la Tranche 2 de la spec 28 s'était
          // justement interdit.
          // ⚠️ Et ce composant navigue vers `/`, pas vers la page courante : c'est la décision 10 —
          // le site n'a qu'UN écran de résultats.
          <BuscadorInicio
            criteriosIniciales={criterios}
            aujourdIso={todayInBogota()}
            localeCodigo={locale}
            labels={labels}
            atajosTipo={[]}
          />
        }
      />

      {tarjetas.length === 0 ? (
        // Deux états vides distincts, et la différence compte pour le visiteur : « ta recherche ne
        // donne rien » n'est pas « cette section est encore vide ». Le second n'invite pas à
        // changer des critères qui n'existent pas.
        //
        // L'action (S8) remonte d'un niveau, vers l'index du type, critères conservés comme dans le
        // fil d'Ariane : elle élargit la recherche à toutes les catégories, ce que la barre
        // au-dessus ne fait pas. Bouton `marine` : un bouton or disparaîtrait sur l'or (F4).
        <EstadoVacio
          titulo={hayCriterios(criterios) ? t("emptyState.titulo") : t("sinOfertas.titulo")}
          descripcion={
            hayCriterios(criterios) ? t("emptyState.descripcion") : t("sinOfertas.descripcion")
          }
          accion={
            <LinkButton href={`/${segmento}${sufijoCriterios}`} color="marine" testId="estado-vacio-ver-tipo">
              {t(`verTipo.${tipo}`)}
            </LinkButton>
          }
          testId="estado-vacio"
        />
      ) : (
        <ListadoInfinito
          tarjetasIniciales={tarjetas}
          total={total}
          hayMasInicial={hayMas}
          paginaInicial={pagina}
          endpointBase={`/api/catalogo/listado?${parametros.toString()}`}
          locale={locale}
        />
      )}
    </PageShell>
  );
}
