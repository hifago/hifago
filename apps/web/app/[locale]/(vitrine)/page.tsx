import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { todayInBogota } from "@hifago/domain";
import { JsonLd } from "@/components/seo/JsonLd";
import { COLUMNA_PORTADA, PageShell } from "@/components/atoms/PageShell";
import { EstadoVacio } from "@/components/molecules/EstadoVacio";
import { buscarSecciones, hrefSeccion } from "@/lib/catalog/buscar";
import { escribirCriterios, leerCriterios, leerDesdeCarrito } from "@/lib/catalog/criterios";
import { esTipoOferta, type TipoOferta } from "@/lib/catalog/tipos";
import { getCartLines } from "@/lib/cart/getCartLines";
import { buildWebSiteJsonLd } from "@/lib/seo/jsonld/site";
import { buildPageMetadata } from "@/lib/seo/pageMetadata";
import { getSiteUrl } from "@/lib/seo/siteUrl";
import type { Locale } from "@/messages";
import { BuscadorInicio } from "./BuscadorInicio";
import { labelsBuscador } from "./labelsBuscador";
import { MenuTiposPortada } from "./MenuTiposPortada";
import { PortadaInicio } from "./PortadaInicio";
import { SeccionPortada } from "./SeccionPortada";
import { tiposDeBarra } from "./tiposDeBarra";

// L'ACCUEIL, QUI EST AUSSI L'ÉCRAN DE RÉSULTATS (spec 28, Tranche 1 — 2026-09-08).
//
// Le §2a du cahier client tranche les deux d'un coup : il n'y a pas de route `/buscar`, les
// critères vivent dans l'URL de CETTE page, et les résultats restent groupés par type d'offre.
// Une recherche ne change donc pas d'écran — elle change les paramètres de celui-ci.
//
// ⚠️ Ce fichier remplace un catalogue à plat qui faisait trois requêtes séquentielles et soixante
// lignes de regroupement ici même, puis filtrait EN MÉMOIRE côté client (`CatalogBrowser`,
// supprimé avec ce lot). Deux règles de la spec 27 en sont nées et sont vérifiées par la CI
// (`scripts/check-data-layer.sh`) : aucune requête Supabase dans un fichier de route, et aucun
// import de `@hifago/ui` — tout passe par `lib/catalog/`, et tout le HeroUI vit derrière une
// frontière `"use client"` (`BuscadorInicio` → `SearchPanel`). Les sections de la maquette du
// 2026-10-01 (`SeccionPortada`) n'en ont plus besoin du tout : elles sont servies sans JavaScript.

/** Plafond par section, cahier §2a. Il vaut AUSSI sous recherche — sinon l'accueil filtrée
 *  devient une page à rallonge et se confond avec les pages de listing (spec 28 §8). */
const POR_SECCION = 8;

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "HomePage" });

  // La page la plus stratégique du site n'avait AUCUN generateMetadata : elle héritait du seul
  // `title: "Hifago"` du layout, alors que ces deux libellés existaient déjà dans messages/*.json
  // sans être utilisés nulle part.
  //
  // ⚠️ Le canonical auto-référent n'est pas décoratif ici : proxy.ts pose le cookie d'attribution
  // à partir de `?ref=` sur N'IMPORTE QUELLE page, et [locale]/r/[code]/route.ts redirige vers
  // `/<locale>?ref=<code>`. Chaque code promo distribué fabrique donc une URL indexable distincte
  // de l'accueil ; sans canonical, rien ne les rassemble. Depuis la spec 28 il rassemble aussi
  // toutes les variantes de recherche (`?q=`, `?personas=`…) — même mécanisme, sans une ligne de
  // plus : `pathFor` ignore les paramètres.
  //
  // Pas de `nativeLocales` : ces textes viennent de next-intl (jeu d'interface fermé et complet
  // dans les deux locales), pas du contenu partenaire soumis au repli JSONB.
  return buildPageMetadata({
    locale,
    pathFor: (candidate) => `/${candidate}`,
    title: t("title"),
    description: t("description"),
  });
}

