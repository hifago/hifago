import { Link } from "@/i18n/navigation";
import { LinkButton } from "@/components/atoms/LinkButton";
import { Title } from "@/components/atoms/Title";
import { BandaTitulo } from "@/components/molecules/BandaTitulo";
import { CarruselConSombra } from "@/components/molecules/CarruselConSombra";
import { TarjetaOferta } from "@/components/molecules/TarjetaOferta";
import type { Locale } from "@/messages";
import type { TarjetaOferta as OfertaTarjeta } from "@/lib/catalog/tipos";

// Une section de l'accueil : un titre, ses cartes, et le lien qui mène au listing complet
// (2026-09-08, lot D — docs/specs/28-vitrine-accueil-et-resultats.md §5 « Une section » et §7).
//
// POURQUOI CE COMPOSANT EXISTE. L'accueil en rend CINQ (activités, alojamientos, transportes,
// camps, eventos — l'ordre de `ORDEN_SECCIONES`), et les pages de listing en rendront une seule.
// Écrire cinq fois la même grille dans `page.tsx` mettrait la règle « 1 colonne, 2 à `md`, 3 à
// `lg` » à cinq endroits, et le lien « Ver más » avec elle. La spec 28 le nomme pour cette raison
// même, dans sa liste des composants manquants du lot.
//
// ⚠️ LA VARIANTE `carrusel` A ÉTÉ REFONDUE LE 2026-10-01, d'après une capture de référence fournie
// par Jérôme (ateliercestparla.com, bande « PROJETS À LA UNE »). Elle ne ressemble plus du tout aux
// deux autres, d'où les deux `return` distincts plus bas plutôt qu'une cascade de ternaires :
//   · une bande pleine largeur à l'OR de la charte, portant le titre en très gros, qui défile
//     horizontalement au scroll de la page (`BandaTitulo`) ;
//   · un conteneur arrondi au BLEU POUDRE de la charte, en retrait des bords de l'écran ;
//   · dedans, exactement trois cartes CARRÉES à l'écran à partir de `md` ;
//   · dessous, un bouton « Más actividades / Más alojamientos… » — qui remplace la carte « voir
//     más » placée en fin de rangée le 2026-09-15. Les deux ne peuvent pas coexister : ce serait
//     la double affordance que cette carte avait justement remplacé un lien pour éviter.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ PAS DE "use client" ICI, ET C'EST LA DÉCISION STRUCTURANTE DU FICHIER
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Cette section n'a AUCUN état, aucun gestionnaire d'événement, et ne traduit rien : tous ses
// libellés (`titulo`, `labelVerMas`) lui arrivent déjà traduits, parce que seule la page sait que
// le « Ver más » des activités mène à un index de tags (spec 29) et porte donc un autre mot.
//
// Elle n'importe donc RIEN de `@hifago/ui` — pas même `cn` — et reste un Server Component
// (CLAUDE.md §11.16, `apps/web/components/README.md`). Conséquence directe et voulue : le HTML de
// cinq sections × huit cartes est SERVI, pas hydraté — c'est lui que Google indexe, et c'est le
// contenu principal de la page d'accueil. Poser `"use client"` ici ferait descendre toute la
// section dans le navigateur pour zéro interactivité ; seules la carte, le bouton et la bande en
// ont besoin, et ce sont eux qui le portent. Le test `SeccionOfertas.test.tsx` vérifie cette
// absence sur le texte du fichier : une règle que rien ne vérifie n'est pas une règle
// (CLAUDE.md §11.20).
export type SeccionOfertasProps = {
  /** Déjà traduit. */
  titulo: string;
  tituloAs?: "h2";
  /** Critères de recherche déjà inclus. */
  hrefVerMas: string;
  /** Déjà traduit — il DIFFÈRE pour les activités (leur « Ver más » mène à un index de tags). */
  labelVerMas: string;
  variante: "grilla" | "lista" | "carrusel";
  tarjetas: OfertaTarjeta[];
  locale: Locale;
  /** Vrai pour la PREMIÈRE section de la page : sa première carte porte le LCP. */
  prioridad?: boolean;
  /**
   * Faux quand la catégorie n'a rien de plus à montrer (`total <= tarjetas.length`) : pas de
   * « Ver más » qui mènerait à la page qu'on vient déjà de voir en entier. Défaut `true` — ne
   * change rien pour l'accueil, qui a toujours plus d'offres par type qu'il n'en montre et ne
   * calcule pas cette condition (`buscarSecciones` ne connaît pas ce total-là).
   */
  mostrarVerMas?: boolean;
  testId?: string;
};

