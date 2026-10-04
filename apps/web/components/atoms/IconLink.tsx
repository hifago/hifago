"use client";

import type { ReactNode } from "react";
import { buttonVariants } from "@hifago/ui";
import { Link } from "@/i18n/navigation";
import {
  buttonToneClasses,
  HEROUI_VARIANT,
  ICON_SIZE_CLASS,
  RADIUS_CLASS,
  type ButtonColor,
  type ButtonSize,
  type ButtonVariant,
} from "./Button";
import { FOCUS_CLASS } from "./LinkButton";

// Le lien en icône seule (2026-09-02, vague 4). Quatrième et dernier membre de la famille des
// boutons, et il comble un trou que le header a rendu visible :
//
//     |              | libellé visible | icône seule  |
//     | bouton       | Button          | IconButton   |
//     | lien         | LinkButton      | IconLink ←   |
//
// ⚠️ POURQUOI UN QUATRIÈME COMPOSANT plutôt qu'un `href` optionnel sur `IconButton` : le dépôt a
// déjà tranché cette question une fois, et dans l'autre sens. `LinkButton` existe précisément
// parce qu'« un lien n'est pas un bouton » — il navigue, s'ouvre au clic du milieu, se copie, se
// met en favori, et s'annonce « lien » à un lecteur d'écran. Poser un `href` sur `IconButton`
// reviendrait à défaire cette décision sur le seul composant qui portait déjà la contrainte du nom
// accessible obligatoire. Le panier du header est exactement le cas où ça se paie : c'est une
// icône que les gens ouvrent dans un nouvel onglet.
//
// Le coût reste nul côté cohérence : les couleurs, la forme, la taille et le rayon viennent des
// MÊMES exports que les trois autres (`buttonToneClasses`, `HEROUI_VARIANT`, `RADIUS_CLASS`), et
// l'anneau de focus du `FOCUS_CLASS` de `LinkButton` — un `<a class="button">` n'obtient pas
// l'anneau de HeroUI tout seul (voir l'en-tête de LinkButton.tsx, où le mécanisme est expliqué).
//
// Pas de mode `external` ici, volontairement : un lien externe en icône seule devrait annoncer
// « s'ouvre dans un nouvel onglet » sans avoir de texte visible où l'accrocher, et aucun usage du
// dépôt n'en demande. Le jour où il en faudra un, ce sera une union comme celle de `LinkButton`.
//
// `"use client"` obligatoire (barrel @hifago/ui, CLAUDE.md §11.16).
export type IconLinkProps = {
  /** Le glyphe. Fourni par l'appelant : ce composant n'a aucune dépendance d'icônes. */
  icon: ReactNode;
  /**
   * ⚠️ Nom accessible, REQUIS et déjà traduit. Sans lui, un lecteur d'écran annonce « lien » et
   * l'URL. Même parti pris que `IconButton` et que le `alt` d'`Image`.
   */
  label: string;
  /** Chemin interne — le préfixe de locale est ajouté par `@/i18n/navigation`. */
  href: string;
  /** `circle` est la forme d'un bouton d'action isolé ; `square` suit le rayon du bouton texte. */
  shape?: "circle" | "square";
  variant?: ButtonVariant;
  color?: ButtonColor;
  /** 44 × 44 px à toutes les tailles, comme IconButton : la taille ne règle que le glyphe. */
  size?: ButtonSize;
  testId?: string;
};

const SHAPE_CLASSES: Record<NonNullable<IconLinkProps["shape"]>, string> = {
  circle: "rounded-full",
  square: RADIUS_CLASS,
};

export function IconLink({
  icon,
  label,
  href,
  shape = "circle",
  variant = "ghost",
  color = "neutral",
  size = "lg",
  testId,
}: IconLinkProps) {
  const classes = [
    // `isIconOnly` donne la largeur carrée de HeroUI (w-11 en `lg`), exactement comme `IconButton`
    // l'obtient via la prop du même nom sur son <Button>.
    buttonVariants({ variant: HEROUI_VARIANT[variant], size, isIconOnly: true }),
    buttonToneClasses(variant, color),
    ICON_SIZE_CLASS,
    SHAPE_CLASSES[shape],
    FOCUS_CLASS,
  ].join(" ");

  return (
    <Link href={href} aria-label={label} className={classes} data-testid={testId}>
      {/* Le glyphe est décoratif : le nom vient d'`aria-label`, jamais de l'icône. */}
      <span aria-hidden="true" className="contents">
        {icon}
      </span>
    </Link>
  );
}
