"use client";

import type { ReactNode } from "react";
import { buttonVariants } from "@hifago/ui";
import { Link } from "@/i18n/navigation";
import {
  buttonSizeClasses,
  buttonToneClasses,
  HEROUI_VARIANT,
  RADIUS_CLASS,
  type ButtonColor,
  type ButtonSize,
  type ButtonVariant,
} from "./Button";

// Le lien habillé en bouton (2026-09-02, vague 3). Comble un trou laissé ouvert par le lot
// `Button` : `ProductDetailView.tsx:158-167` habille aujourd'hui un `<a>` à la main avec
// `className={buttonVariants({ variant: "primary" })}`, ce qui est exactement le geste que la
// surcouche existe pour supprimer.
//
// ⚠️ UN LIEN N'EST PAS UN BOUTON, et ce n'est pas une question de style : il navigue, s'ouvre dans
// un nouvel onglet au clic du milieu, se copie, se met en favori, et s'annonce « lien » et non
// « bouton » au lecteur d'écran. Rendre `Button` polymorphe (`as="a"`) aurait mélangé les deux :
// un `<button>` n'a ni `href`, ni `target`, ni `rel`, et un `<a>` n'a ni `type="submit"`, ni
// `isPending`, ni `onPress`. Deux composants, une seule table de couleurs.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QUE CE COMPOSANT REND IMPOSSIBLE PAR CONSTRUCTION
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// 1. ⚠️ **`rel="noopener noreferrer"` ne peut pas être oublié.** Il est écrit ici, et la prop `rel`
//    n'existe pas : l'appelant ne peut donc ni l'omettre ni l'écraser. Sans lui, la page ouverte
//    accède à `window.opener` et peut réécrire l'onglet d'origine. Le code actuel le pose
//    correctement — mais par vigilance, une fois, à un endroit. C'est ce qui se perd à la
//    deuxième occurrence.
// 2. ⚠️ **Un lien qui ouvre un onglet le DIT.** `newTabLabel` est requis par le type dès que
//    `external` vaut `true` (même parti pris que le `alt` d'`Image` et le `label` d'`IconButton`).
//    Sans lui, le lecteur d'écran annonce « Reservar, lien » et le focus part dans un onglet que
//    l'utilisateur n'a pas demandé, sans retour arrière possible. Le libellé est rendu en
//    `sr-only` : rien ne change à l'œil, tout change à l'oreille.
// 3. ⚠️ **Un lien interne passe forcément par le `Link` de `@/i18n/navigation`.** Lui seul conserve
//    le préfixe de locale (règle de components/README.md, déjà rendue vraie par construction dans
//    `BackLink`). Un `<a href="/productos/x">` renvoie un hispanophone sur une page qui perd sa
//    langue.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// L'APPARENCE — identique à `Button`, pas ressemblante
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Les classes viennent des MÊMES sources que `Button` : `buttonVariants` de HeroUI pour la forme
// et la taille, `buttonToneClasses`, `buttonSizeClasses` et `RADIUS_CLASS` pour la surcouche. Rien
// n'est recopié — deux tables de couleurs qui divergent au premier ajout sont le défaut classique
// de ce genre de paire, et `LinkButton.test.tsx` compare les deux rendus sur les 36 combinaisons
// pour que la divergence casse un test plutôt que de se voir en production.
//
// ⚠️ SEUL ÉCART, ET IL EST OBLIGATOIRE : l'anneau de focus. Mesuré dans le CSS de HeroUI
// (`node_modules/@heroui/styles/dist/components/button.css`), `.button` porte `outline-none` et ne
// remet un anneau que sur `&[data-focus-visible="true"]` — un attribut posé par react-aria, que
// seul son `<Button>` reçoit. Son autre sélecteur, `&:focus-visible:not(:focus)`, ne matche
// jamais : un élément focalisé qui est `:focus-visible` est aussi `:focus`. Un `<a class="button">`
// serait donc focalisable SANS AUCUN anneau visible — une régression d'accessibilité silencieuse
// (WCAG 2.4.7). D'où `focus-visible:status-focused` : `status-focused` est l'utility de HeroUI
// elle-même, celle que `.button` applique dans cet état, donc l'anneau est le sien, au pixel près,
// et pas une imitation.
export type LinkButtonProps = {
  /** Le libellé, déjà traduit — un atome ne traduit rien. */
  children: ReactNode;
  /** La FORME, jamais la couleur — mêmes deux axes que `Button`. */
  variant?: ButtonVariant;
  /** Le RÔLE : avancer (`accent`), accompagner (`neutral`), détruire (`danger`). */
  color?: ButtonColor;
  /** Défaut `md` comme `Button` (44 px) ; `lg` (48 px) pour les seuls CTA de conversion. */
  size?: ButtonSize;
  width?: "auto" | "full";
  /** Icône décorative, rendue `aria-hidden` : le libellé reste seul porteur du sens. */
  iconBefore?: ReactNode;
  iconAfter?: ReactNode;
  testId?: string;
} & (
  | {
      /** Chemin interne — le préfixe de locale est ajouté par `@/i18n/navigation`. */
      href: string;
      external?: false;
      newTabLabel?: undefined;
    }
  | {
      /** URL absolue vers un autre site. */
      href: string;
      external: true;
      /**
       * ⚠️ REQUIS quand `external`. Déjà traduit, rendu en `sr-only` : « (s'ouvre dans un nouvel
       * onglet) ». C'est la seule chose qui distingue, à l'oreille, un lien qui navigue d'un lien
       * qui fait perdre le contexte.
       */
      newTabLabel: string;
    }
);