// ⚠️ Les jeux de classes sont écrits EN TOUTES LETTRES, jamais composés à la volée : Tailwind
// v4 scanne le TEXTE source, une classe fabriquée par interpolation n'est simplement pas générée
// et la grille s'affiche en une colonne sans que rien ne le signale.
//
// Grille : une colonne en mobile (`grid-cols-1` explicite plutôt qu'implicite — c'est la valeur
// qu'on relit pour vérifier le mobile d'abord), deux à partir de `md`, trois à partir de `lg`.
// Aucune largeur en dur : ce sont les colonnes qui s'ajoutent, jamais le conteneur qui se fige.
const CLASES_GRILLA = "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3";

// Liste : la variante des activités, dont la carte est un `Card layout="row"` (visuel à gauche,
// texte à droite — spec 28 §5). Une rangée large n'a rien à gagner à être mise en grille : elle
// s'empile, aux deux gabarits, avec un écart un peu plus serré que la grille.
const CLASES_LISTA = "flex flex-col gap-3";

// Carrusel : une ligne qui défile horizontalement au lieu de s'empiler en grille (écart accueil vs
// prototype mobile v2, `com-dev/grille-beta-test-hifago/index.html` acc-4/syn-3). Le défilement
// (`overflow-x-auto`, `snap-*`) et le dégradé de bord droit vivent dans `CarruselConSombra` — la
// seule partie qui a besoin du navigateur pour savoir s'il reste des cartes à droite.
// ⚠️ Ce n'est PAS le `Carousel` d'Embla de `packages/ui` (celui de `PhotoStrip`, à l'intérieur d'une
// carte) — ici, défilement natif du navigateur, aucune flèche ni point. Pas de
// `tabIndex`/`role="region"`/`aria-label` sur le conteneur défilant (`.claude/rules/ui.md`) : chaque
// carte qu'il contient est déjà un lien, la règle dit explicitement de ne pas les ajouter dans ce cas.
//
// `shrink-0` et AUCUNE largeur : ce `<ul>` vaut la somme de ses cartes. C'est voulu depuis que le
// conteneur bleu épouse les cartes (2026-10-01) — la largeur d'une carte ne dépend plus de ce
// `<ul>` (voir `CLASE_CARTA_CARRUSEL`), donc rien n'est circulaire, et la largeur « naturelle » de
// la rangée est exactement ce que le conteneur `w-fit` doit envelopper.
const CLASES_LISTA_CARRUSEL = "flex shrink-0 gap-4";

// ⚠️ EXACTEMENT TROIS CARTES À L'ÉCRAN à partir de `md` — la demande de Jérôme, d'après la
// référence du 2026-10-01. Ce n'est plus une largeur fixe (`w-64`, 256 px) mais un TIERS de la
// largeur disponible, gouttières déduites. Sous `md`, 82 % — une carte pleine plus l'amorce de la
// suivante, qui est l'affordance « ça défile » sur un téléphone.
//
// ⚠️ EN `cqw`, PAS EN `%` — et c'est ce qui permet au conteneur bleu d'ÉPOUSER les cartes (second
// retour de Jérôme, même jour : « il ne doit pas être rectangulaire », une section de deux cartes
// laissait un tiers de bleu vide). Un conteneur qui prend la largeur de ses cartes (`w-fit`) ne
// peut pas leur donner un pourcentage de SA largeur : ce serait circulaire. L'unité `cqw` mesure
// l'ENVELOPPE pleine largeur (`@container`, `CLASE_ENVOLTORIO_CARRUSEL`), qui ne dépend pas d'elles.
// Les rem soustraits sont ce qui sépare l'enveloppe des cartes, au pixel :
//   · `md` : padding du conteneur bleu (2 × 0.75rem) + padding du défilant (2 × 0.5rem) + deux
//     `gap-4` (2rem) = 4.5rem — trois cartes remplissent alors l'enveloppe tout rond ;
//   · mobile : 2 × 0.5rem + 2 × 0.5rem = 2rem (à `sm` le conteneur passe à `p-3` : les 0.5rem
//     d'écart sont absorbés par les 18 % d'amorce, rien ne déborde).
//
// La règle « un composant ne fixe aucune largeur en dur » (`.claude/rules/ui.md`) est donc
// RESPECTÉE ici, contrairement à la version précédente qui y dérogeait explicitement : la carte
// est redevenue une fraction de son conteneur.
//
// ⚠️ À garder synchronisé avec `SIZES_CARRUSEL` de `TarjetaOferta.tsx` (`32vw` / `82vw`) : si l'une
// bouge, l'autre doit suivre, sinon le navigateur télécharge une image à la mauvaise taille.
// `snap-start` s'applique malgré la distance DOM avec le conteneur défilant (`CarruselConSombra`) :
// le point d'ancrage du scroll-snap se résout au plus proche ANCÊTRE défilant, jamais au parent direct.
const CLASE_CARTA_CARRUSEL =
  "w-[calc((100cqw-2rem)*0.82)] shrink-0 snap-start md:w-[calc((100cqw-4.5rem)/3)]";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// LES CLASSES DE LA <section> — EN CARRUSEL, ELLE SORT DE LA COLONNE DE LECTURE (2026-10-01)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Décision de Jérôme : une rangée de cartes va d'un bord à l'autre de l'écran. Le constat qui l'a
