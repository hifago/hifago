import { parseISO } from "date-fns";
import { getTranslations } from "next-intl/server";
import { todayInBogota } from "@hifago/domain";
import { JsonLd } from "@/components/seo/JsonLd";
import { PageShell } from "@/components/atoms/PageShell";
import { Title } from "@/components/atoms/Title";
import { Migas } from "@/components/molecules/Migas";
import { EstadoVacio } from "@/components/molecules/EstadoVacio";
import { SeccionOfertas } from "@/components/organisms/SeccionOfertas";
import { buscarCategorias, hrefCategoria } from "@/lib/catalog/buscar";
import {
  escribirCriterios,
  hayCriterios,
  leerAlojamientoParaCamp,
  leerAlojamientoParaEvento,
  leerCriterios,
  type ParamsBrutos,
} from "@/lib/catalog/criterios";
import { segmentoDeTipo } from "@/lib/catalog/segmentos";
import type { TipoOferta } from "@/lib/catalog/tipos";
import { nightsInRange } from "@/lib/reservas/reservationRange";
import { buildBreadcrumbJsonLd } from "@/lib/seo/jsonld/breadcrumb";
import { migasConCriterios, migasParaJsonLd } from "@/lib/seo/migas";
import { getSiteUrl } from "@/lib/seo/siteUrl";
import type { Locale } from "@/messages";
import { BuscadorInicio } from "./BuscadorInicio";
import { labelsBuscador } from "./labelsBuscador";

// L'INDEX DE CATÉGORIES D'UN TYPE (généralisé 2026-09-14 — remplace, pour les cinq types, deux
// écrans distincts : les quatre listings plats (`ListadoTipo` sans `categoria`) et l'ancien index
// de tuiles vides `/actividades` (`IndiceCategorias`/`TarjetaCategoria`, désormais morts).
//
// ⚠️ POURQUOI UN FICHIER PARTAGÉ COLOCALISÉ, PAS UN COMPOSANT DE `components/`. Même raison que
// `ListadoTipo.tsx`, à côté duquel il vit : il appelle `lib/catalog/` (réservé au serveur) et
// traduit — un `page.tsx` n'importe donc AUCUNE requête ici non plus (`scripts/check-data-layer.sh`).
//
// ⚠️ CHAQUE CATÉGORIE EST UNE SECTION « COMME L'ACCUEIL » — littéralement le même composant,
// `SeccionOfertas` : un titre, une grille/liste de `POR_CATEGORIA` cartes, un « Ver más » qui ne
// se rend QUE si la catégorie a plus d'offres que celles montrées (`mostrarVerMas`). C'est la
// différence avec l'accueil, qui rend son « Ver más » inconditionnellement — une section de
// l'accueil a TOUJOURS plus d'offres du type qu'elle n'en montre, une catégorie pas forcément.
const POR_CATEGORIA = 6;

/**
 * Le fil d'Ariane et le titre partagent la même source que les listings (`ListadoTipo.tsx`).
 *
 * ⚠️ `verMas` vient de `HomePage`, PAS de `ListadoPage` : c'est le MÊME libellé que le « Ver más »
 * d'une section de l'accueil (`page.tsx`), pas un texte propre à cet écran — `ListadoPage.json` ne
 * porte que des libellés spécifiques au listing (état vide, pagination). Une seconde clé au même
 * texte aurait divergé à la première retouche.
 */
async function libelles(tipo: TipoOferta, locale: Locale) {
  const tHome = await getTranslations({ locale, namespace: "HomePage" });
  const tCommon = await getTranslations({ locale, namespace: "Common" });
  return {
    seccion: tHome(`secciones.${tipo}`),
    // ⚠️ `masPorTipo` et non `verMas` depuis le 2026-10-01 : le bouton du carrusel nomme le type.
    // Il est nommé par le TYPE de la page et non par la catégorie de la section — « Más
    // actividades » sous la catégorie « Agua » — parce que c'est bien vers plus d'activités que le
    // lien mène, et qu'un « Más agua » ne se dit pas. Même clé que l'accueil, jamais une seconde au
    // même texte : elles divergeraient à la première retouche.
    masDelTipo: tHome(`masPorTipo.${tipo}`),
    inicio: tCommon("breadcrumbHome"),
  };
}

