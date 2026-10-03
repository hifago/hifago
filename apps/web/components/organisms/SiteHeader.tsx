"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@hifago/ui";
import { Link, useRouter } from "@/i18n/navigation";
import { empujarConservandoQuery } from "@/lib/navigation/conservarQuery";
import { IconButton } from "@/components/atoms/IconButton";
import { IconLink } from "@/components/atoms/IconLink";
import { LinkButton } from "@/components/atoms/LinkButton";
import { LogoHifago } from "@/components/atoms/LogoHifago";
import { COLUMNA_PORTADA } from "@/components/atoms/PageShell";
import { useCart } from "@/lib/cart/CartContext";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { IconeCompte, ROUTE_COMPTE, ROUTE_CONNEXION, SiteMenu } from "./SiteMenu";

// Le header de la vitrine (2026-09-02, vague 4). ⚠️ L'app n'en avait AUCUN : ni `<header>`, ni
// `<nav>`, ni `<footer>` nulle part. Ce composant introduit donc les premiers landmarks du site.
//
// ⚠️ `"use client"` obligatoire, et ici doublement : il lit le panier (état client) et importe le
// barrel `@hifago/ui`, dont le graphe fait planter `next build` dès qu'il atteint un Server
// Component (CLAUDE.md §11.16). C'est exactement le montage prescrit : `layout.tsx` reste un
// Server Component et rend ce fichier-ci.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// UN SEUL BALISAGE, QUI SE RÉORGANISE — et pourquoi ce n'est pas négociable
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Deux `<header>`, un mobile et un desktop dont l'un serait masqué, donneraient deux fois les
// mêmes liens dans le DOM : contenu dupliqué, deux fois les mêmes cibles pour un lecteur d'écran,
// et deux versions qui divergent au premier ajout. Ici il n'y a qu'un balisage :
//
//   - le logo et le panier sont visibles à toutes les largeurs ;
//   - le compte et la langue vivent dans UN panneau, toujours présent dans le HTML, qui est replié
//     sous `md` (768 px) et rendu en ligne au-dessus ;
//   - le bouton de menu, lui, n'existe que sous `md` — c'est un CONTRÔLE, pas du contenu : le
//     masquer selon la largeur ne retire rien de l'index.
//
// ⚠️ LE PIÈGE QUE CETTE ARCHITECTURE ÉVITE, et il touche directement le lot SEO de la veille :
// Google indexe la version MOBILE. Un menu monté à la demande (`{ouvert && <Menu/>}`) ne
// contiendrait ses liens qu'après un clic — donc les liens `/en/…` du sélecteur de langue, qui
// sont ce qui fait découvrir la version anglaise par le maillage interne, seraient absents du seul
// HTML que Googlebot voit. Le panneau est donc rendu puis masqué (`hidden`), jamais conditionné.
// `SiteHeader.test.tsx` le prouve en rendu SERVEUR, pas sur le DOM hydraté — les deux ne disent
// pas la même chose et c'est le second qui ment.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// DEUX DESTINATIONS, ISOLÉES EXPRÈS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Les routes de compte vivent dans `SiteMenu`, où sont leurs liens.
//
// `/mi-viaje` (spec 27, renommé le 2026-09-15 depuis `/carrito` — recadrage "Mi viaje") est né le
// 2026-09-10 avec la spec 32 (panier en base) : bascule de `/pago` (le tunnel de paiement, qui ne
// porte plus la liste du panier) vers cette page.
const ROUTE_VIAJE = "/mi-viaje";

