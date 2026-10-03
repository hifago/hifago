"use client";

import type { ReactNode } from "react";
import { Button as HeroUIButton, Spinner } from "@hifago/ui";

// LE bouton de la vitrine (2026-09-01, vague 2). Surcouche du Button HeroUI v3, pas un
// remplacement : la forme, les tailles, le focus et les états react-aria restent les siens.
//
// ⚠️ `"use client"` est obligatoire, pas décoratif : ce fichier importe le barrel `@hifago/ui`,
// dont le graphe de modules fait planter `next build` (« Collecting page data ») dès qu'il atteint
// un Server Component — CLAUDE.md §11.16, invisible au typecheck comme au lint. Ce fichier devient
// en échange le SEUL point d'entrée HeroUI du bouton pour toute l'app : une page n'importe plus
// jamais `Button` depuis le barrel, elle l'importe d'ici.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// POURQUOI CETTE SURCOUCHE — ce que le bouton de HeroUI ne sait pas faire
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// 1. ⚠️ HeroUI n'a PAS d'axe couleur. Son `variant` à 7 valeurs mélange forme et couleur
//    (`primary`, `secondary`, `tertiary`, `outline`, `ghost`, `danger`, `danger-soft`) : « outline
//    en rouge » est inexprimable. Ici les deux axes sont séparés — `variant` = la forme, `color` =
//    le rôle de l'action — et se combinent librement (voir « l'axe couleur » plus bas).
//
// 2. L'état « en cours » était recopié à la main dans cinq écrans (`CheckoutForm` ×2, `LoginForm`,
//    `SignupForm`, `OrdersList`), tous sous la forme `isDisabled={isSubmitting}` PLUS
//    `{isSubmitting ? t("submitting") : t("submit")}`. Une prop `isPending` + `pendingLabel`
//    remplace ce couple. Ce n'est pas qu'une économie de lignes : `isDisabled` retire le bouton de
//    l'ordre de tabulation et n'annonce rien, alors que `isPending` de react-aria garde le focus,
//    annonce le changement d'état au lecteur d'écran, et force `type="button"` le temps de l'envoi
//    (donc bloque la double soumission sans que l'appelant y pense).
//
// 3. Une icône seule sans nom accessible est un bouton muet. Ce fichier n'expose PAS ce cas :
//    il vit dans `IconButton.tsx`, où le libellé est requis par le type (même parti pris que
//    `Image` de la vague 1, dont le `alt` n'est pas optionnel).
//
// 4. Pas de prop `className` (règle du README). `CheckoutForm.tsx:289` écrit aujourd'hui
//    `className="w-fit"` : c'est `width` qui porte ce besoin ici.
// ⚠️ CONSTAT MESURÉ, NON CORRIGÉ (2026-09-01) — deux des douze combinaisons échouent au contraste
// WCAG, et ce n'est PAS cette surcouche : ce sont les jetons de HeroUI. `solid/accent` rend son
// texte blanc à 3.59:1 et `solid/danger` à 3.48:1, sous le seuil de 4.5:1 (mesuré au rendu, et
// confirmé indépendamment par axe : 3.58 et 3.47). Les dix autres passent, en clair comme en
// sombre. Le correctif appartient au thème, pas ici : abaisser la luminosité de `--accent` de
// 0.6204 à 0.5626 et celle de `--danger` de 0.6532 à 0.5902 — chroma et teinte inchangés — les
// porte à 4.53 et 4.52. Ce fichier ne le fait pas de lui-même, parce qu'un bouton qui assombrit
// sa couleur cesserait de suivre le thème le jour où le thème sera juste.
export type ButtonVariant = "solid" | "outline" | "soft" | "ghost";
export type ButtonColor = "accent" | "neutral" | "danger" | "marine";
export type ButtonSize = "sm" | "md" | "lg";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// L'AXE COULEUR — comment on l'obtient sans réécrire le bouton de HeroUI
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Le CSS de HeroUI passe par une indirection : ses variantes ne peignent rien elles-mêmes, elles
// posent quatre custom properties (`--button-bg`, `--button-bg-hover`, `--button-bg-pressed`,
// `--button-fg`) que `.button` consomme ensuite. Reposer ces quatre variables suffit donc à
// recolorer n'importe quelle variante, hover et pressed compris, sans toucher à sa forme.
//
// ⚠️ Mécanisme retenu : des classes utilitaires Tailwind (propriétés arbitraires), PAS un `style`
// inline. Mesuré dans le navigateur, pas supposé : HeroUI déclare lui-même
// `@layer theme, base, components, utilities;` et son CSS de bouton vit dans `components` — une
// utility Tailwind, qui atterrit dans `utilities`, gagne donc la cascade. Vérifié sur les trois
// leviers (fond, texte, bordure) ; le `style` inline gagne aussi, mais il occupe une prop que
// l'appelant pourrait vouloir, et sort les couleurs du CSS.
//
// ⚠️ Les chaînes ci-dessous sont écrites EN TOUTES LETTRES et jamais construites par
// concaténation : Tailwind v4 génère ses classes en scannant ce fichier comme du texte.
//
// Deux tables plutôt qu'une matrice de 4×3 : la couleur nomme SES jetons dans des variables
// intermédiaires, la forme dit lesquels elle utilise. Ajouter une couleur = une ligne, ajouter une
// forme = une ligne — au lieu de douze combinaisons à maintenir à la main.
const COLOR_CLASSES: Record<ButtonColor, string> = {
  // Bleu HeroUI. L'action qui fait avancer la réservation : réserver, payer, ajouter au panier.
  accent:
    "[--btn-fill:var(--accent)] [--btn-fill-hover:var(--accent-hover)] [--btn-on-fill:var(--accent-foreground)] [--btn-tint:var(--accent-soft)] [--btn-tint-hover:var(--accent-soft-hover)] [--btn-on-tint:var(--accent-soft-foreground)] [--btn-line:var(--accent)]",
  // La famille de jetons s'appelle `--default-*` chez HeroUI ; la prop s'appelle `neutral` parce
  // que `color="default"` se lirait comme « la valeur par défaut » et non comme « gris ».
  // ⚠️ `--btn-on-tint` vise ici `--default-foreground` (quasi noir) et non `--default-soft-foreground`
  // (son alias), pour dire explicitement que le texte d'un bouton neutre est du texte courant.
  neutral:
    "[--btn-fill:var(--default)] [--btn-fill-hover:var(--default-hover)] [--btn-on-fill:var(--default-foreground)] [--btn-tint:var(--default-soft)] [--btn-tint-hover:var(--default-soft-hover)] [--btn-on-tint:var(--default-foreground)] [--btn-line:var(--muted)]",
  // Rouge. Réservé à ce qui détruit : annuler une commande, retirer une ligne du panier.
  danger:
    "[--btn-fill:var(--danger)] [--btn-fill-hover:var(--danger-hover)] [--btn-on-fill:var(--danger-foreground)] [--btn-tint:var(--danger-soft)] [--btn-tint-hover:var(--danger-soft-hover)] [--btn-on-tint:var(--danger-soft-foreground)] [--btn-line:var(--danger)]",
  // Marine (plan 41, item F4). L'action principale posée sur une surface OR, où un bouton or
  // disparaît : fond marine, texte blanc (13.07:1). Teinte bleu poudre pour `soft`, `ghost` et le
  // survol d'`outline` ; texte et contour marine. ⚠️ Explicite à l'appel, jamais automatique :
  // sur une surface claire, l'action principale reste `accent` (or + texte marine).
  marine:
    "[--btn-fill:var(--bouton-marine)] [--btn-fill-hover:var(--bouton-marine-survol)] [--btn-on-fill:var(--bouton-marine-texte)] [--btn-tint:var(--default)] [--btn-tint-hover:var(--default-hover)] [--btn-on-tint:var(--charte-marine)] [--btn-line:var(--charte-marine)]",
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  solid:
    "[--button-bg:var(--btn-fill)] [--button-bg-hover:var(--btn-fill-hover)] [--button-bg-pressed:var(--btn-fill-hover)] [--button-fg:var(--btn-on-fill)]",
  soft: "[--button-bg:var(--btn-tint)] [--button-bg-hover:var(--btn-tint-hover)] [--button-bg-pressed:var(--btn-tint-hover)] [--button-fg:var(--btn-on-tint)]",
  // La bordure de HeroUI (`border border-border`, un gris fixe) ne suivrait pas la couleur : c'est
  // la seule chose que cette variante repose en plus des quatre variables.
  outline:
    "[--button-bg:transparent] [--button-bg-hover:var(--btn-tint)] [--button-bg-pressed:var(--btn-tint-hover)] [--button-fg:var(--btn-on-tint)] [border-color:var(--btn-line)]",
  ghost:
    "[--button-bg:transparent] [--button-bg-hover:var(--btn-tint)] [--button-bg-pressed:var(--btn-tint-hover)] [--button-fg:var(--btn-on-tint)]",
};

