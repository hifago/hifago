import { parseISO } from "date-fns";
import { getTranslations } from "next-intl/server";
import { todayInBogota } from "@hifago/domain";
import { JsonLd } from "@/components/seo/JsonLd";
import { PageShell } from "@/components/atoms/PageShell";
import { Aviso } from "@/components/molecules/Aviso";
import { Migas } from "@/components/molecules/Migas";
import { EstadoVacio } from "@/components/molecules/EstadoVacio";
import { BandeauPagina } from "@/components/organisms/BandeauPagina";
import { SeccionRiel } from "@/components/organisms/SeccionRiel";
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
// ⚠️ CHAQUE CATÉGORIE EST UN RAIL « COMME L'ACCUEIL » — littéralement le même composant,
// `SeccionRiel` (plan 41, P1, 2026-10-03 ; arbitrage D7 = A) : un titre à point, le motif, le
// conteneur marine et ses tuiles, un « GO → » qui ne se rend QUE si la catégorie a plus d'offres que
// celles montrées (`mostrarVerMas`). C'est la différence avec l'accueil, qui rend son « GO »
// inconditionnellement — une section de l'accueil a TOUJOURS plus d'offres du type qu'elle n'en
// montre, une catégorie pas forcément.
const POR_CATEGORIA = 6;

/** Le fil d'Ariane et le titre partagent la même source que les listings (`ListadoTipo.tsx`). */
async function libelles(tipo: TipoOferta, locale: Locale) {
  const tHome = await getTranslations({ locale, namespace: "HomePage" });
  const tCommon = await getTranslations({ locale, namespace: "Common" });
  return {
    seccion: tHome(`secciones.${tipo}`),
    inicio: tCommon("breadcrumbHome"),
    // Les libellés des tuiles : ceux de l'accueil et des cartes de listing (`TarjetaOferta`), jamais
    // une seconde clé au même texte.
    desde: tHome("precioDesde"),
    conteoAlojamientos: (count: number) => tHome("conteoAlojamientos", { count }),
    capacidadPersonas: (count: number) => tHome("capacidadPersonas", { count }),
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
  const { seccion, inicio, desde, conteoAlojamientos, capacidadPersonas } = await libelles(tipo, locale);

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
    // LA PAGE OR ENTIÈRE, comme l'accueil (plan 41, P1 ; arbitrage D1 = A : on parcourt sur l'or).
    // `pagina` : la colonne de l'accueil (F7) ; `acento` : la surface or, header compris, sans bande
    // claire entre les sections.
    <PageShell variant="pagina" fondo="acento">
      {/* Règle SEO 6 : le JSON-LD est rendu côté serveur par la route, jamais par `Migas`. */}
      <JsonLd
        data={buildBreadcrumbJsonLd(
          getSiteUrl(),
          migasParaJsonLd(migas, locale, `/${segmentoDeTipo(tipo)}`)
        )}
      />

      {/* Le bandeau (S2), variante `navegacion` : la page est déjà or, il n'a pas de fond propre.
          Il porte le SEUL `<h1>`, VISIBLE, contrairement à l'ancien `<h1>` masqué de l'accueil
          (décision 5, spec 29) : un titre masqué laisserait le visiteur deviner où il a atterri.
          Pas encore de chapô : D14 dit oui, mais les textes (40 à 60 mots par type, `es` et `en`)
          sont à rédiger par Jérôme — ils iront dans `chapo`, clé `ListadoPage.chapo.<tipo>`. */}
      <BandeauPagina
        variante="navegacion"
        migas={<Migas items={migasVisibles} etiqueta={t("migasEtiqueta")} locale={locale} testId="migas" />}
        titulo={seccion}
        accion={
          <div className="flex flex-col gap-4">
            {/* ⚠️ `atajosTipo={[]}` : la page ne connaît qu'un type et n'a compté aucun autre. Ce
                composant navigue vers `/`, pas vers la page courante — décision 10, le site n'a
                qu'UN écran de résultats. */}
            <BuscadorInicio
              criteriosIniciales={criterios}
              aujourdIso={todayInBogota()}
              localeCodigo={locale}
              labels={labels}
              atajosTipo={[]}
            />
            {avisoAlojamiento ? (
              // L'encadré info de la charte (S6), blanc sur l'or, sous la recherche dont il explique
              // les dates : plus visible qu'une phrase noyée sous la barre (retour Jérôme : « il faut
              // que ce soit plus visible »). Côté evento, aucun bloc bloquant équivalent sur
              // `/mi-viaje` (jamais décidé) : informatif.
              <Aviso tono="info" testId={avisoAlojamiento.testId}>
                {avisoAlojamiento.texto}
              </Aviso>
            ) : null}
          </div>
        }
      />

      {categorias.length === 0 ? (
        // Deux états vides distincts : « ta recherche ne donne rien » n'est pas « il n'y a pas
        // encore d'offres ». Le second n'invite pas à changer des critères qui n'existent pas.
        // Sans action : la recherche juste au-dessus en est une (S8).
        <EstadoVacio
          titulo={hayCriterios(criterios) ? t("emptyState.titulo") : t("sinOfertas.titulo")}
          descripcion={
            hayCriterios(criterios) ? t("emptyState.descripcion") : t("sinOfertas.descripcion")
          }
          testId="estado-vacio"
        />
      ) : (
        // L'écart entre deux rails est celui de l'accueil (32 → 72 px), en `cqw` de la colonne :
        // `@container` ici, comme la colonne des sections de l'accueil (`page.tsx`).
        <div className="@container">
          <div className="flex flex-col gap-y-[clamp(2rem,6cqw,4.5rem)]">
            {categorias.map((categoria, indice) => {
              // La catégorie de rattrapage arrive SANS nom (`buscar.ts` ne traduit rien) : son
              // libellé est d'interface, il vient d'ici — défaut connu n° 5, un `<h2>` vide.
              const nombre = categoria.esSinTag ? t(`sinTag.${tipo}.nombre`) : categoria.nombre;
              return (
                <SeccionRiel
                  key={categoria.slug}
                  tamanoTitulo="seccion"
                  titulo={nombre}
                  hrefVerMas={hrefCategoria(tipo, categoria.slug, sufijoCriterios)}
                  // Le nom accessible du « GO → » nomme SA catégorie (« Ver todo: Agua ») : le même
                  // « Más actividades » répété sous chaque rail ne disait pas où il menait.
                  labelVerMas={t("verCategoria", { categoria: nombre })}
                  mostrarVerMas={categoria.total > categoria.tarjetas.length}
                  tarjetas={categoria.tarjetas}
                  locale={locale}
                  labelDesde={desde}
                  conteoAlojamientos={conteoAlojamientos}
                  capacidadPersonas={capacidadPersonas}
                  // Le LCP : la première tuile du premier rail, et elle seule.
                  prioridad={indice === 0}
                  testId={`categoria-${categoria.slug}`}
                />
              );
            })}
          </div>
        </div>
      )}
    </PageShell>
  );
}