/**
 * L'anneau de focus, dans l'état où `.button` le pose lui-même — voir l'en-tête.
 *
 * ⚠️ Chaîne écrite en toutes lettres et jamais construite : Tailwind v4 scanne ce fichier comme du
 * texte (`@source` dans app/globals.css), une classe interpolée n'existerait pas dans le CSS
 * compilé et le lien serait sans anneau, en silence.
 */
export const FOCUS_CLASS = "focus-visible:status-focused";

export function LinkButton({
  children,
  href,
  external,
  newTabLabel,
  variant = "solid",
  color = "accent",
  size = "md",
  width = "auto",
  iconBefore,
  iconAfter,
  testId,
}: LinkButtonProps) {
  // Mêmes appels, dans le même ordre, que `Button` — c'est ce qui garantit l'identité plutôt qu'une
  // ressemblance. `fullWidth` est passé à `buttonVariants` exactement comme HeroUI le fait
  // lui-même depuis la prop `fullWidth` de son `<Button>`.
  const classes = [
    buttonVariants({
      variant: HEROUI_VARIANT[variant],
      size,
      fullWidth: width === "full",
    }),
    buttonToneClasses(variant, color),
    buttonSizeClasses(size),
    RADIUS_CLASS,
    FOCUS_CLASS,
  ].join(" ");

  const contenu = (
    <>
      {iconBefore ? (
        <span aria-hidden="true" className="contents">
          {iconBefore}
        </span>
      ) : null}
      {children}
      {iconAfter ? (
        <span aria-hidden="true" className="contents">
          {iconAfter}
        </span>
      ) : null}
      {/* Annoncé, jamais affiché. Espace insécable de tête : sans lui, certains lecteurs d'écran
          recollent le libellé et la mention en un seul mot. */}
      {external ? <span className="sr-only">&nbsp;{newTabLabel}</span> : null}
    </>
  );

  if (external) {
    return (
      // `rel` est posé ICI et la prop n'existe pas dans le type : l'appelant ne peut ni l'omettre
      // ni l'écraser. C'est la garantie centrale de ce composant, et `LinkButton.test.tsx` la
      // vérifie dans les deux sens (présence au rendu, et rejet à la compilation).
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={classes}
        data-testid={testId}
      >
        {contenu}
      </a>
    );
  }

  return (
    <Link href={href} className={classes} data-testid={testId}>
      {contenu}
    </Link>
  );
}