// motivée est au rendu réel (1280×900) — la colonne de lecture de 704 px ne montrait que 2,6 cartes
// sur les 8 servies, avec 256 px de vide de chaque côté.
//
// La mécanique vit dans `PageShell` (variante `large`), qui est une grille `1fr | lecture | 1fr` :
// un enfant marqué `data-bleed` prend les trois colonnes au lieu de celle du milieu. Ici on ne fait
// que poser cette marque — et, pour les enfants qui doivent rester alignés sur le reste de la page,
// `grid-cols-subgrid` REPREND les trois pistes du parent au lieu d'en redéfinir des équivalentes.
// C'est le point : la largeur de la colonne de lecture n'est écrite qu'à UN endroit (`PageShell`),
// donc rien ne peut s'en désaligner à la première retouche.
//
// L'OR DE LA CHARTE (#ddae09) EN APLAT, ET LE MARINE DESSUS — jamais l'inverse : « l'or ne porte
// jamais de texte sur fond clair » (1.96:1) et « jamais de blanc sur l'or » (2.07:1) sont deux des
// trois interdits mesurés de `.claude/rules/ui.md`. Ici l'or EST le fond, et `--accent-foreground`
// est le marine : 6.31:1, le couple du logo lui-même. Les jetons plutôt que les hex en dur, pour
// que le mode sombre et toute retouche de charte suivent sans qu'on repasse par ce fichier.
//
// `gap-y-0` : la bande et le conteneur portent leurs propres marges, et l'écart de la coquille
// (`gap-y-6`) creuserait une rayure dorée entre les deux.
const CLASES_SECCION = "flex flex-col gap-4";
const CLASES_SECCION_CARRUSEL =
  "col-span-full grid grid-cols-subgrid gap-y-0 bg-accent pb-6 text-accent-foreground";

// Le conteneur des cartes est en retrait des BORDS DE L'ÉCRAN (et non dans la colonne de lecture) :
// c'est ce retrait constant qui laisse voir l'or tout autour, comme sur la référence.
// `@container` : c'est la largeur que lisent les `cqw` des cartes — voir `CLASE_CARTA_CARRUSEL`.
const CLASE_ENVOLTORIO_CARRUSEL = "@container col-span-full px-3 sm:px-4";

// Le titre de la bande commence À L'APLOMB DU BORD GAUCHE DE LA PREMIÈRE PHOTO (Jérôme, 2026-10-01).
// ⚠️ Ce n'est pas une valeur choisie : c'est la SOMME des trois retraits empilés devant la première
// carte, et elle doit bouger avec eux — l'enveloppe (`px-3 sm:px-4` ci-dessus), le conteneur bleu
// (`p-2 sm:p-3`, `CLASES_CONTENEDOR_CARTAS`) et le défilant (`p-2`, `CarruselConSombra`) :
// 12 + 8 + 8 = 28 px (`ml-7`), puis 16 + 12 + 8 = 36 px (`ml-9`). Mesuré au rendu à 390, 640,
// 1280 et 1920 px : carte à 28 puis 36 px partout. Vrai quand les cartes débordent (le cas de
// l'accueil) ; avec deux cartes, le conteneur se centre (`w-fit mx-auto`) et le titre ne le suit
// pas.
const SANGRIA_TITULO_CARRUSEL = "ml-7 sm:ml-9";

