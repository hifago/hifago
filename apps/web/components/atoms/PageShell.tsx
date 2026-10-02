import type { ReactNode } from "react";

// La coquille d'une page publique : son unique <main>, et sa largeur. Créée le 2026-09-01
// (vague 1 des atomes, prompts/vague1-agent-A.md §3.1) parce que ce gabarit était copié à
// l'identique dans les huit pages de app/[locale]/**.
//
// Trois écarts assumés par rapport au copier-coller relevé ce jour-là :
//   1. `gap-6` partout. Le code existant portait `gap-4` sur deux pages (fiche produit,
//      établissement) et `gap-6` sur les six autres : une dérive, pas une décision. D'où aussi
//      l'ABSENCE de prop `gap` — exposer une prop pour une dérive accidentelle, c'est la figer.
//   2. `p-6 sm:p-8` au lieu de `p-8` partout : 64 px de marge horizontale sur un écran de 390 px,
//      c'est un sixième de la largeur. Mobile d'abord, comme l'exige components/README.md.
//   3. Le `text-center` de verify-email n'est PAS repris dans `centered` : c'est l'alignement du
//      contenu de cette page-là, pas la coquille.
//
// ⚠️ Ne rend NI <h1>, NI <header>, NI <footer>. Un titre rendu par la coquille est la faute qui
// produit trois <h1> par page : le niveau est porté par Title (prop `as`) et décidé par la page.
// <header>/<footer> iront dans app/[locale]/layout.tsx en vague 2 (SiteHeader/SiteFooter) — pas de
// props `header`/`footer` ici, le README interdit l'anticipation.
//
// ⚠️ Ce fichier n'importe RIEN de "@hifago/ui", volontairement : plusieurs des pages qui
// consommeront cette coquille sont des Server Components, et faire entrer le barrel dans leur
// graphe de modules fait planter `next build` (CLAUDE.md §11.16). Les variantes sont des classes
// fixes, `cn` n'a donc rien à fusionner ici.
export type PageShellProps = {
  children: ReactNode;
  /**
   * Pas de valeur par défaut : chaque page choisit explicitement sa largeur. `portada` est la seule
   * qui n'en impose AUCUNE — voir `COLUMNA_PORTADA` plus bas.
   */
  variant: "large" | "narrow" | "centered" | "portada";
  /**
   * `"acento"` pose TOUTE la page sur l'or de la charte — <body> et header compris, sans bande
   * claire entre les sections (l'accueil, demande de Jérôme du 2026-10-01). La coquille ne fait que
   * le DÉCLARER, par deux attributs que lit `globals.css` :
   *   - `data-fondo="acento"` : le fond or est propagé par `:has()` au <body>, rendu par le layout,
   *     qui ne sait pas sur quelle page il est ;
   *   - `data-superficie="or"` (plan 41, item F3) : le <main> devient une SURFACE or, qui redéfinit
   *     ce qui s'y lit — texte discret, lien, focus, bordures en marine. Le <body> ne la reçoit
   *     jamais : les popovers y sont rendus, sur fond blanc, et doivent garder les valeurs du clair.
   * Absent = le fond de page normal, la surface claire du thème.
   */
  fondo?: "acento";
  testId?: string;
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// `large` EST UNE GRILLE À TROIS COLONNES, ET C'EST CE QUI PERMET LE FOND PERDU (2026-10-01)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Constat au rendu (capture Playwright/Edge sur Storybook, `Écrans/Accueil`, 1280×900) : avec
// `max-w-3xl`, une page de catalogue n'occupait que 704 px utiles sur un écran de 1280 — 256 px de
// vide à gauche ET à droite — et un carrousel de 8 cartes n'en montrait que 2,6. Décision de
// Jérôme : sur desktop, les rangées de cartes vont d'un bord à l'autre de l'écran, le texte et la
// recherche restent dans la colonne de lecture.
//
// Une colonne de lecture de 704 px NE PEUT PAS contenir un enfant plus large qu'elle sans le
// sortir de force. Les deux façons de le faire :
//   1. `width: 100vw; margin-inline: calc(50% - 50vw)` — REFUSÉE. `100vw` compte la gouttière de
//      l'ascenseur vertical (~15 px sur Windows), donc l'enfant dépasse le viewport de 15 px et la
//      PAGE défile horizontalement : interdit par `.claude/rules/ui.md`. La réparer demande un
//      `overflow-x: clip` global, c'est-à-dire payer un réglage de document pour un bug d'unité.
//   2. Celle-ci : la coquille n'est plus une colonne, c'est une grille `1fr | lecture | 1fr`.
//      Un enfant ordinaire se pose dans la colonne du milieu (il ne sait même pas que la grille
//      existe), un enfant `data-bleed` prend les trois (`col-span-full`) et touche donc les bords
//      réels du <main>, qui fait exactement la largeur du viewport. Aucune unité `vw`, aucun
//      débordement possible, aucun réglage global.
//
// ⚠️ La colonne du milieu REPRODUIT AU PIXEL la boîte de contenu d'avant, elle ne la redéfinit pas :
// `max-w-3xl` (48rem) comptait le padding DANS sa largeur, donc le contenu valait 48rem − 3rem =
// 45rem à partir de 640 px de large… et 48rem − 4rem = 44rem au-delà de `sm`. D'où `min(45rem,
// 100% − 3rem)` puis `min(44rem, 100% − 4rem)` : à 390 px on retrouve 342 px, à 1280 px on retrouve
// 704 px — exactement les valeurs d'avant ce lot. Le padding horizontal a disparu (`py-*` seul) :
// il EST les deux colonnes latérales maintenant, et un enfant à fond perdu doit pouvoir les
// traverser. `gap-y-6` et non `gap-6` pour la même raison — un `column-gap` rognerait les colonnes.
//
// ⚠️ `content-start` : `flex-1` fait grandir le <main> jusqu'au pied de page, et `align-content`
// vaut `stretch` par défaut en grille (contrairement à une colonne flex). Sans lui, les sections
// s'étireraient pour remplir la hauteur restante.
//
// ⚠️ `:not([data-bleed])` plutôt qu'un simple `[&>*]:col-start-2` : les deux règles porteraient
// sinon la même spécificité (0,1,0) et c'est l'ORDRE dans la feuille compilée qui trancherait —
// une variante Tailwind est écrite après l'utilitaire nu, donc `col-start-2` écraserait
// `col-span-full` et l'enfant s'étalerait de la colonne 2 à la 3. Exclure l'enfant marqué du
// sélecteur supprime le conflit au lieu de le gagner.
//
// Chaînes littérales complètes, jamais construites par concaténation : Tailwind v4 scanne ce
// fichier par glob (@source dans app/globals.css) et ne voit que des classes écrites en toutes
// lettres. Les `_` des valeurs arbitraires sont les espaces que CSS exige autour du `-` de `100% - 3rem`.
const VARIANT_CLASSES: Record<PageShellProps["variant"], string> = {
  // accueil, index de catégories, listings, établissement, fiche produit
  large:
    "grid w-full flex-1 content-start gap-y-6 py-6 grid-cols-[1fr_min(45rem,100%_-_3rem)_1fr] sm:py-8 sm:grid-cols-[1fr_min(44rem,100%_-_4rem)_1fr] [&>*:not([data-bleed])]:col-start-2",
  // checkout, commandes
  narrow: "mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6 sm:p-8",
  // login, signup, verify-email
  centered: "flex flex-1 flex-col items-center justify-center gap-6 p-6 sm:p-8",
  // l'accueil seulement — voir `COLUMNA_PORTADA` juste en dessous
  portada: "flex w-full flex-1 flex-col",
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// `portada` — L'ACCUEIL DE LA MAQUETTE DU 2026-10-01, QUI COMMENCE SOUS LE HEADER
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Jérôme a fourni la maquette de l'accueil : un héros dont l'illustration (la rue aux zócalos)
// commence TOUT EN HAUT de l'écran, derrière un header transparent. Les trois autres variantes
// posent un padding haut (`py-6`, `p-6`) : l'illustration démarrerait 24 px trop bas et le header
// flotterait sur une bande d'or vide. D'où une variante qui ne pose RIEN — ni padding, ni grille,
// ni largeur — et laisse la page dessiner ses colonnes avec la constante ci-dessous.
//
// LA COLONNE EST EXPORTÉE, ET C'EST LE POINT : trois fichiers doivent s'y aligner au pixel — le
// héros (`PortadaInicio`), la colonne des sections (`page.tsx`) et le header transparent
// (`SiteHeader`, dont les drapeaux doivent tomber à l'aplomb du logo, comme sur la maquette). Une
// seule chaîne, importée par les trois : ils ne peuvent pas diverger à la première retouche.
// `max-w-5xl` (64rem) : la maquette est une composition d'une seule colonne ; 1 024 px de contenu
// sur un écran de 1 280 donnent trois photos d'environ 285 px, sans étirer le texte au-delà de ce
// que la maquette montre. Littérale et complète, jamais construite : Tailwind v4 scanne ce fichier.
export const COLUMNA_PORTADA = "mx-auto w-full max-w-5xl px-5 sm:px-8";

export function PageShell({ children, variant, fondo, testId }: PageShellProps) {
  return (
    <main
      className={VARIANT_CLASSES[variant]}
      data-fondo={fondo}
      data-superficie={fondo === "acento" ? "or" : undefined}
      data-testid={testId}
    >
      {children}
    </main>
  );
}