// La variante HeroUI la plus proche sert de socle : si le mécanisme ci-dessus cessait un jour de
// prendre (changement d'architecture de leurs layers), le bouton resterait utilisable en bleu au
// lieu de devenir invisible. C'est aussi elle qui apporte la bordure de `outline`.
/** La variante HeroUI sous-jacente — partagée avec IconButton pour éviter deux mappings divergents. */
export const HEROUI_VARIANT: Record<ButtonVariant, "primary" | "secondary" | "outline" | "ghost"> = {
  solid: "primary",
  soft: "secondary",
  outline: "outline",
  ghost: "ghost",
};

/**
 * Le rayon des angles : UN SEUL pour tout bouton rectangulaire de la vitrine (plan 41, item F4 ;
 * arbitrage D4 de Jérôme, 2026-10-02 : 8 px, celui de « Mi viaje » sur l'accueil).
 *
 * ⚠️ Lu dans le jeton `--rayon-bouton` (`packages/ui/src/styles/globals.css`, le double de
 * `--radius`), jamais écrit en px ici : les champs le lisent aussi (`--field-radius`, item S11),
 * et le régler se fait à un seul endroit. `.button` de HeroUI porte `rounded-3xl`
 * (`calc(var(--radius) * 3)`, 12 px) dans la couche `components` ; cette classe vit dans
 * `utilities` et l'emporte — mesuré au rendu, story `Tailles`.
 *
 * Historique : `var(--radius)` au facteur 1 (4 px) du 2026-09-02 au 2026-10-02.
 */
