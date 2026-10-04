"use client";

import { useState } from "react";
import { Description, ErrorMessage, Input, Label, TextField } from "@hifago/ui";
import { IconButton } from "./IconButton";

// Le champ de saisie de la vitrine (2026-09-02, vague 3). Surcouche des primitives de formulaire
// HeroUI, dans la continuité de Button.tsx : mêmes conventions, mêmes noms de props.
//
// ⚠️ `"use client"` obligatoire, pas décoratif : ce fichier importe le barrel `@hifago/ui`, dont le
// graphe de modules fait planter `next build` dès qu'il atteint un Server Component
// (CLAUDE.md §11.16, invisible au typecheck comme au lint).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QUE CETTE SURCOUCHE ABSORBE — relevé dans le code, pas imaginé
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// 1. `TextField` + `Label` + `Input` voyagent TOUJOURS ensemble, sur huit sites, jamais l'un sans
//    les autres (SignupForm ×3, CheckoutForm ×3+1, LoginForm ×2, CatalogBrowser, et les trois
//    champs de quantité des formulaires de réservation). Cinq lignes deviennent une.
//
// 2. ⚠️ Quatre de ces sites passent un `className` — interdit par components/README.md :
//    `min-w-48 flex-1` sur la recherche du catalogue, `max-w-32` sur les trois quantités. C'est
//    `width` qui porte ce besoin ici, comme sur `Button`. Les trois valeurs viennent des trois
//    usages réels, pas d'un catalogue de possibilités.
//
// 3. ⚠️ Le champ porte enfin son erreur et son texte d'aide. `error-message`, `field-error` et
//    `description` existent chez HeroUI et ne sont utilisés NULLE PART dans apps/web : les cinq
//    formulaires affichent leurs erreurs dans un <p> à part, relié à rien. La relation
//    `aria-describedby`/`aria-invalid` est facile à écrire de travers et invisible quand elle
//    l'est — la faire tenir au composant est une des vraies raisons d'être de cette surcouche.
//
// 4. ⚠️ LE PIÈGE DU FORMULAIRE QUI NE SE SOUMET PAS (CLAUDE.md §11 point 11). Un champ `isRequired`
//    déclenche la validation NATIVE du navigateur, qui bloque la soumission AVANT que le
//    `onSubmit` React ne s'exécute : ni message inline, ni toast, quelle que soit la qualité du
//    code derrière. La parade documentée est `noValidate` sur le <form> — mais elle repose sur la
//    mémoire de celui qui écrit le formulaire, et de fait un seul des trois formulaires concernés
//    la porte aujourd'hui (SignupForm ; CheckoutForm et LoginForm ne l'ont pas, avec des champs
//    requis).
//
//    D'où `validationBehavior="aria"`, posé ici par le champ lui-même : react-aria pose alors
//    `aria-required` au lieu de l'attribut natif `required`, donc le navigateur n'a plus rien à
//    bloquer — le champ est correct MÊME dans un <form> qui a oublié `noValidate`. C'est le seul
//    endroit d'où la règle ne peut pas être oubliée. Vérifié par un test (l'attribut `required`
//    est absent, `aria-required` présent).
//    ⚠️ Corollaire assumé : `minLength`, `type="email"` et `min`/`max` ne bloquent plus la
//    soumission non plus. C'est déjà le contrat de fait de ce projet — les cinq formulaires
//    valident en JS et affichent leur propre message.
type FieldBase = {
  /** Libellé déjà traduit — un atome ne traduit rien. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Nom du champ dans le formulaire. Sert aussi de base aux `data-testid` des enfants. */
  name?: string;
  /**
   * Largeur, en intention plutôt qu'en classes. Les trois valeurs sont les trois usages réels du
   * dépôt : `full` (un champ de formulaire, il occupe sa colonne), `short` (une quantité, ~128 px)
   * et `grow` (une recherche dans une barre de filtres, qui prend la place restante sans
   * descendre sous 192 px).
   */
  width?: "full" | "short" | "grow";
  isRequired?: boolean;
  isDisabled?: boolean;
  /** Message d'erreur déjà traduit. Sa seule présence rend le champ invalide. */
  error?: string;
  /** Texte d'aide déjà traduit. ⚠️ HeroUI le masque quand le champ est en erreur (voir plus bas). */
  hint?: string;
  placeholder?: string;
  autoComplete?: string;
  minLength?: number;
  /** `number` seulement — les trois champs de quantité s'en servent. */
  min?: number;
  max?: number;
  testId?: string;
};