export async function IndiceCategoriasConOfertas({
  tipo,
  locale,
  searchParams,
}: {
  tipo: TipoOferta;
  locale: Locale;
  searchParams: ParamsBrutos;
}) {
  const t = await getTranslations({ locale, namespace: "ListadoPage" });
  const { seccion, masDelTipo, inicio } = await libelles(tipo, locale);

  const criterios = leerCriterios(searchParams);
  const sufijoCriterios = escribirCriterios(criterios);

  // Retour Jérôme (2026-09-15) : un visiteur qui atterrit ici juste après avoir choisi un camp
  // n'a sinon aucune indication de pourquoi il y est. Bandeau purement informatif — complémentaire
  // du bloc bloquant de `/mi-viaje` (`findCampMissingLodging`), jamais un remplacement. Scopé à
  // `lodging` : le drapeau ne doit rien afficher sur les quatre autres types, qui ne peuvent pas
  // être atteints par ce chemin (`hrefAlojamientosCompatibles` ne cible que `/alojamientos`).
  const alojamientoParaCamp =
    tipo === "lodging" &&
    leerAlojamientoParaCamp(searchParams) &&
    Boolean(criterios.desde && criterios.hasta);
  const nochesCamp = alojamientoParaCamp
    ? nightsInRange({ from: parseISO(criterios.desde!), to: parseISO(criterios.hasta!) }).length
    : 0;

  // Même raisonnement, pour un evento (2026-09-16) — jamais pluralisé : `hrefAlojamientosParaEvento`
  // ne pose jamais qu'une seule nuit (cf. son commentaire), donc rien à compter ici.
  const alojamientoParaEvento =
    tipo === "lodging" &&
    leerAlojamientoParaEvento(searchParams) &&
    Boolean(criterios.desde && criterios.hasta);

  // Un seul bandeau rendu, la précédence exprimée UNE fois (le camp l'emporte) — le balisage était
  // recopié à l'identique pour les deux cas, seuls le testId et la clé de message changeaient.
  const avisoAlojamiento = alojamientoParaCamp
    ? { testId: "camp-lodging-hint", texto: t("campLodgingHint", { count: nochesCamp }) }
    : alojamientoParaEvento
      ? { testId: "event-lodging-hint", texto: t("eventLodgingHint") }
      : null;

  // LA seule requête de la page, et elle ne part pas d'ici : `lib/catalog/` la porte. Elle rend
  // les catégories DÉJÀ triées (`Intl.Collator` de la locale), chacune avec ses offres plafonnées
  // à `POR_CATEGORIA`, et la catégorie de rattrapage toujours en dernier.
  const categorias = await buscarCategorias(tipo, criterios, { porCategoria: POR_CATEGORIA, locale });

  const migas = [{ nombre: inicio, href: "/" }, { nombre: seccion }];

  // `migasConCriterios` et pas un `map` local : même helper que `ListadoTipo.tsx`, le raisonnement
  // (pourquoi le JSON-LD garde `migas` nu) y vit une seule fois.
  const migasVisibles = migasConCriterios(migas, sufijoCriterios);

  const labels = await labelsBuscador(locale);

  return (
    <PageShell variant="large">
      {/* Règle SEO 6 : le JSON-LD est rendu côté serveur par la route, jamais par `Migas`. */}
      <JsonLd
        data={buildBreadcrumbJsonLd(
          getSiteUrl(),
          migasParaJsonLd(migas, locale, `/${segmentoDeTipo(tipo)}`)
        )}
      />

      <Migas items={migasVisibles} etiqueta={t("migasEtiqueta")} locale={locale} testId="migas" />

      {/* VISIBLE, contrairement au `<h1>` masqué de l'accueil (décision 5, spec 29) : un titre
          masqué laisserait le visiteur deviner où il a atterri. */}
      <Title as="h1">{seccion}</Title>

      {/* ⚠️ `atajosTipo={[]}` : la page ne connaît qu'un type et n'a compté aucun autre. Ce
          composant navigue vers `/`, pas vers la page courante — décision 10, le site n'a qu'UN
          écran de résultats. */}
      <BuscadorInicio
        criteriosIniciales={criterios}
        aujourdIso={todayInBogota()}
        localeCodigo={locale}
        labels={labels}
        atajosTipo={[]}
      />

      {avisoAlojamiento ? (
        // Même habillage que le bloc bloquant de `/mi-viaje` (`lodging-required-notice`) — un
        // visiteur doit reconnaître le même message aux deux endroits, pas une simple phrase grise
        // noyée sous la barre de recherche (retour Jérôme : « il faut que ce soit plus visible »).
        // Côté evento, aucun bloc bloquant équivalent sur `/mi-viaje` (jamais décidé) : informatif.
        <div
          className="rounded-lg border border-border bg-surface-secondary p-4 text-sm"
          data-testid={avisoAlojamiento.testId}
        >
          {avisoAlojamiento.texto}
        </div>
      ) : null}

      {categorias.length === 0 ? (
        // Deux états vides distincts : « ta recherche ne donne rien » n'est pas « il n'y a pas
        // encore d'offres ». Le second n'invite pas à changer des critères qui n'existent pas.
        <EstadoVacio
          titulo={hayCriterios(criterios) ? t("emptyState.titulo") : t("sinOfertas.titulo")}
          descripcion={
            hayCriterios(criterios) ? t("emptyState.descripcion") : t("sinOfertas.descripcion")
          }
          testId="estado-vacio"
        />
      ) : (
        categorias.map((categoria, indice) => (
          <SeccionOfertas
            key={categoria.slug}
            titulo={categoria.nombre}
            tituloAs="h2"
            hrefVerMas={hrefCategoria(tipo, categoria.slug, sufijoCriterios)}
            labelVerMas={masDelTipo}
            // ⚠️ Toutes les catégories dans la même carte (photo pleine largeur, 2026-09-14, retour
            // explicite de Jérôme) — cf. `page.tsx` pour le raisonnement complet : les activités
            // utilisaient `variante="lista"` par choix esthétique de Jérôme (spec 28 §5), jamais une
            // contrainte fonctionnelle, avec un défaut visuel non résolu (spec 28 §10bis). Cohérent
            // avec toutes les autres catégories.
            //
            // `variante="carrusel"` (et non plus "grilla") : même changement que `page.tsx` — ligne
            // scrollable horizontalement plutôt qu'une grille empilée sur mobile.
            variante="carrusel"
            tarjetas={categoria.tarjetas}
            locale={locale}
            prioridad={indice === 0}
            mostrarVerMas={categoria.total > categoria.tarjetas.length}
            testId={`categoria-${categoria.slug}`}
          />
        ))
      )}
    </PageShell>
  );
}