const RADIUS_CLASS = "rounded-[var(--rayon-bouton)]";

/**
 * Hauteur et texte par taille (plan 41, item F4). ⚠️ 44 px AU MOINS à toutes les tailles et à
 * toutes les largeurs : HeroUI rétrécit chaque taille de 4 px à partir de `md` (`md:h-10`…), ce qui
 * mettait tout bouton desktop sous la cible de 44 px. `sm` ne réduit que le padding et la police ;
 * `lg` (48 px) est RÉSERVÉ aux CTA de conversion — « Añadir a Mi viaje », « Reservar »,
 * « Confirmar reserva », « Pagar el anticipo », « Iniciar sesión », « Crear cuenta ».
 *
 * Mêmes leviers que l'axe couleur : des utilitaires (couche `utilities`), qui battent `.button--lg`
 * et ses variantes responsives (couche `components`) sans réécrire HeroUI. Écrites en toutes
 * lettres (Tailwind lit ce fichier comme du texte).
 */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-11 px-3 text-sm font-medium",
  md: "h-11 px-4 text-base font-semibold",
  lg: "h-12 px-5 text-base font-semibold",
};

/** Hauteur et texte d'une taille, partagés avec LinkButton — même bouton, mêmes tailles. */
export function buttonSizeClasses(size: ButtonSize): string {
  return SIZE_CLASSES[size];
}

/**
 * Le bouton d'icône seule : 44 × 44 px à toutes les tailles, carré ou rond. La taille ne règle plus
 * que le glyphe (le CSS de HeroUI). Partagé par IconButton et IconLink.
 */
export const ICON_SIZE_CLASS = "size-11";

/**
 * La FORME, ajoutée le 2026-09-02 à la demande de Jérôme pour le bouton de la barre de recherche
 * (« plus rond en radius »). Deux valeurs, pas un rayon libre : un bouton suit le rayon du thème,
 * ou il est complètement arrondi — l'entre-deux serait une valeur en dur qui cesserait de suivre
 * le rayon de la charte, exactement ce que la note ci-dessus cherche à éviter.
 *
 * ⚠️ `square` porte le MÊME nom et le même sens que sur `IconButton`. Ce qui accorde vraiment les
 * deux composants, c'est `RADIUS_CLASS`, exporté d'ici et importé là-bas — PAS les deux tables, qui
 * restent séparées et qu'il faut donc modifier ensemble. Et la valeur « complètement arrondi » y
 * porte un autre nom à dessein : sur un bouton carré c'est un `circle`, sur un bouton large une
 * `pill` — même classe, deux formes.
 *
 * ⚠️ Ceci ne rouvre PAS la question tranchée en tête d'`IconButton.tsx` (« pourquoi un composant
 * séparé, et pas une prop `shape` sur `Button` ») : ce qui y était refusé, c'est de faire porter à
 * un seul composant deux contrats de NOM ACCESSIBLE différents (`children` contre `icon` + `label`
 * requis). Le rayon n'a rien à voir avec ça — il ne change aucune obligation pour l'appelant.
 */