/**
 * ⚠️ Union discriminée sur `type`, et c'est le seul endroit du lot qui en demande une : un champ
 * mot de passe a TOUJOURS son bouton de révélation (demande de Jérôme, 2026-09-02), et ce bouton
 * n'a pas d'autre nom accessible que celui qu'on lui donne. Des libellés optionnels auraient
 * produit, au premier oubli, soit un bouton muet pour un lecteur d'écran, soit pas de bouton du
 * tout — sans que rien ne le signale. Ici l'oubli ne compile pas.
 *
 * L'appelant courant ne paie rien : il n'écrit pas `type`, ou il écrit `type="email"`.
 *
 * Deux libellés et non un seul : « Afficher le mot de passe » et « Masquer le mot de passe » ne
 * disent pas la même chose, et c'est le nom du bouton qui doit changer avec son état — c'est ce
 * qu'annonce un lecteur d'écran quand on l'active.
 */
export type FieldProps = FieldBase &
  (
    | {
        type?: "text" | "email" | "search" | "tel" | "number";
        revealLabel?: never;
        hideLabel?: never;
      }
    | {
        type: "password";
        /** « Mostrar la contraseña », déjà traduit. */
        revealLabel: string;
        /** « Ocultar la contraseña », déjà traduit. */
        hideLabel: string;
      }
  );

/** Largeur d'un champ. Partagée par Textarea et Select : trois composants, une seule table. */
export type FieldWidth = NonNullable<FieldBase["width"]>;

export const FIELD_WIDTH_CLASSES: Record<FieldWidth, string> = {
  full: "w-full",
  short: "max-w-32",
  grow: "min-w-48 flex-1",
};

// ⚠️ 48 px (plan 41, item S11 ; cible tactile ≥ 44 px, components/README.md). `.input` de HeroUI ne
// fixe AUCUNE hauteur : il vit de son `py-2` et de sa taille de texte, ce qui donne 42 px sur mobile
// et 38 px sur desktop — mesuré, pas supposé. Le thème vitrine pose les mêmes 48 px sur toutes les
// classes de champ HeroUI (`globals.css`, « Les champs de formulaire »), pour les écrans qui
// composent encore les primitives brutes ; ce plancher le redit pour les atomes, où un utilitaire
// l'emporte sur le thème.
export const FIELD_MIN_HEIGHT = "min-h-12";

/**
 * Le `data-testid` d'un enfant, selon la convention du README (`${testId}-hint`).
 *
 * Le ternaire `testId ? … : undefined` était réécrit DOUZE fois dans les quatre atomes de saisie —
 * une convention appliquée à la main autant de fois qu'il y a d'enfants nommés. (2026-09-02)
 */
export function sousId(testId: string | undefined, suffixe: string): string | undefined {
  return testId ? `${testId}-${suffixe}` : undefined;
}

/**
 * Le pied « aide + erreur », partagé par `Field`, `Textarea` et `Select`.
 *
 * ⚠️ Ordre volontaire : HeroUI masque la description quand le champ est invalide
 * (`.textfield[data-invalid] [data-slot="description"] { display: none }`), donc l'aide s'efface
 * d'elle-même au profit de l'erreur. Les deux restent reliés au champ par `aria-describedby`, que
 * react-aria pose seul — c'est vérifié par un test, parce que c'est exactement le genre de lien
 * qui casse sans que rien ne le montre.
 *
 * ⚠️ Ce bloc était recopié à l'octet près dans les trois composants, et le commentaire ci-dessus
 * n'existait qu'au-dessus d'UNE des trois copies. (2026-09-02)
 *
 * ⚠️ `Checkbox` en est délibérément exclu : il n'a pas de conteneur react-aria qui fournisse le
 * contexte de champ, donc `Description`/`ErrorMessage` y rendraient `null` (leur `useHasTextSlot`).
 * Il écrit ses deux messages à la main, et c'est documenté dans son en-tête.
 */
