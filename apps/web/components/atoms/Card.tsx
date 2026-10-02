"use client";

import type { ReactNode } from "react";
import { Card as HeroUICard } from "@hifago/ui";
import { Link } from "@/i18n/navigation";

// La carte de la vitrine (2026-09-02, vague 3). Surcouche de l'API compound de HeroUI
// (`Card.Header` / `Card.Title` / `Card.Description` / `Card.Content`), employée cinq fois dans
// l'app : catalogue, fiche produit ×2, fiche établissement ×2.
//
// `"use client"` obligatoire : ce fichier importe le barrel `@hifago/ui`, dont le graphe de
// modules fait planter `next build` dès qu'il atteint un Server Component (CLAUDE.md §11.16).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. LA CARTE CLIQUABLE — le cas qui justifie ce composant
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Deux des cinq usages enveloppent la carte ENTIÈRE dans un `<Link>` (`CatalogBrowser.tsx:94` et
// `EstablishmentDetailView.tsx:139`). C'est le motif le plus courant d'un catalogue, et il a deux
// défauts qui ne se voient pas à l'œil :
//
//   a. ⚠️ Le nom accessible du lien est la concaténation de TOUT son contenu. Sur la carte du
//      catalogue, NVDA annonce aujourd'hui « lien, Habitación privada con vista al lago, 2
//      habitaciones, Amplia habitación con balcón privado sobre el embalse… » — un seul libellé
//      interminable, et la liste des liens de la page devient inutilisable.
//   b. ⚠️ Un second élément interactif dans la carte (un bouton « ajouter au panier », un lien
//      vers l'établissement) produirait un lien DANS un lien : du HTML invalide, que les
//      navigateurs réparent en fermant le premier `<a>` — donc une carte qui ne navigue plus.
//
// LA SOLUTION RETENUE : seul le TITRE est un lien ; son pseudo-élément `::after` est étiré sur
// toute la carte. C'est le motif « stretched link ». Ce qu'il donne, vérifié au rendu et pas
// supposé :
//   • le nom accessible du lien est exactement le titre — un libellé, pas un paragraphe ;
//   • le lien reste un VRAI lien : `<a href>`, donc clic milieu, « ouvrir dans un nouvel onglet »,
//     « copier l'adresse » et mise en favori fonctionnent. La navigation n'est PAS remplacée par
//     un `onClick`, ce qui aurait supprimé tout cela sans rien annoncer ;
//   • toute la surface reste cliquable, parce que le `::after` la recouvre ;
//   • un second élément interactif redevient possible — bouton, champ, second lien — et il n'est
//     PAS imbriqué dans le lien : deux frères dans le DOM, pas un `<a>` dans un `<a>`. La carte le
//     remonte elle-même au-dessus de l'overlay (voir `ENFANTS_INTERACTIFS_CLASS`), donc l'appelant
//     n'a rien à savoir de ce mécanisme : `children` accepte ce qu'on veut, comme sur une carte
//     ordinaire.
//
// ⚠️ Le prix, assumé et connu du motif : la sélection de texte à la souris dans une carte
// cliquable est avalée par l'overlay. Le compromis penche du bon côté — un catalogue se parcourt,
// il ne se recopie pas.
//
// ⚠️ Conséquence sur le type : quand `href` est fourni, `title` devient REQUIS **et de type
// `string`**, pas `ReactNode`. C'est ce qui garantit que le nom accessible du lien est un libellé
// lisible et non le rendu textuel d'un bloc de JSX. Même mécanisme que le `alt` d'`Image` et le
// `label` d'`IconButton` : la règle est portée par le compilateur, pas par la relecture.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. LES TROIS `className` DE L'EXISTANT — ce qu'ils cherchaient à obtenir
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Le README interdit la prop `className`. Les trois valeurs passées aujourd'hui ne deviennent pas
// trois props pour autant : deux le deviennent, une DISPARAÎT.
//
//   • `text-lg` / `text-2xl` sur `Card.Title` (`ProductDetailView.tsx:118` et `:207`) → `titleSize`.
//     `.card__title` est en `text-sm` chez HeroUI ; les deux fiches voulaient un titre de page.
//   • `flex flex-col gap-6` sur `Card.Content` (`ProductDetailView.tsx:123`) → `contentGap`.
//     `.card__content` est DÉJÀ `flex flex-1 flex-col gap-1` : de ces quatre classes, une seule
//     changeait quelque chose, l'écart. Les trois autres étaient recopiées pour rien.
//   • `h-full overflow-hidden` sur la carte du catalogue (`CatalogBrowser.tsx:95`) → RIEN, et
//     c'est le constat le plus utile du lot :
//       – `h-full` ne servait qu'à rattraper le `<Link>` intercalé entre la grille et la carte :
//         c'est LUI qui était l'élément de grille et qui s'étirait, pas la carte. Sans cet
//         emballage — et la carte cliquable le supprime — la carte est l'élément de grille, et
//         `align-items: stretch` (le défaut d'une grille CSS) l'étire toute seule. Vérifié au
//         rendu : quatre cartes de hauteurs de texte différentes, quatre hauteurs égales, sans
//         aucune classe de hauteur ;
//       – ⚠️ `overflow-hidden` était INERTE. `.card` porte `p-4`, donc l'image était déjà en
//         retrait de 16 px des bords : il n'y avait rien à rogner. Cette classe dit pourtant
//         l'intention — une image à fleur de carte, rognée au rayon des angles. `media` la
//         réalise vraiment, en annulant le padding (`-mx-4 -mt-4`) et en rognant sur la carte.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. CE QUE CE COMPOSANT NE FAIT PAS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Pas de prop `variant` (les quatre fonds de HeroUI), pas de `footer` : aucun des cinq usages
// n'en a besoin, et le README interdit d'anticiper. Ils s'ajouteront le jour où un écran les
// demande.
export type CardTitleLevel = "h2" | "h3" | "h4";
export type CardTitleSize = "sm" | "md" | "lg";
export type CardContentGap = "sm" | "md" | "lg";
export type CardLayout = "stack" | "row" | "overlay";

type CardCommun = {
  /** Le corps de la carte. Rendu dans `Card.Content` — absent, le bloc n'existe pas. */
  children?: ReactNode;
  /**
   * Le visuel de tête, typiquement l'atome `<Image>`. En `stack` il vient à fleur de carte et est
   * rogné au rayon des angles ; en `row` il devient une vignette de 64 px à gauche.
   */
  media?: ReactNode;
  /** Ligne courte entre le titre et la description, déjà traduite (le « 3 habitaciones » du catalogue). */
  subtitle?: ReactNode;
  description?: ReactNode;
  /** L'écart entre les blocs du corps. `sm` = le défaut de HeroUI. */
  contentGap?: CardContentGap;
  /**
   * `row` = vignette à gauche, texte à droite — la ligne produit d'une fiche établissement.
   * `overlay` = carte CARRÉE, le visuel la remplit entièrement et le texte est posé PAR-DESSUS, dans
   * un cartouche clair en bas ; `children` (le prix) devient une pastille juste au-dessus, à droite.
   * C'est la carte du carrusel de l'accueil, d'après la référence de Jérôme du 2026-10-01.
   */
  layout?: CardLayout;
  /**
   * `true` : la carte remplit toute la hauteur disponible (`h-full`) et centre son contenu
   * verticalement, au lieu de s'arrêter à la hauteur de son propre contenu. Sert la carte « voir
   * más » du carrusel de `SeccionOfertas.tsx` : ses voisines n'ont pas toutes le même nombre de
   * lignes (sous-titre présent ou non selon le type d'offre), et une hauteur calquée sur UN
   * contenu précis se désynchronise dès que le contenu réel diffère. `align-items: stretch`
   * (défaut d'un conteneur flex, posé sur le `<ul>` de la ligne) donne déjà à chaque `<li>` la
   * hauteur de la plus grande carte — cette prop fait juste en sorte que le contenu de LA carte
   * l'occupe, plutôt que de laisser un vide en dessous. Défaut `false` : les cinq usages existants
   * (dans des grilles qui n'étirent pas leurs cellules) sont inchangés.
   */
  fullHeight?: boolean;
  testId?: string;
};

type CardTitre = {
  title: ReactNode;
  /**
   * ⚠️ REQUIS, jamais deviné — même règle que l'atome `Title` : « un seul `<h1>`, une hiérarchie
   * sans saut » se décide dans la page, qui en a la vue d'ensemble, pas dans la carte. HeroUI rend
   * un `<h3>` d'office, ce qui produit un saut de niveau dès qu'une carte suit un `<h1>`.
   */
  titleAs: CardTitleLevel;
  /** L'apparence, décorrélée du niveau — même séparation que `Title`. */
  titleSize?: CardTitleSize;
  /**
   * `"center"` centre le titre (et le sous-titre/description sous lui, par héritage de
   * `text-align`) — la carte « voir más » du carrusel de `SeccionOfertas.tsx` en a besoin pour
   * ressembler à une carte d'offre normale sans photo ni prix, où rien d'autre n'ancre le titre à
   * gauche. Défaut `"start"` : les cinq usages existants (catalogue, fiche produit ×2, fiche
   * établissement ×2) sont inchangés.
   */
  titleAlign?: "start" | "center";
};

export type CardProps = CardCommun &
  (
    | ({ href?: undefined } & (
        | CardTitre
        | { title?: undefined; titleAs?: undefined; titleSize?: undefined; titleAlign?: undefined }
      ))
    | ({
        /** Rend TOUTE la carte cliquable. Chemin interne : le préfixe de locale est conservé. */
        href: string;
        /** ⚠️ Devient le nom accessible du lien — donc une chaîne, jamais du JSX. Voir l'en-tête. */
        title: string;
      } & Omit<CardTitre, "title">)
  );

// Chaînes littérales complètes, jamais construites par concaténation : Tailwind v4 scanne ce
// fichier comme du texte (`@source` dans app/globals.css) et ne voit que des classes écrites en
// toutes lettres. Une classe interpolée n'existerait pas dans le CSS compilé — et la carte
// s'afficherait sans style, en silence.
const TITLE_SIZE_CLASSES: Record<CardTitleSize, string> = {
  sm: "", // `.card__title` de HeroUI, inchangé.
  md: "text-lg",
  lg: "text-2xl",
};

// `.card__content` est déjà `gap-1` côté HeroUI ; ces classes vivent dans la couche `utilities` et
// gagnent donc la cascade sur son `@apply` de la couche `components` (même mécanisme que celui
// mesuré pour l'axe couleur de `Button`).
const CONTENT_GAP_CLASSES: Record<CardContentGap, string> = {
  sm: "",
  md: "gap-3",
  lg: "gap-6",
};

// L'overlay qui rend toute la carte cliquable. `after:content-['']` est écrit explicitement bien
// que Tailwind v4 le pose par défaut : sans lui, le pseudo-élément n'est pas généré et la carte
// n'est plus cliquable qu'au titre — une panne muette qu'aucun test de rendu ne verrait.
// `z-[1]` le fait passer AU-DESSUS du visuel (`Image` rend un conteneur `relative`), et laisse
// `z-[2]` libre pour un futur élément interactif de la carte.
const OVERLAY_CLASS = "after:absolute after:inset-0 after:z-[1] after:content-['']";

// L'affordance de la carte cliquable, et son anneau de focus.
//
// ⚠️ `hover:border-accent` est écrit aujourd'hui sur `EstablishmentDetailView.tsx:140` et n'a
// AUCUN effet : `.card` ne déclare pas de bordure, et Tailwind met `border-width: 0` par défaut —
// changer la couleur d'une bordure inexistante ne peint rien. L'intention (souligner la carte
// survolée en couleur d'accent) est reprise ici avec un `ring`, qui, lui, se voit.
//
// ⚠️ L'anneau de FOCUS est indispensable, pas décoratif : le focus clavier atterrit sur le lien du
// titre, dont l'anneau natif n'entoure que quelques mots au milieu d'une carte entièrement
// cliquable. `status-focused` est l'utility de HeroUI elle-même — le même anneau que ses boutons
// et ses champs, posé sur la carte plutôt que sur le texte.
const CLICKABLE_CLASS =
  "transition-shadow hover:ring-2 hover:ring-accent has-[[data-card-link]:focus-visible]:status-focused";

/**
 * ⚠️ CE QUI REMET LES ENFANTS INTERACTIFS AU-DESSUS DE L'OVERLAY — automatiquement.
 *
 * L'overlay qui rend la carte cliquable est en `z-[1]`. Sans ces deux classes, un bouton, un
 * champ ou un second lien posé dans `children` passe DESSOUS et son clic part au lien de la carte.
 * Mesuré le 2026-09-02, sur une carte cliquable : un `<button>` sans `z-index` a l'overlay sous le
 * curseur (`elementFromPoint` renvoie le `<a>`) et le clic est reçu par le lien, pas par lui. Sur
 * une carte non cliquable, les trois mêmes enfants reçoivent leur clic normalement.
 *
 * La panne est SILENCIEUSE : rien ne casse, rien n'avertit, le bouton a l'air normal et navigue à
 * la place d'agir. Elle ne pouvait pas être laissée à la vigilance de l'appelant — c'est la même
 * décision que le `alt` d'`Image` ou le `rel` de `LinkButton`, appliquée à une règle de CSS plutôt
 * qu'à une prop.
 *
 * ⚠️ `a:not([data-card-link])` exclut le lien du titre : c'est LUI qui porte l'overlay, le
 * remonter au-dessus de son propre pseudo-élément n'aurait pas de sens.
 *
 * Ne couvre pas un élément rendu focalisable par `tabindex` seul, ni un `div` avec un gestionnaire
 * de clic — ni l'un ni l'autre n'existe dans ce dépôt, et `relative z-[2]` reste posable à la main
 * pour un cas exotique. Chaîne écrite en toutes lettres, comme partout ici : Tailwind scanne le
 * texte source.
 *
 * ⚠️ `:not(.absolute)` sur la MOITIÉ `relative` seulement, ajouté le 2026-09-02 (vague 4). Un
 * enfant déjà positionné en `absolute` n'a aucun besoin de `relative` — il est déjà dans le
 * contexte d'empilement, `z-index` s'y applique tel quel — et le lui imposer le REPLACE dans le
 * flux : ses `top`/`left` deviennent des décalages relatifs, et il atterrit ailleurs. Constat
 * mesuré sur `molecules/PhotoStrip` dans une carte cliquable : la flèche « photo précédente » du
 * carrousel passait de y=239 (bord gauche, mi-hauteur, correct) à y=462, sous la photo. Le clic
 * marchait, la position non — donc une panne visuelle et silencieuse de plus, dans un mécanisme
 * écrit précisément contre les pannes silencieuses. La moitié `z-[2]` reste inconditionnelle :
 * c'est elle qui fait tout le travail.
 */
const ENFANTS_INTERACTIFS_CLASS =
  "[&_:is(button,select,input,textarea,[role=button],a:not([data-card-link])):not(.absolute)]:relative [&_:is(button,select,input,textarea,[role=button],a:not([data-card-link]))]:z-[2]";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// `overlay` — LE TEXTE PAR-DESSUS LA PHOTO, SANS PERDRE LE LIEN PLEINE CARTE (2026-10-01)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Le piège : la façon évidente — un cartouche en `absolute bottom-3` — CASSE le lien pleine carte.
// Le `::after` du lien se résout sur l'ancêtre POSITIONNÉ le plus proche ; dans un cartouche
// `absolute`, il ne couvrirait plus que le cartouche, et un clic sur la photo ne mènerait nulle part.
//
// D'où une grille à UNE cellule où le visuel et le cartouche s'empilent sans qu'aucun des deux ne
// soit positionné : la carte (`relative` par HeroUI) reste le bloc conteneur de l'overlay.
//   · `grid-rows-[minmax(0,1fr)]` : la rangée vaut la hauteur de la carte, pas celle de son
//     contenu — sans lui, la rangée de points du carrousel (sous la photo carrée) l'allongerait, et
//     `self-end` pousserait le cartouche hors du carré, rogné par `overflow-hidden`.
//   · `z-[1]` sur le cartouche : un élément de grille honore `z-index` SANS être positionné. Sans
//     lui, l'image (positionnée par `next/image`) serait peinte par-dessus le cartouche.
//   · `aspect-square` + `overflow-hidden` : le carré, et les points du carrousel rognés — les
//     flèches restent, elles sont au milieu de la photo et repassent au-dessus de l'overlay par
//     `ENFANTS_INTERACTIFS_CLASS`, comme dans les deux autres dispositions.
//   · `p-0 gap-0` : annulent le `p-4` et l'écart de `.card` — le visuel va à fleur de carte.
//
// Le cartouche est `--surface` (blanc) avec le texte de la carte dessus : la photo ne porte JAMAIS
// de texte directement, son contraste serait celui de l'image, donc inconnu. La pastille de prix
// est marine plein, pour la même raison.
const OVERLAY_CARTE_CLASS =
  "grid aspect-square grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden p-0";
const OVERLAY_CARTOUCHE_CLASS =
  "z-[1] col-start-1 row-start-1 flex min-w-0 flex-col items-end gap-2 self-end p-3";

export function Card({
  children,
  media,
  title,
  titleAs,
  titleSize = "sm",
  titleAlign = "start",
  subtitle,
  description,
  contentGap = "sm",
  layout = "stack",
  href,
  fullHeight = false,
  testId,
}: CardProps) {
  const estLigne = layout === "row";
  const estOverlay = layout === "overlay";
  const BaliseTitre = titleAs ?? "h3";

  const classesCarte = [
    // Le `overflow-hidden` n'est posé QUE là où il rogne vraiment quelque chose : le visuel à
    // fleur de carte. Ailleurs il retirerait sans raison l'`overflow-visible` de HeroUI, dont
    // dépendent les surcouches (popover, tooltip) qui débordent d'une carte.
    media && !estLigne && !estOverlay ? "overflow-hidden" : "",
    estOverlay ? OVERLAY_CARTE_CLASS : "",
    estLigne ? "flex-row items-center gap-4" : "",
    href ? `${CLICKABLE_CLASS} ${ENFANTS_INTERACTIFS_CLASS}` : "",
    // `.card` de HeroUI est déjà `flex flex-col` (card.css) : `h-full` suffit à l'étirer, et
    // `justify-center` centre le bloc media+en-tête+contenu dans l'espace en trop plutôt que de le
    // laisser collé en haut avec un vide en dessous.
    fullHeight ? "h-full justify-center" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const tete =
    title || subtitle || description ? (
      // `text-center` sur l'EN-TÊTE, pas répété sur le titre : `text-align` est hérité, le
      // sous-titre/description en dessous se centrent avec lui sans classe supplémentaire.
      // `HeroUICard.Header`/`.Title` fusionnent ce `className` avec leurs classes `.card__*` par
      // défaut (composeSlotClassName de HeroUI) plutôt que de les remplacer.
      <HeroUICard.Header
        className={
          estOverlay
            ? "w-full rounded-xl bg-[var(--surface)] px-3 py-2 text-center text-[var(--surface-foreground)]"
            : titleAlign === "center"
              ? "text-center"
              : undefined
        }
      >
        {title ? (
          <HeroUICard.Title
            // `line-clamp-1` : une carte de grille (catalogue, listing) doit garder une hauteur
            // fixe indépendamment de la longueur du titre — sans ça, un titre de deux mots et un
            // titre de sept mots produisent deux cartes de hauteurs différentes sur la même ligne
            // de grille (constaté sur les cartes d'activité). Les deux usages restants de cet
            // atome (`OrderCard`) ont eux aussi des titres courts et déterministes (nom de
            // produit) — aucun besoin réel d'un titre multi-ligne à ce jour.
            className={`line-clamp-1 ${estOverlay ? "font-bold uppercase" : ""} ${TITLE_SIZE_CLASSES[titleSize]}`.trim()}
            render={(props) => <BaliseTitre {...props} />}
          >
            {href ? (
              // `data-card-link` plutôt que le sélecteur `a` : il désigne CE lien-là, et pas un
              // autre lien qui vivrait dans la carte — sinon focaliser ce dernier allumerait
              // l'anneau de toute la carte.
              <Link
                href={href}
                data-card-link=""
                className={OVERLAY_CLASS}
                data-testid={testId ? `${testId}-link` : undefined}
              >
                {title}
              </Link>
            ) : (
              title
            )}
          </HeroUICard.Title>
        ) : null}
        {/* `line-clamp-2` sur subtitle ET description, même raison que le titre ci-dessus : une
            carte de grille doit garder une hauteur fixe quelle que soit la longueur du texte. */}
        {subtitle ? <p className="line-clamp-2 text-xs text-muted">{subtitle}</p> : null}
        {description ? (
          <HeroUICard.Description className="line-clamp-2">{description}</HeroUICard.Description>
        ) : null}
      </HeroUICard.Header>
    ) : null;

  const corps = children ? (
    <HeroUICard.Content
      className={
        estOverlay
          ? "rounded-full bg-accent-foreground px-3 py-1 text-sm text-accent"
          : CONTENT_GAP_CLASSES[contentGap]
      }
    >
      {children}
    </HeroUICard.Content>
  ) : null;

  return (
    <HeroUICard className={classesCarte} data-testid={testId}>
      {media ? (
        <div
          className={
            estOverlay
              ? "col-start-1 row-start-1 min-h-0"
              : estLigne
              ? "w-16 shrink-0 overflow-hidden rounded-md"
              : // Annule le `p-4` de `.card` : le visuel touche les bords et se fait rogner au
                // rayon des angles par le `overflow-hidden` posé plus haut.
                "-mx-4 -mt-4"
          }
          data-testid={testId ? `${testId}-media` : undefined}
        >
          {media}
        </div>
      ) : null}
      {estOverlay ? (
        <div className={OVERLAY_CARTOUCHE_CLASS}>
          {corps}
          {tete}
        </div>
      ) : estLigne ? (
        // `min-w-0` : sans lui, un enfant flex refuse de descendre sous la largeur de son contenu
        // et un titre long pousse la vignette hors de la carte.
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {tete}
          {corps}
        </div>
      ) : (
        <>
          {tete}
          {corps}
        </>
      )}
    </HeroUICard>
  );
}
