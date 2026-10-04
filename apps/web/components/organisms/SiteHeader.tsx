"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@hifago/ui";
import { Link, useRouter } from "@/i18n/navigation";
import { empujarConservandoQuery } from "@/lib/navigation/conservarQuery";
import { IconLink } from "@/components/atoms/IconLink";
import { LinkButton } from "@/components/atoms/LinkButton";
import { LogoHifago } from "@/components/atoms/LogoHifago";
import { COLUMNA_PORTADA } from "@/components/atoms/PageShell";
import { useCart } from "@/lib/cart/CartContext";
import { LanguageSwitcher } from "./LanguageSwitcher";

// Le header de la vitrine (2026-09-02, vague 4). ⚠️ L'app n'en avait AUCUN : ni `<header>`, ni
// `<nav>`, ni `<footer>` nulle part. Ce composant introduit donc les premiers landmarks du site.
//
// ⚠️ `"use client"` obligatoire, et ici doublement : il lit le panier (état client) et importe le
// barrel `@hifago/ui`, dont le graphe fait planter `next build` dès qu'il atteint un Server
// Component (CLAUDE.md §11.16). C'est exactement le montage prescrit : `layout.tsx` reste un
// Server Component et rend ce fichier-ci.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// UN SEUL HEADER, L'OR DE L'ACCUEIL, SUR TOUTES LES PAGES (plan 41, item C1 ; arbitrage D2 = A)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Jusqu'au 2026-10-02, deux headers étrangers l'un à l'autre : celui de l'accueil (transparent,
// drapeaux, « Mi viaje » bleu poudre) et celui des autres pages (fond clair, bordure marine, bouton
// or pâle, menu burger). Il n'en reste qu'UNE apparence, l'état défilé de l'accueil : fond or,
// texte marine, sans bordure, ombre marine douce une fois la page défilée. L'accueil garde en plus
// son état transparent en haut de page (`transparente`), et il est le seul à ne pas porter le
// petit logo — le grand logo du héros tient ce rôle.
//
// ⚠️ PLUS DE MENU BURGER, et c'est ce qui rend le header plus simple à indexer : tout est en ligne,
// à toutes les largeurs. Le menu n'abritait plus que le compte et la langue, déjà visibles sur
// l'accueil. Les liens de langue (`/en/…`) restent donc dans le HTML SERVI sans panneau à ouvrir —
// c'est par eux que le maillage fait découvrir la version anglaise, et Google indexe la version
// MOBILE. `SiteHeader.test.tsx` le prouve en rendu SERVEUR.
//
// `/mi-viaje` (spec 27, renommé le 2026-09-15 depuis `/carrito` — recadrage "Mi viaje") est né le
// 2026-09-10 avec la spec 32 (panier en base) : bascule de `/pago` (le tunnel de paiement, qui ne
// porte plus la liste du panier) vers cette page.
const ROUTE_VIAJE = "/mi-viaje";

// L'architecture des pages de compte sera revue (décision de Jérôme, 2026-09-02) : une seule
// constante à changer ce jour-là. ⚠️ CHANGÉ le 2026-09-11 (spec 35, décision ⑧) : `/cuenta/perfil`
// est désormais l'accueil de la zone compte, pas `/cuenta/reservas` — qui reste atteignable depuis
// un lien sur cet écran.
//
// Ici depuis le plan 41 (C1) : elles vivaient dans `SiteMenu`, que le header ne rend plus (retrait
// à l'item G5, qui les importe d'ici en attendant). Une seule définition de la route, de l'icône et
// du choix compte / connexion — deux copies divergeraient au prochain déménagement de la zone.
export const ROUTE_COMPTE = "/cuenta/perfil";
export const ROUTE_CONNEXION = "/entrar";