export function FieldMessages({
  hint,
  error,
  testId,
}: {
  hint?: string;
  error?: string;
  testId?: string;
}) {
  return (
    <>
      {hint ? <Description data-testid={sousId(testId, "hint")}>{hint}</Description> : null}
      {error ? <ErrorMessage data-testid={sousId(testId, "error")}>{error}</ErrorMessage> : null}
    </>
  );
}

// SVG inline : `lucide-react` est présent dans node_modules mais déclaré par packages/ui, PAS par
// apps/web — l'importer créerait une dépendance fantôme (celle qui a cassé le build Vercel le
// 2026-08-23). Deux glyphes valent mieux qu'une dépendance.
function Oeil() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function OeilBarre() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M2 12s3.5-6 10-6c1.5 0 2.9.3 4.1.8M22 12s-3.5 6-10 6c-1.5 0-2.9-.3-4.1-.8" />
      <path d="M10.5 10.5a2.1 2.1 0 0 0 3 3" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function Field({
  label,
  value,
  onChange,
  name,
  type = "text",
  width = "full",
  isRequired,
  isDisabled,
  error,
  hint,
  placeholder,
  autoComplete,
  minLength,
  min,
  max,
  testId,
  revealLabel,
  hideLabel,
}: FieldProps) {
  const [revele, setRevele] = useState(false);
  // Le type interdit un mot de passe sans ses deux libellés — mais le panneau de contrôles de
  // Storybook, lui, peut basculer `type` sans les fournir. Plutôt qu'un bouton d'icône muet (le
  // défaut même que ce composant existe pour empêcher), on n'en met pas.
  const bascule = type === "password" && Boolean(revealLabel) && Boolean(hideLabel);
  // Le type EFFECTIF : révéler un mot de passe, c'est le rendre en clair le temps qu'on le relise.
  const typeRendu = type === "password" && revele ? "text" : type;

  return (
    <TextField
      className={FIELD_WIDTH_CLASSES[width]}
      name={name}
      type={typeRendu}
      value={value}
      onChange={onChange}
      isRequired={isRequired}
      isDisabled={isDisabled}
      isInvalid={Boolean(error)}
      // Voir le point 4 de l'en-tête : c'est ce qui rend le piège du <form> sans `noValidate`
      // impossible depuis le champ lui-même.
      validationBehavior="aria"
      data-testid={testId}
    >
      <Label>{label}</Label>
      {/* `relative` seulement quand il y a quelque chose à superposer : un div de plus sur tous les
          champs pour le seul cas du mot de passe serait payé par tous. */}
      <div className={bascule ? "relative" : undefined}>
        <Input
          // `pr-11` réserve la place du bouton : sans lui, un mot de passe long passe dessous.
          className={bascule ? `${FIELD_MIN_HEIGHT} w-full pr-11` : `${FIELD_MIN_HEIGHT} w-full`}
          placeholder={placeholder}
          autoComplete={autoComplete}
          minLength={minLength}
          min={min}
          max={max}
          // Clavier numérique sur mobile, dérivé du type plutôt qu'exposé en prop : personne n'a de
          // raison de vouloir un champ `number` sans lui.
          inputMode={type === "number" ? "numeric" : undefined}
          data-testid={sousId(testId, "input")}
        />
        {bascule ? (
          <div className="absolute inset-y-0 right-0 flex items-center">
            {/* ⚠️ Le NOM du bouton change avec son état — c'est lui qu'annonce un lecteur d'écran
                à l'activation, et « afficher » resterait faux une fois le mot de passe affiché.
                L'icône, elle, est décorative : IconButton la rend déjà `aria-hidden`. */}
            <IconButton
              icon={revele ? <OeilBarre /> : <Oeil />}
              label={revele ? (hideLabel as string) : (revealLabel as string)}
              variant="ghost"
              color="neutral"
              isDisabled={isDisabled}
              onPress={() => setRevele((etat) => !etat)}
              testId={sousId(testId, "reveal")}
            />
          </div>
        ) : null}
      </div>
      <FieldMessages hint={hint} error={error} testId={testId} />
    </TextField>
  );
}