const SHAPE_CLASSES = {
  square: RADIUS_CLASS,
  /** `rounded-full`. Le cas d'usage : un bouton logé DANS une forme déjà arrondie (la pilule de
      `organisms/SearchBar`), où le rayon du thème jurerait avec le contenant. */
  pill: "rounded-full",
} as const;

export type ButtonShape = keyof typeof SHAPE_CLASSES;

/** Les classes des deux axes, partagées avec IconButton — même bouton, mêmes couleurs. */
export function buttonToneClasses(variant: ButtonVariant, color: ButtonColor): string {
  return `${COLOR_CLASSES[color]} ${VARIANT_CLASSES[variant]}`;
}

/** Le rayon des angles, partagé avec IconButton (sa forme `square`). */
export { RADIUS_CLASS };

export type ButtonProps = {
  /** Le libellé, déjà traduit — un atome ne traduit rien. */
  children: ReactNode;
  /** La FORME. Jamais la couleur : c'est tout l'intérêt de séparer les deux axes. */
  variant?: ButtonVariant;
  /**
   * Le RÔLE de l'action : avancer (`accent`), accompagner (`neutral`), détruire (`danger`), avancer
   * depuis une surface or (`marine`).
   */
  color?: ButtonColor;
  /**
   * `md` par défaut : 44 px. `lg` (48 px) pour les seuls CTA de conversion, `sm` (44 px, texte
   * 14 px) pour une action répétée dans une liste dense. Voir `SIZE_CLASSES`.
   */
  size?: ButtonSize;
  /**
   * La forme des angles. `square` (défaut) suit `--radius`, donc la charte de production ;
   * `pill` arrondit complètement — réservé à un bouton logé dans un contenant déjà arrondi.
   */
  shape?: ButtonShape;
  /** `full` remplace le `className="w-fit"`/pleine largeur écrit à la main dans les écrans. */
  width?: "auto" | "full";
  type?: "button" | "submit";
  /** ⚠️ `onPress`, pas `onClick` : c'est un bouton react-aria (pointeur, clavier et tactile). */
  onPress?: () => void;
  isDisabled?: boolean;
  /**
   * Envoi en cours. Garde le focus, annonce le changement au lecteur d'écran et neutralise la
   * soumission — à préférer TOUJOURS à `isDisabled` pendant un envoi.
   */
  isPending?: boolean;
  /** Libellé affiché pendant `isPending`, déjà traduit. Sans lui, le libellé normal est conservé. */
  pendingLabel?: string;
  /** Icône décorative : le libellé reste seul porteur du sens, l'icône est rendue `aria-hidden`. */
  iconBefore?: ReactNode;
  iconAfter?: ReactNode;
  testId?: string;
};

export function Button({
  children,
  variant = "solid",
  color = "accent",
  size = "md",
  shape = "square",
  width = "auto",
  type,
  onPress,
  isDisabled,
  isPending = false,
  pendingLabel,
  iconBefore,
  iconAfter,
  testId,
}: ButtonProps) {
  return (
    <HeroUIButton
      className={`${buttonToneClasses(variant, color)} ${SIZE_CLASSES[size]} ${SHAPE_CLASSES[shape]}`}
      variant={HEROUI_VARIANT[variant]}
      size={size}
      fullWidth={width === "full"}
      type={type}
      onPress={onPress}
      isDisabled={isDisabled}
      isPending={isPending}
      data-testid={testId}
    >
      {/* En cours, le spinner PREND LA PLACE de l'icône : deux glyphes qui tournent l'un à côté de
          l'autre ne disent rien de plus. `color="current"` le fait hériter de --button-fg, donc il
          reste lisible sur les douze combinaisons sans réglage. */}
      {isPending ? <Spinner size="sm" color="current" aria-hidden="true" /> : null}
      {!isPending && iconBefore ? (
        <span aria-hidden="true" className="contents">
          {iconBefore}
        </span>
      ) : null}
      {isPending ? (pendingLabel ?? children) : children}
      {!isPending && iconAfter ? (
        <span aria-hidden="true" className="contents">
          {iconAfter}
        </span>
      ) : null}
    </HeroUIButton>
  );
}