export function IconeCompte() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-5 shrink-0">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

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
   * Pas de logo (le héros porte le grand), les langues à gauche (« ESP · ING » ; sous `md`, un seul
   * bouton vers l'autre langue). Une fois défilé, il est exactement le header des autres pages.
   * Choisi par la coquille (`CoquillaVitrine`), qui connaît la route.
   */
  transparente?: boolean;
  testId?: string;
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// L'OMBRE DU DÉFILEMENT — et, sur l'accueil, le fond
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Le header suit le défilement depuis le 2026-09-02 (demande de Jérôme). Sur l'accueil, transparent
// ET collant, il ferait défiler les sections SOUS les icônes, sans rien entre les deux : il prend
// donc l'or dès qu'on a quitté le haut de page. Sur toutes les pages, une ombre marine douce le
// détache du contenu qui passe dessous — il n'a plus de bordure basse (plan 41, C1).
//
// `useSyncExternalStore` et non un `useState` posé depuis un écouteur : React ne re-rend que quand
// le BOOLÉEN change (deux fois par aller-retour), pas à chaque événement de défilement, et le rendu
// serveur reçoit `false` — le HTML servi est celui du haut de page.
const SEUIL_DEFILEMENT_PX = 8;

// Hors du composant : une fonction d'abonnement recréée à chaque rendu ferait se réabonner React à
// chaque rendu.
function abonnerDefilement(alChanger: () => void) {
  window.addEventListener("scroll", alChanger, { passive: true });
  return () => window.removeEventListener("scroll", alChanger);
}

function useADefile() {
  return useSyncExternalStore(
    abonnerDefilement,
    () => window.scrollY > SEUIL_DEFILEMENT_PX,
    () => false
  );
}

// ⚠️ LE BOUTON « MI VIAJE », EN DESKTOP : l'aplat bleu poudre (Jérôme, 2026-10-02 : « on remet le
// bouton en bleu ciel pour le desktop », le mobile ne bouge pas). Le « bleu ciel » est ici le bleu
// poudre `--default` (#b6cde8), celui qu'avait le bouton plein avant d'être rendu plus discret —
// PAS le bleu ciel #619ccc de la charte : marine dessus, ce dernier mesure 4.44:1, sous le seuil de
// 4.5:1 d'un texte, et il reste décoratif (globals.css, « LA CHARTE »). Le bleu poudre : 8.02:1.
//
// Pourquoi pas deux boutons, un `outline` masqué au-dessus de `md` et un `solid` en dessous : deux
// fois le même lien dans le DOM. Le bouton reste donc `outline`, et ce `span` repose sur lui, à
// partir de `md`, les quatre variables que pose la variante `solid` (`Button.tsx`,
// `VARIANT_CLASSES`) — plus la bordure, passée à la couleur du fond pour garder exactement la même
// taille qu'en mobile. `[&>a]` (0,1,1) bat les utilitaires du bouton (0,1,0). `contents` : le `span`
// n'a pas de boîte, le bouton reste l'élément `flex` du header.
//
// Les angles de 8 px (Jérôme, même jour : « arrondir un peu les angles du bouton ») ne sont plus
// posés ici : depuis le plan 41 (item F4, arbitrage D4), c'est le rayon de TOUS les boutons, à
// toute largeur (`RADIUS_CLASS`, `Button.tsx`).
//
// ⚠️ Chaîne écrite en toutes lettres : Tailwind lit ce fichier comme du texte, une classe
// construite n'existerait pas dans le CSS compilé.
const BOUTON_VIAJE_DESKTOP =
  "contents md:[&>a]:[--button-bg:var(--btn-fill)] md:[&>a]:[--button-bg-hover:var(--btn-fill-hover)] md:[&>a]:[--button-bg-pressed:var(--btn-fill-hover)] md:[&>a]:[--button-fg:var(--btn-on-fill)] md:[&>a]:[border-color:var(--btn-fill)]";

// ⚠️ LA PASTILLE DU PANIER, MARINE ET CHIFFRE BLANC (plan 41, C1) : elle était or sur le bouton en
// contour de l'accueil mobile — une pastille or posée sur l'or n'a plus de forme, il n'en restait
// qu'un chiffre flottant. Le marine se lit sur l'or (6.31:1) comme sur le bleu poudre du bouton
// desktop (8.02:1), le blanc sur le marine à 13.07:1. Les jetons du bouton `marine` (F4), pas une
// couleur de plus. Le liseré (`--badge-border`, blanc par défaut) prend l'or du header : la
// pastille s'y découpe au lieu d'être cerclée d'une troisième couleur.
const PASTILLE_MARINE =
  "[--badge-bg:var(--bouton-marine)] [--badge-fg:var(--bouton-marine-texte)] [--badge-border:var(--accent)]";

// L'ombre portée une fois la page défilée — la même partout, accueil compris.
const OMBRE_DEFILE = "shadow-[0_8px_16px_-12px_color-mix(in_oklab,var(--accent-foreground)_60%,transparent)]";

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

// Le logo vit dans `components/atoms/LogoHifago.tsx` depuis le 2026-10-01 : il sert aussi la zone
// auth, et la règle veut qu'un composant partagé par deux endroits y remonte.

export function SiteHeader({ isAuthenticated, transparente = false, testId }: SiteHeaderProps) {
  const t = useTranslations("Chrome");
  const router = useRouter();
  const { lines } = useCart();
  const aDefile = useADefile();

  // ⚠️ CE QUE LA PASTILLE COMPTE : le nombre de LIGNES du panier, pas la somme des quantités
  // (décision de Jérôme, 2026-09-02). Une réservation « Paseo en lancha, 3 personnes » est UNE
  // chose sélectionnée, pas trois. C'est écrit ici parce que c'est exactement le genre de décision
  // qu'un futur lecteur inverserait « pour corriger un bug ».
  const nombreArticles = lines.length;

  // ⚠️ UN BOUTON À LIBELLÉ VISIBLE, plus une icône seule (demande de Jérôme, 2026-10-02 : « l'icône
  // Mi viaje et le texte Mi Viaje en Guatapé dans un bouton bien visible »). `LinkButton` et non
  // `IconLink` : c'est un lien (clic du milieu, favori), et il a désormais un texte à montrer.
  //
  // Le même sur toutes les pages depuis C1 : `outline` neutre sous `md` (contour marine, F3 :
  // 6.31:1 sur l'or), aplat bleu poudre au-dessus (`BOUTON_VIAJE_DESKTOP`). L'ancien `soft` accent
  // des pages claires (or pâle) n'a plus de fond clair où se poser.
  const boutonViaje = (
    <span className={BOUTON_VIAJE_DESKTOP}>
      <LinkButton
        href={ROUTE_VIAJE}
        variant="outline"
        color="neutral"
        iconBefore={<IconeViaje />}
        testId={testId ? `${testId}-cart` : undefined}
      >
        {/* ⚠️ Le libellé PEUT passer sur deux lignes, et ne le fait que faute de place : mesuré à
            390 px sur l'accueil, langues + bouton sur une ligne + compte poussaient l'icône du
            compte HORS de l'écran. `.button` de HeroUI pose `whitespace-nowrap` ; ce `span` le lève
            pour son seul texte, ce qui rend au bouton une largeur minimale (celle du mot le plus
            long) et le laisse rétrécir dans le `flex` du header. Deux lignes de 14 px tiennent dans
            ses 44 px. */}
        {/* ⚠️ « Mi viaje » seul SOUS `md`, « Mi viaje en Guatapé » au-dessus (demande de Jérôme,
            2026-10-02, vue mobile). Le lieu est BALISÉ dans le message (`<lugar>`) plutôt que porté
            par une seconde clé : la phrase reste entière pour qui la traduit. `hidden` le sort aussi
            du nom accessible — celui-ci reste donc égal au texte affiché à chaque largeur. */}
        <span className="whitespace-normal text-left leading-tight">
          {t.rich("tripLabel", {
            lugar: (morceaux) => <span className="hidden md:inline">{morceaux}</span>,
          })}
        </span>
        {/* ⚠️ Le compte est DANS le nom accessible, en toutes lettres et au pluriel de la langue :
            un « 3 » posé dans une pastille s'annonce n'importe comment. La pluralisation est celle
            de next-intl (ICU), pas une concaténation — « 1 servicio » / « 2 servicios ». En
            `sr-only` À LA SUITE du libellé visible, et pas en `aria-label` : le nom annoncé commence
            ainsi par le texte affiché, ce qu'exige la commande vocale (WCAG 2.5.3). */}
        <span className="sr-only">{t("tripCount", { count: nombreArticles })}</span>
      </LinkButton>
    </span>
  );

  const panier =
    nombreArticles > 0 ? (
      // ⚠️ `min-w-0 shrink` : HeroUI pose `shrink-0` sur `.badge-anchor` (mesuré au rendu), ce qui
      // interdisait au bouton de rétrécir — c'est l'icône du compte, à côté, qui s'écrasait à 16 px.
      <Badge.Anchor className="min-w-0 shrink">
        {boutonViaje}
        <Badge color="default" size="sm" placement="top-right" className={PASTILLE_MARINE}>
          {/* ⚠️ Au-delà de 99, on affiche « 99+ » : trois chiffres élargissent la pastille au point
              de déborder du bouton, et le compte exact n'apprend plus rien à ce stade. Le nom
              accessible du lien, lui, garde le nombre réel. */}
          <Badge.Label>{nombreArticles > 99 ? "99+" : nombreArticles}</Badge.Label>
        </Badge>
      </Badge.Anchor>
    ) : (
      // Panier vide : pas de pastille « 0 ». Un zéro permanent est du bruit, et le nom accessible
      // dit déjà « Mi viaje en Guatapé, vacío ».
      boutonViaje
    );

  const navigation = (
    <nav aria-label={t("navLabel")} className="flex items-center gap-1">
      {panier}
      {/* ⚠️ `shrink-0` : sans lui, quand la place manque, le `flex` répartit le manque au prorata et
          écrase l'icône (16 px mesurés à 390) avant que le bouton « Mi viaje » ait fini de passer
          sur deux lignes. `IconLink` n'a pas de `className` (README). */}
      <div className="shrink-0">
        <IconLink
          href={isAuthenticated ? ROUTE_COMPTE : ROUTE_CONNEXION}
          icon={<IconeCompte />}
          label={isAuthenticated ? t("accountLabel") : t("loginLabel")}
          testId={testId ? `${testId}-account` : undefined}
        />
      </div>
    </nav>
  );

  const langues = <LanguageSwitcher apariencia="banderas" testId={testId ? `${testId}-language` : undefined} />;

  // ⚠️ `data-superficie="or"` (plan 41, F3) : le header est posé sur l'or, défilé ou non — il en
  // prend donc les jetons (contour, focus et texte discret en marine). Déclaré ICI et non hérité du
  // <body> : les popovers rendus au bout du <body> doivent garder ceux du clair. La surface peint
  // son fond en couche `base` : `bg-transparent` la bat sur le haut de l'accueil.
  //
  // `fixed` sur l'accueil et non `sticky` : le header doit SORTIR du flux pour que le héros commence
  // sous lui, tout en haut de l'écran (`PageShell variant="portada"`). `sticky` ailleurs : il occupe
  // sa hauteur dans le flux, le contenu commence dessous. `z-50` dans les deux cas.
  return (
    <header
      data-superficie="or"
      className={`${transparente ? "fixed inset-x-0" : "sticky"} top-0 z-50 transition-[background-color,box-shadow] duration-200 ${
        transparente && !aDefile ? "bg-transparent" : "bg-accent"
      } ${aDefile ? OMBRE_DEFILE : ""}`}
      data-defile={aDefile ? "" : undefined}
      data-testid={testId}
    >
      {/* `COLUMNA_PORTADA` : la colonne de l'accueil, importée et non recopiée — le header tombe à
          l'aplomb du contenu de toutes les pages (`PageShell variant="pagina"`, F7). `h-16` : le
          héros de l'accueil réserve exactement cette hauteur au-dessus de son logo. */}
      <div className={`${COLUMNA_PORTADA} flex h-16 items-center justify-between gap-2`}>
        {transparente ? (
          langues
        ) : (
          // ⚠️ Le logo n'est PAS un <h1> : le titre appartient au contenu de la page, et huit pages
          // le perdraient au profit de la marque. C'est un lien vers l'accueil, et son nom
          // accessible le dit. `min-h-11` pour la cible tactile, comme les boutons.
          // ⚠️ `href="/"` reste STATIQUE ; la query string active est ajoutée au clic par
          // `empujarConservandoQuery`, qui porte le raisonnement (dégradation sans JS, pourquoi
          // jamais `useSearchParams()`). Bug Jérôme du 2026-09-16 : cliquer le logo effaçait les
          // filtres actifs.
          <Link
            href="/"
            aria-label={t("homeLabel")}
            onClick={(evenement) => {
              evenement.preventDefault();
              empujarConservandoQuery(router, "/");
            }}
            className="inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius)] px-1 focus-visible:status-focused"
            data-testid={testId ? `${testId}-home` : undefined}
          >
            {/* La déclinaison SANS or (asset A1) : le « GO » or du logo disparaîtrait sur l'or. */}
            <LogoHifago variante="sobre" />
          </Link>
        )}
        {transparente ? (
          navigation
        ) : (
          // Les langues À CÔTÉ du `<nav>` principal, pas dedans : `LanguageSwitcher` rend son propre
          // `<nav>` nommé, et deux landmarks imbriqués s'annoncent mal. C'est la disposition de
          // l'accueil, où les deux `<nav>` sont aussi voisins. L'écart de `sm` est celui des deux
          // langues entre elles : sans lui, « ING » collait au bouton « Mi viaje » (vu à 1 280 px).
          <div className="flex min-w-0 items-center gap-1 sm:gap-3">
            {langues}
            {navigation}
          </div>
        )}
      </div>
    </header>
  );
}
