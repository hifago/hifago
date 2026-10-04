"use client";

import type { ReactNode } from "react";
import { Button as HeroUIButton, Spinner } from "@hifago/ui";
import {
  buttonToneClasses,
  HEROUI_VARIANT,
  ICON_SIZE_CLASS,
  RADIUS_CLASS,
  type ButtonColor,
  type ButtonSize,
  type ButtonVariant,
} from "./Button";

// Le bouton sans libellé visible — fermer, retirer, revenir (2026-09-01, vague 2).
//
// ⚠️ POURQUOI UN COMPOSANT SÉPARÉ, et pas une prop `shape` sur `Button` : les deux n'ont pas les
// mêmes exigences. Un bouton sans texte n'a AUCUN nom accessible par défaut ; le rendre correct
// veut dire un libellé obligatoire, ce qui ne s'exprime sur un composant unique qu'avec une union
// discriminée (`children` ou bien `icon` + `label`) — l'appelant du cas courant, `<Button>Texte
// </Button>`, paierait alors en messages d'erreur illisibles une contrainte qui ne le concerne
// pas. Ici `label` est simplement requis, comme le `alt` d'`Image` en vague 1. Le coût de la
// séparation est contenu parce que les deux boutons partagent exactement la même table de
// couleurs (`buttonToneClasses`) : une couleur ajoutée les sert tous les deux.
//
// `"use client"` obligatoire pour la même raison que Button.tsx (barrel @hifago/ui, CLAUDE.md
// §11.16).
export type IconButtonProps = {
  /** Le glyphe. Fourni par l'appelant : ce composant n'a aucune dépendance d'icônes. */
  icon: ReactNode;
  /**
   * ⚠️ Nom accessible, REQUIS et déjà traduit. C'est la raison d'être du composant : sans lui, un
   * lecteur d'écran annonce « bouton » et rien d'autre.
   */
  label: string;
  /**
   * ⚠️ Depuis que le rayon est descendu au jeton du thème (demande du 2026-09-02), cette prop est
   * la SEULE façon d'obtenir un bouton rond : avec le `rounded-3xl` d'origine, un bouton d'icône
   * était rond par accident — 24 px de rayon dépassaient la moitié de sa hauteur (22 px en `lg`) et
   * le navigateur rabotait à 50 %. `square` suit exactement le rayon du bouton texte
   * (`--rayon-bouton`, 8 px, plan 41 F4), pour que les deux composants s'accordent.
   */
  shape?: "circle" | "square";
  variant?: ButtonVariant;
  color?: ButtonColor;
  /** 44 × 44 px à toutes les tailles (`ICON_SIZE_CLASS`) : la taille ne règle que le glyphe. */
  size?: ButtonSize;
  type?: "button" | "submit";
  onPress?: () => void;
  isDisabled?: boolean;
  isPending?: boolean;
  /** Nom accessible pendant l'envoi, déjà traduit. Sans lui, `label` est conservé. */
  pendingLabel?: string;
  /**
   * ⚠️ Ajouté le 2026-09-02 (vague 4) pour le bouton de menu du header : un bouton qui commande un
   * panneau doit annoncer son état, sinon un lecteur d'écran ne sait pas que quelque chose s'est
   * ouvert. `undefined` (le défaut) ne pose aucun attribut — un bouton ordinaire ne prétend pas
   * contrôler quoi que ce soit.
   */
  isExpanded?: boolean;
  /** `id` du panneau commandé, pour `aria-controls`. Va de pair avec `isExpanded`. */
  controlsId?: string;
  testId?: string;
};

const SHAPE_CLASSES: Record<NonNullable<IconButtonProps["shape"]>, string> = {
  circle: "rounded-full",
  square: RADIUS_CLASS,
};

export function IconButton({
  icon,
  label,
  shape = "circle",
  variant = "ghost",
  color = "neutral",
  size = "lg",
  type,
  onPress,
  isDisabled,
  isPending = false,
  pendingLabel,
  isExpanded,
  controlsId,
  testId,
}: IconButtonProps) {
  return (
    <HeroUIButton
      className={`${buttonToneClasses(variant, color)} ${ICON_SIZE_CLASS} ${SHAPE_CLASSES[shape]}`}
      variant={HEROUI_VARIANT[variant]}
      size={size}
      isIconOnly
      aria-label={isPending ? (pendingLabel ?? label) : label}
      type={type}
      onPress={onPress}
      isDisabled={isDisabled}
      isPending={isPending}
      aria-expanded={isExpanded}
      aria-controls={controlsId}
      data-testid={testId}
    >
      {/* L'icône est purement visuelle : le nom vient d'`aria-label`, jamais du glyphe. */}
      {isPending ? (
        <Spinner size="sm" color="current" aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className="contents">
          {icon}
        </span>
      )}
    </HeroUIButton>
  );
}