// LE BLEU POUDRE DE LA CHARTE (#b6cde8) — le jeton `--default`, celui du bouton secondaire. La
// variable plutôt que la classe `bg-default` : elle dit QUELLE couleur de charte on pose, là où
// `default` se lirait « la valeur par défaut ». Marine dessus, comme partout ailleurs.
//
// `w-fit max-w-full mx-auto` : le conteneur ÉPOUSE ses cartes (deux cartes = deux cartes de bleu,
// centrées) et plafonne à l'enveloppe quand elles débordent — c'est alors le défilant qui prend le
// relais, et le conteneur reste plein largeur.
const CLASES_CONTENEDOR_CARTAS =
  "mx-auto w-fit max-w-full rounded-3xl bg-[var(--default)] p-2 text-[var(--default-foreground)] sm:p-3";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// LA LANGUETTE DU BOUTON — le conteneur n'est pas un rectangle (référence de Jérôme, 2026-10-01)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Le bouton « Más actividades » ne vit pas dans une bande pleine largeur sous les cartes : il est
// dans une LANGUETTE du même bleu, qui sort du bord bas du conteneur, centrée, juste assez large
// pour lui. Les deux raccords entre le bord du conteneur et les flancs de la languette sont des
// arrondis CONCAVES — c'est ce qui fait lire les deux formes comme une seule.
//
// Un arrondi concave n'existe pas en `border-radius`. Il est peint par deux pseudo-éléments carrés
// posés de part et d'autre du haut de la languette (`right-full` / `left-full`), chacun rempli du
// bleu SAUF un quart de disque transparent centré sur son coin bas extérieur : ce qui reste est
// exactement le congé entre le bord du conteneur et le flanc de la languette. Rayon = côté du carré
// (1.5rem = `rounded-3xl`), pour que les arrondis concaves et convexes soient les mêmes. `0.5px` de
// fondu sur le bord du disque : sans lui, le cercle est crénelé.
//
// ⚠️ La languette est SOUS le conteneur, pas dedans, et `-mt-px` les soude : à certains zooms, deux
// blocs de même couleur bord à bord laissent passer un filet d'or d'un sous-pixel.
const CLASES_LENGUETA =
  "relative mx-auto -mt-px w-fit rounded-b-3xl bg-[var(--default)] px-3 pt-1 pb-3 sm:px-4 before:absolute before:top-0 before:right-full before:size-6 before:bg-[radial-gradient(circle_at_0_100%,transparent_1.5rem,var(--default)_calc(1.5rem+0.5px))] after:absolute after:top-0 after:left-full after:size-6 after:bg-[radial-gradient(circle_at_100%_100%,transparent_1.5rem,var(--default)_calc(1.5rem+0.5px))]";