export type SiteHeaderProps = {
  /**
   * ⚠️ Résolu côté SERVEUR et passé en prop : ce composant est client, il ne peut pas appeler
   * `supabase.auth.getUser()` lui-même. Même geste que `CheckoutForm`, qui reçoit déjà son
   * `isAuthenticated` de `pago/page.tsx`.
   */
  isAuthenticated: boolean;
  /**
   * L'ACCUEIL (maquette fournie par Jérôme le 2026-10-01) : le header est posé PAR-DESSUS le héros,
   * sans fond tant que la page n'a pas défilé — l'illustration de la rue aux zócalos passe dessous.
   * Pas de logo (le héros porte le grand), les deux langues en ligne à gauche (« ESP · ING » ; sous
   * `md`, un seul bouton vers l'autre langue),
   * Mi viaje et Mi cuenta à droite, visibles à toutes les largeurs : il n'y a plus rien à replier
   * derrière un bouton de menu. Choisi par la coquille (`CoquillaVitrine`), qui connaît la route.
   */
  transparente?: boolean;
  testId?: string;
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// LE HEADER TRANSPARENT RESTE COLLANT — et c'est pour ça qu'il lui faut un fond une fois défilé
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Le header suit le défilement depuis le 2026-09-02 (demande de Jérôme). Transparent ET collant,
// il ferait défiler les sections SOUS les icônes, sans rien entre les deux — illisible dès la
// première photo. Il prend donc l'or de la page dès qu'on a quitté le haut : transparent sur le
// héros, comme la maquette, opaque partout ailleurs.
//
// `useSyncExternalStore` et non un `useState` posé depuis un écouteur : React ne re-rend que quand
// le BOOLÉEN change (deux fois par aller-retour), pas à chaque événement de défilement, et le rendu
// serveur reçoit `false` — le HTML servi est celui du haut de page, transparent.
const SEUIL_DEFILEMENT_PX = 8;

// Hors du composant : une fonction d'abonnement recréée à chaque rendu ferait se réabonner React à
// chaque rendu.
function abonnerDefilement(alChanger: () => void) {
  window.addEventListener("scroll", alChanger, { passive: true });
  return () => window.removeEventListener("scroll", alChanger);
}

function useADefile(actif: boolean) {
  return useSyncExternalStore(
    abonnerDefilement,
    () => actif && window.scrollY > SEUIL_DEFILEMENT_PX,
    () => false
  );
}

// ⚠️ LE BOUTON « MI VIAJE » DE L'ACCUEIL, EN DESKTOP : de nouveau l'aplat bleu poudre (Jérôme,
// 2026-10-02 : « on remet le bouton en bleu ciel pour le desktop », le mobile ne bouge pas). Le
// « bleu ciel » est ici le bleu poudre `--default` (#b6cde8), celui qu'avait le bouton plein avant
// d'être rendu plus discret — PAS le bleu ciel #619ccc de la charte : marine dessus, ce dernier
// mesure 4.44:1, sous le seuil de 4.5:1 d'un texte, et il reste décoratif (globals.css, « LA
// CHARTE »). Le bleu poudre : 8.02:1.
//
// Pourquoi pas deux boutons, un `outline` masqué au-dessus de `md` et un `solid` en dessous : deux
// fois le même lien dans le DOM, exactement ce que l'en-tête de ce fichier refuse. Le bouton reste
// donc `outline`, et ce `span` repose sur lui, à partir de `md`, les quatre variables que pose la
// variante `solid` (`Button.tsx`, `VARIANT_CLASSES`) — plus la bordure, passée à la couleur du fond
// pour garder exactement la même taille qu'en mobile. `[&>a]` (0,1,1) bat les utilitaires du bouton
// (0,1,0). `contents` : le `span` n'a pas de boîte, le bouton reste l'élément `flex` du header.
//
// Les angles de 8 px (Jérôme, même jour : « arrondir un peu les angles du bouton ») ne sont plus
// posés ici : depuis le plan 41 (item F4, arbitrage D4), c'est le rayon de TOUS les boutons, à
// toute largeur (`RADIUS_CLASS`, `Button.tsx`).
//
// ⚠️ Chaîne écrite en toutes lettres : Tailwind lit ce fichier comme du texte, une classe
// construite n'existerait pas dans le CSS compilé.
const BOUTON_VIAJE_DESKTOP =
  "contents md:[&>a]:[--button-bg:var(--btn-fill)] md:[&>a]:[--button-bg-hover:var(--btn-fill-hover)] md:[&>a]:[--button-bg-pressed:var(--btn-fill-hover)] md:[&>a]:[--button-fg:var(--btn-on-fill)] md:[&>a]:[border-color:var(--btn-fill)]";

// SVG inline : `lucide-react` est présent dans node_modules mais déclaré par `packages/ui`, PAS par
// `apps/web` — l'importer créerait la dépendance fantôme qui a cassé le build Vercel le
// 2026-08-23. Les glyphes héritent de la couleur par `currentColor` et sont décoratifs : le nom
// accessible est porté par le lien.
function IconeViaje() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 20a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2" />
      <path d="M8 18V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14" />
      <path d="M10 20h4" />
      <circle cx="16" cy="20" r="2" />
      <circle cx="8" cy="20" r="2" />
    </svg>
  );
}