export default async function HomePage({ params, searchParams }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("HomePage");
  const tCommon = await getTranslations("Common");

  // Les critères de l'URL sont les SEULS qui filtrent (spec 28 §0 invariant 10) : plus aucun
  // filtrage en mémoire. `leerCriterios` ne lève jamais — un paramètre invalide est ignoré, jamais
  // une 400 : une URL mal recopiée doit rendre l'accueil normale, pas une page cassée.
  const paramsBrutos = await searchParams;
  const criterios = leerCriterios(paramsBrutos);
  const sufijoCriterios = escribirCriterios(criterios);

  // Spec 28 Tranche 3 (cahier §2b.5) : le réordonnancement ne s'applique QUE juste après un ajout
  // au panier (décision Jérôme) — jamais à une simple visite de l'accueil. `desdeCarrito` porte ce
  // signal ; en son absence, `tiposEnCarrito` reste `undefined` et `buscarSecciones` se comporte
  // EXACTEMENT comme avant ce lot — zéro requête de plus.
  let tiposEnCarrito: ReadonlySet<TipoOferta> | undefined;
  if (leerDesdeCarrito(paramsBrutos)) {
    const lineas = await getCartLines(locale as Locale);
    tiposEnCarrito = new Set(lineas.map((linea) => linea.productType).filter(esTipoOferta));
  }

  // La requête PRINCIPALE de la page (plus `getCartLines` ci-dessus, seulement juste après un
  // ajout au panier) — ni l'une ni l'autre ne part d'ici : `lib/catalog/`/`lib/cart/` les portent,
  // jamais un `.from()`/`createClient()` dans ce fichier (spec 27 invariant 2). Les sections vides
  // ne sont pas dans le tableau rendu.
  const secciones = await buscarSecciones(criterios, {
    porSeccion: POR_SECCION,
    locale,
    tiposEnCarrito,
  });

  const labels = await labelsBuscador(locale as Locale);
  const tiposBarra = await tiposDeBarra(locale as Locale, sufijoCriterios);

  return (
    // LA MAQUETTE DE L'ACCUEIL fournie par Jérôme le 2026-10-01 (« page d'accueil 1 » du parcours
    // « réserver une activité »), reproduite à l'identique : sur l'or de la charte, un héros (la rue
    // aux zócalos, le grand logo, la navigation par type, la recherche) puis une section par type —
    // titre, trait, motif, conteneur marine de trois photos, « GO → ».
    //
    // `variant="portada"` : la coquille ne pose ni padding ni grille — le héros commence tout en
    // haut, SOUS le header transparent (`SiteHeader`, variante choisie par `CoquillaVitrine`), et
    // chaque bloc s'aligne sur `COLUMNA_PORTADA`. `fondo="acento"` : toute la page sur l'or, <body>
    // compris (`globals.css`, section « Fond or »).
    <PageShell variant="portada" fondo="acento">
      {/* Nœud d'identité du site : c'est le plus rentable pour être cité par un moteur de
          réponse, et il n'exige aucune colonne de base de données. */}
      <JsonLd data={buildWebSiteJsonLd(getSiteUrl(), locale, t("title"), t("description"))} />

      {/* Le <h1> est le GRAND LOGO du héros, son texte reste dans le DOM (`sr-only`) — voir
          `PortadaInicio`. Il n'est plus caché tout seul dans un bloc à part : la maquette donne
          enfin à ce titre la place que l'ancien commentaire attendait (« Jérôme a annoncé un bloc
          titré à cet endroit »). */}
      <PortadaInicio
        titulo={t("h1")}
        navegacion={
          // ⚠️ La navigation PRINCIPALE de la page, qui remplace `SelectorTipo` (2026-10-01) : les
          // cinq types en ligne, passant à la ligne plutôt que de se replier. `testId` inchangé —
          // `e2e/home.spec.ts` clique `selector-tipos-activity`.
          <MenuTiposPortada
            tipos={tiposBarra}
            etiqueta={tCommon("selectorTipoEtiqueta")}
            testId="selector-tipos"
          />
        }
        busqueda={
          // ⚠️ Hôte CLIENT obligatoire : toutes les props de `SearchPanel` sont des fonctions,
          // qu'un Server Component ne sait pas sérialiser. `aujourdIso` est calculé à Guatapé —
          // jamais dans le fuseau du serveur (règle §11.20, vérifiée par scripts/check-timezone.sh).
          <BuscadorInicio
            criteriosIniciales={criterios}
            aujourdIso={todayInBogota()}
            localeCodigo={locale as Locale}
            labels={labels}
            // Les raccourcis proposés avant la première frappe. Ils sortent des sections déjà
            // calculées : aucune requête de plus, et ils décrivent le catalogue RÉELLEMENT servi —
            // un type absent des résultats n'apparaît pas comme raccourci vers une page vide.
            atajosTipo={secciones.map((seccion) => ({ tipo: seccion.tipo, total: seccion.total }))}
          />
        }
        testId="portada"
      />

      {/* La colonne des sections : la même que le héros et le header (`COLUMNA_PORTADA`). L'écart
          entre deux sections est celui de la maquette (52 px pour une colonne de 572, mesuré —
          6 % une fois retranchée la boîte de 44 px du lien « GO → »). */}
      <div className={`${COLUMNA_PORTADA} @container pb-[clamp(3rem,12cqw,7rem)]`}>
        <div className="flex flex-col gap-y-[clamp(2rem,6cqw,4.5rem)]">
          {secciones.length === 0 ? (
            // Un seul état vide global, jamais un « Aucune activité » répété cinq fois : sur une
            // recherche pointue, ce serait cinq lignes de bruit. La barre reste utilisable au-dessus.
            <EstadoVacio
              titulo={t("emptyState.titulo")}
              descripcion={t("emptyState.descripcion")}
              testId="estado-vacio"
            />
          ) : (
            secciones.map((seccion) => (
              <SeccionPortada
                key={seccion.tipo}
                // Le titre dit la même chose que le menu du héros (« Alojamiento », « Retiros »…) :
                // même clé, `tiposPortada` — voir `tiposDeBarra.ts`.
                titulo={t(`tiposPortada.${seccion.tipo}`)}
                hrefVerMas={hrefSeccion(seccion.tipo, sufijoCriterios)}
                // Le nom accessible du « GO → » nomme le TYPE (« Más actividades ») — demande de
                // Jérôme du 2026-10-01, conservée : c'est aussi le texte d'ancre qu'un moteur lit.
                labelVerMas={t(`masPorTipo.${seccion.tipo}`)}
                // ⚠️ « L'accueil a toujours plus d'offres du type qu'il n'en montre » n'est vrai QUE
                // sans filtre actif — signalé par Jérôme le 2026-09-14 : sous une recherche qui ne
                // laisse que ≤8 résultats d'un type, le lien menait à une page montrant EXACTEMENT
                // les mêmes cartes. Exception : les activités, dont le lien mène à un index de
                // catégories (spec 29), utile quel que soit le compte.
                //
                // ⚠️ SANS RECHERCHE ACTIVE, chaque section porte son lien (demande de Jérôme du
                // 2026-10-01) : c'est la porte d'entrée de la page du type, pas une promesse de
                // cartes supplémentaires — et la maquette en montre un sous chaque section.
                mostrarVerMas={
                  sufijoCriterios === "" ||
                  seccion.tipo === "activity" ||
                  seccion.total > seccion.tarjetas.length
                }
                tarjetas={seccion.tarjetas}
                testId={`seccion-${seccion.tipo}`}
              />
            ))
          )}
        </div>
      </div>
    </PageShell>
  );
}