export function SeccionOfertas({
  titulo,
  tituloAs,
  hrefVerMas,
  labelVerMas,
  variante,
  tarjetas,
  locale,
  prioridad,
  mostrarVerMas,
  testId,
}: SeccionOfertasProps) {
  // Fragment commun aux trois variantes : évite de dupliquer le `.map()` selon qu'il finit dans un
  // `<ul>` nu (grilla/lista) ou enveloppé par `CarruselConSombra` (carrusel).
  const cartas = tarjetas.map((tarjeta, index) => (
    // `tarjeta.clave` : la clé vient de la donnée (spec 28 §0), jamais de l'index — deux
    // recherches successives réordonnent les cartes, et React réutiliserait les mauvaises.
    <li key={tarjeta.clave} className={variante === "carrusel" ? CLASE_CARTA_CARRUSEL : undefined}>
      <TarjetaOferta
        oferta={tarjeta}
        variante={variante}
        locale={locale}
        // ⚠️ UNE SEULE carte prioritaire dans toute la page, et c'est la première de la première
        // section. `prioridad` sans `index === 0` poserait huit préchargements sur la première
        // section — sept d'entre eux sous la ligne de flottaison, exactement la régression Core
        // Web Vitals que la prop `loading` de PhotoStrip existe pour éviter.
        prioridad={prioridad === true && index === 0}
      />
    </li>
  ));

  // `aria-label={titulo}` : un <section> sans nom accessible n'est PAS un repère de navigation,
  // c'est une simple div pour un lecteur d'écran. Nommée, chacune des cinq sections de l'accueil
  // devient atteignable directement — et le nom est exactement le titre visible, jamais un libellé
  // parallèle qui divergerait à la première retouche.
  if (variante === "carrusel") {
    return (
      <section
        className={CLASES_SECCION_CARRUSEL}
        aria-label={titulo}
        // La marque que lit `PageShell` : cet enfant-là ne va PAS dans la colonne de lecture.
        // Chaîne vide plutôt que `true` — le sélecteur teste la PRÉSENCE de l'attribut, pas sa
        // valeur, et `data-bleed="true"` laisserait croire qu'une valeur compte.
        data-bleed=""
        data-testid={testId}
      >
        {/* Le titre de la section N'EST PLUS un `Title` posé au-dessus des cartes : c'est cette
            bande. Le niveau sémantique, lui, ne bouge pas — il traverse la prop `tituloAs`, et
            `BandaTitulo` n'en rend qu'un seul exemplaire côté serveur (voir son en-tête, qui
            explique pourquoi les doublures ne sont ajoutées qu'après hydratation). */}
        <BandaTitulo
          titulo={titulo}
          tituloAs={tituloAs ?? "h2"}
          sangria={SANGRIA_TITULO_CARRUSEL}
          testId={testId ? `${testId}-banda` : undefined}
        />

        <div className={CLASE_ENVOLTORIO_CARRUSEL}>
          <div className={CLASES_CONTENEDOR_CARTAS}>
            {/* ⚠️ `fondo="contenedor"` : sans lui, les dégradés de bord partiraient du fond de
                PAGE et peindraient deux bandes claires sur un conteneur bleu poudre, au lieu de
                s'y fondre. C'est exactement le défaut que cette prop existe pour empêcher. */}
            <CarruselConSombra
              fondo="contenedor"
              testId={testId ? `${testId}-carrusel` : undefined}
            >
              <ul className={CLASES_LISTA_CARRUSEL}>{cartas}</ul>
            </CarruselConSombra>
          </div>

          {/* Le bouton remplace la carte « voir más » de fin de rangée (2026-09-15 → 2026-10-01).
              Il est dans la LANGUETTE bleue (voir `CLASES_LENGUETA`), jamais posé à nu sur l'or :
              le bouton primaire de la charte EST or, il y disparaîtrait. Or sur bleu poudre,
              marine dessus, c'est le couple que la charte prévoit pour une action primaire. */}
          {mostrarVerMas !== false ? (
            <div className={CLASES_LENGUETA}>
              <LinkButton href={hrefVerMas} testId={testId ? `${testId}-ver-mas` : undefined}>
                {labelVerMas}
              </LinkButton>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className={CLASES_SECCION} aria-label={titulo} data-testid={testId}>
      {/* Le NIVEAU vient de la page, jamais deviné ici : c'est ce qui garantit un seul <h1> et une
          hiérarchie sans saut. `h2` par défaut parce que c'est le seul usage prévu (sous le <h1>
          masqué de l'accueil), et le type le dit — `tituloAs` n'accepte rien d'autre. */}
      <Title as={tituloAs ?? "h2"} testId={testId ? `${testId}-titulo` : undefined}>
        {titulo}
      </Title>

      <ul className={variante === "grilla" ? CLASES_GRILLA : CLASES_LISTA}>{cartas}</ul>

      {/* ⚠️ Le `Link` de `@/i18n/navigation`, jamais `next/link` ni `<a href>` : lui seul conserve
          le préfixe de langue, et ce lien est le maillage interne qui fait découvrir les pages de
          listing à un crawler. `min-h-11` = 44 px de cible tactile ; `self-start` pour que la zone
          cliquable s'arrête au texte au lieu de courir sur toute la largeur. */}
      {mostrarVerMas !== false ? (
        <Link
          href={hrefVerMas}
          className="inline-flex min-h-11 items-center self-start rounded-[var(--radius)] text-base underline-offset-4 hover:underline focus-visible:status-focused"
          data-testid={testId ? `${testId}-ver-mas` : undefined}
        >
          {labelVerMas}
        </Link>
      ) : null}
    </section>
  );
}