// ⚠️ Le glyphe du bouton de menu. Jérôme parlait d'une « icône param » — un engrenage annonce des
// RÉGLAGES, or il n'y en a aucun sur ce site : ce bouton ouvre un menu. Trois barres sont le seul
// glyphe que tout le monde lit comme « menu », et le nom accessible le dit de toute façon en
// toutes lettres. À trancher au rendu.
function IconeMenu() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function IconeFermer() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// Le logo vit dans `components/atoms/LogoHifago.tsx` depuis le 2026-10-01 : il sert aussi la zone
// auth, et la règle veut qu'un composant partagé par deux endroits y remonte.

export function SiteHeader({ isAuthenticated, transparente = false, testId }: SiteHeaderProps) {
  const t = useTranslations("Chrome");
  const router = useRouter();
  const { lines } = useCart();
  const [menuOuvert, setMenuOuvert] = useState(false);
  const idMenu = useId();
  // ⚠️ Une ref sur le CONTENEUR, pas sur le bouton : `IconButton` n'expose pas de `ref` — le
  // README interdit `forwardRef` dans ce dépôt, et aucun composant n'en a. Le focus se rend donc
  // en retrouvant le <button> dans son enveloppe, ce qui ne demande rien à l'atome.
  const enveloppeBouton = useRef<HTMLDivElement>(null);
  const aDefile = useADefile(transparente);

  // ⚠️ CE QUE LA PASTILLE COMPTE : le nombre de LIGNES du panier, pas la somme des quantités
  // (décision de Jérôme, 2026-09-02). Une réservation « Paseo en lancha, 3 personnes » est UNE
  // chose sélectionnée, pas trois. C'est écrit ici parce que c'est exactement le genre de décision
  // qu'un futur lecteur inverserait « pour corriger un bug ».
  const nombreArticles = lines.length;

  // `Échap` ferme le menu ET rend le focus au bouton : sans ce retour, le focus reste sur un
  // élément devenu masqué et la tabulation repart du début du document.
  useEffect(() => {
    if (!menuOuvert) return;
    const surTouche = (evenement: KeyboardEvent) => {
      if (evenement.key !== "Escape") return;
      setMenuOuvert(false);
      enveloppeBouton.current?.querySelector("button")?.focus();
    };
    document.addEventListener("keydown", surTouche);
    return () => document.removeEventListener("keydown", surTouche);
  }, [menuOuvert]);

  // ⚠️ UN BOUTON À LIBELLÉ VISIBLE, plus une icône seule (demande de Jérôme, 2026-10-02 : « l'icône
  // Mi viaje et le texte Mi Viaje en Guatapé dans un bouton bien visible »). `LinkButton` et non
  // `IconLink` : c'est un lien (clic du milieu, favori), et il a désormais un texte à montrer.
  //
  // ⚠️ PLUS DISCRET qu'un aplat (Jérôme, même jour : « un peu plus discret ») — et pas la même
  // variante sur les deux fonds, comparé en capture à 390 px :
  //   - page claire : `soft` accent, une teinte d'or pâle, texte à 80 % marine. Le contour or serait
  //     une bordure à 1.96:1 sur le clair, sous le seuil de 3:1 d'un composant (charte, point 1) ;
  //   - accueil : `outline` neutre, texte marine sur l'or. Le `soft` neutre y est un bleu poudre à
  //     50 % mêlé à l'or — un kaki terne. ⚠️ SOUS `md` seulement : au-dessus, l'aplat bleu poudre
  //     revient (`BOUTON_VIAJE_DESKTOP`, en tête de fichier). Son contour lit `--muted` : bleu moyen
  //     jusqu'au 2026-10-02 (3.17:1 sur l'or), MARINE depuis que le header porte la surface or
  //     (plan 41, F3 : 6.31:1).
  const couleurBouton = transparente ? "neutral" : "accent";
  const boutonViaje = (
    <LinkButton
      href={ROUTE_VIAJE}
      variant={transparente ? "outline" : "soft"}
      color={couleurBouton}
      iconBefore={<IconeViaje />}
      testId={testId ? `${testId}-cart` : undefined}
    >
      {/* ⚠️ Le libellé PEUT passer sur deux lignes, et ne le fait que faute de place : mesuré à
          390 px sur l'accueil, langues + bouton sur une ligne + compte poussaient l'icône du compte
          HORS de l'écran. `.button` de HeroUI pose `whitespace-nowrap` ; ce `span` le lève pour son
          seul texte, ce qui rend au bouton une largeur minimale (celle du mot le plus long) et le
          laisse rétrécir dans le `flex` du header. Deux lignes de 14 px tiennent dans ses 44 px. */}
      {/* ⚠️ « Mi viaje » seul SOUS `md`, « Mi viaje en Guatapé » au-dessus (demande de Jérôme,
          2026-10-02, vue mobile). Le lieu est BALISÉ dans le message (`<lugar>`) plutôt que porté
          par une seconde clé : la phrase reste entière pour qui la traduit. `hidden` le sort aussi
          du nom accessible — celui-ci reste donc égal au texte affiché à chaque largeur. */}
      <span className="whitespace-normal text-left leading-tight">
        {t.rich("tripLabel", {
          lugar: (morceaux) => <span className="hidden md:inline">{morceaux}</span>,
        })}
      </span>
      {/* ⚠️ Le compte est DANS le nom accessible, en toutes lettres et au pluriel de la langue : un
          « 3 » posé dans une pastille s'annonce n'importe comment. La pluralisation est celle de
          next-intl (ICU), pas une concaténation — « 1 servicio » / « 2 servicios ». En `sr-only`
          À LA SUITE du libellé visible, et pas en `aria-label` : le nom annoncé commence ainsi par
          le texte affiché, ce qu'exige la commande vocale (WCAG 2.5.3, « label in name »). */}
      <span className="sr-only">{t("tripCount", { count: nombreArticles })}</span>
    </LinkButton>
  );
  const lienPanier = transparente ? <span className={BOUTON_VIAJE_DESKTOP}>{boutonViaje}</span> : boutonViaje;

  const panier =
    nombreArticles > 0 ? (
      // ⚠️ `min-w-0 shrink` : HeroUI pose `shrink-0` sur `.badge-anchor` (mesuré au rendu), ce qui
      // interdisait au bouton de rétrécir — c'est l'icône du compte, à côté, qui s'écrasait à 16 px.
      <Badge.Anchor className="min-w-0 shrink">
        {lienPanier}
        {/* ⚠️ La pastille prend la couleur que le bouton N'A PAS : une pastille or sur un bouton or
            (ou bleu poudre sur bleu poudre) ne serait qu'un chiffre flottant sans pastille. */}
        <Badge color={couleurBouton === "accent" ? "default" : "accent"} size="sm" placement="top-right">
          {/* ⚠️ Au-delà de 99, on affiche « 99+ » : trois chiffres élargissent la pastille au point
              de déborder du bouton, et le compte exact n'apprend plus rien à ce stade. Le nom
              accessible du lien, lui, garde le nombre réel. */}
          <Badge.Label>{nombreArticles > 99 ? "99+" : nombreArticles}</Badge.Label>
        </Badge>
      </Badge.Anchor>
    ) : (
      // Panier vide : pas de pastille « 0 ». Un zéro permanent est du bruit, et le nom accessible
      // dit déjà « Mi viaje en Guatapé, vacío ».
      lienPanier
    );

  if (transparente) {
    return (
      // `fixed` et non `sticky` : le header doit SORTIR du flux pour que le héros commence sous lui,
      // tout en haut de l'écran (la page s'en charge — `PageShell variant="portada"`). `z-50`, comme
      // l'autre variante. Les couleurs du texte viennent de la page : marine sur or.
      //
      // `data-superficie="or"` (plan 41, item F3) : le header est posé sur l'or, défilé ou non — il
      // en prend donc les jetons (contour, focus et texte discret en marine). Déclaré ICI et non
      // hérité du <body> : les popovers rendus au bout du <body> doivent garder ceux du clair. Son
      // fond reste transparent avant défilement : la surface peint en couche `base`, que
      // `bg-transparent` bat.
      <header
        data-superficie="or"
        className={`fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow] duration-200 ${
          aDefile
            ? "bg-accent shadow-[0_8px_16px_-12px_color-mix(in_oklab,var(--accent-foreground)_60%,transparent)]"
            : "bg-transparent"
        }`}
        data-defile={aDefile ? "" : undefined}
        data-testid={testId}
      >
        {/* `COLUMNA_PORTADA` : la colonne du héros, importée et non recopiée — les drapeaux tombent
            ainsi à l'aplomb du logo, comme sur la maquette. `h-16` : le héros réserve exactement
            cette hauteur au-dessus de son logo (`PortadaInicio`). */}
        <div className={`${COLUMNA_PORTADA} flex h-16 items-center justify-between gap-2`}>
          <LanguageSwitcher apariencia="banderas" testId={testId ? `${testId}-language` : undefined} />
          <nav aria-label={t("navLabel")} className="flex items-center gap-1">
            {panier}
            {/* Le compte, hors du panneau `SiteMenu` : rien d'autre n'y serait rangé ici, et la
                maquette ne prévoit aucun bouton de menu. Même route, même icône, même choix
                compte / connexion — importés de `SiteMenu`, jamais recopiés. */}
            {/* ⚠️ `shrink-0` : sans lui, quand la place manque, le `flex` répartit le manque au
                prorata et écrase l'icône (16 px mesurés à 390) avant que le bouton « Mi viaje »
                ait fini de passer sur deux lignes. `IconLink` n'a pas de `className` (README). */}
            <div className="shrink-0">
              <IconLink
                href={isAuthenticated ? ROUTE_COMPTE : ROUTE_CONNEXION}
                icon={<IconeCompte />}
                label={isAuthenticated ? t("accountLabel") : t("loginLabel")}
                testId={testId ? `${testId}-account` : undefined}
              />
            </div>
          </nav>
        </div>
      </header>
    );
  }

  return (
    // `sticky top-0` : le header suit le défilement (demande de Jérôme). `z-50` le place au-dessus
    // du contenu, et le fond est opaque — sans lui le texte défilerait visiblement dessous.
    //
    // L'accueil, seule page posée sur l'or, a sa propre variante (`transparente`, plus haut) : la
    // version or-sur-or de ce header, pilotée par `:has()`, a disparu avec elle le 2026-10-01.
    <header
      className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--background)]"
      data-testid={testId}
    >
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-2 px-4 py-2">
        {/* ⚠️ Le logo n'est PAS un <h1> : le titre appartient au contenu de la page, et huit pages
            le perdraient au profit de la marque. C'est un lien vers l'accueil, et son nom
            accessible le dit. `min-h-11` pour la cible tactile, comme les deux boutons.
            ⚠️ `href="/"` reste STATIQUE ; la query string active est ajoutée au clic par
            `empujarConservandoQuery`, qui porte le raisonnement (dégradation sans JS, pourquoi
            jamais `useSearchParams()`). Bug Jérôme du 2026-09-16 : cliquer le logo effaçait les
            filtres actifs. */}
        <Link
          href="/"
          aria-label={t("homeLabel")}
          onClick={(evenement) => {
            evenement.preventDefault();
            empujarConservandoQuery(router, "/");
          }}
          className="inline-flex min-h-11 items-center rounded-[var(--radius)] px-1 focus-visible:status-focused"
          data-testid={testId ? `${testId}-home` : undefined}
        >
          <LogoHifago />
        </Link>

        <nav aria-label={t("navLabel")} className="flex items-center gap-1">
          {/* Le panier est visible à TOUTES les largeurs : c'est l'action qui compte sur ce site,
              elle ne se cache pas derrière un menu. */}
          {panier}

          {/* Le panneau de navigation, extrait dans `SiteMenu` : une liste d'entrées puis la
              langue en bas, repliée sous `md` et rendue en ligne au-dessus. Un seul balisage — voir
              l'en-tête de ce fichier et celui de SiteMenu. */}
          <SiteMenu
            isAuthenticated={isAuthenticated}
            isOpen={menuOuvert}
            id={idMenu}
            testId={testId ? `${testId}-menu` : undefined}
          />

          {/* Le bouton de menu : un CONTRÔLE, donc masquable selon la largeur sans rien retirer de
              l'index — contrairement au contenu qu'il commande. */}
          <div ref={enveloppeBouton} className="md:hidden">
            <IconButton
              icon={menuOuvert ? <IconeFermer /> : <IconeMenu />}
              label={menuOuvert ? t("menuCloseLabel") : t("menuOpenLabel")}
              isExpanded={menuOuvert}
              controlsId={idMenu}
              onPress={() => setMenuOuvert((etat) => !etat)}
              testId={testId ? `${testId}-menu-toggle` : undefined}
            />
          </div>
        </nav>
      </div>
    </header>
  );
}
