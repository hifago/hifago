"use client";

import { useId } from "react";
import { useLocale } from "next-intl";
import { Label } from "@hifago/ui";
import PhoneInput, { type Country } from "react-phone-number-input";
import es from "react-phone-number-input/locale/es";
import en from "react-phone-number-input/locale/en";
import { FIELD_MIN_HEIGHT, FIELD_WIDTH_CLASSES, sousId, type FieldWidth } from "./Field";

// Le champ téléphone international de la vitrine (2026-09-10), demandé pour `holder_phone` en
// checkout : un `<input type="tel">` nu ne portait ni indicatif pays ni validation E.164 — un
// numéro colombien sans "+57" et un numéro français avec "+57" étaient acceptés à l'identique.
// Lib validée par Jérôme (arbitrage explicite, `.claude/rules/ui.md` l'exige pour toute dépendance
// UI hors de la carte) : `react-phone-number-input`. Le sous-chemin racine du package EST déjà la
// variante `min` (metadata allégée, ~80 Ko) — jamais `/max`, jamais ajouter `libphonenumber-js` en
// double, il est déjà sa dépendance interne.
//
// ⚠️ Pas un second design system : les trois points d'extension de la lib (`containerComponent`,
// `inputComponent`, `countrySelectComponent`) remplacent CHACUN entièrement le DOM par défaut de la
// lib (confirmé en lisant son rendu, cf. journal) — aucune de ses classes CSS n'apparaît, aucun
// `style.css` à importer. Le numéro est rendu par `.input` (même classe BEM que `Field`/`Select`,
// packages/ui/src/styles), l'indicatif par un `<select>` natif portant la même classe.
//
// ⚠️ Comme `Checkbox.tsx` (même raison) : ce champ n'a PAS de conteneur react-aria (`TextField`)
// pour poser `aria-describedby` tout seul — la lib pilote elle-même le DOM des deux sous-champs.
// Aide et erreur sont donc reliées À LA MAIN, avec les mêmes `id` générés par `useId()`. Même
// motif : `aria-required` plutôt que l'attribut natif `required` (piège CLAUDE.md §11 point 11, le
// formulaire qui ne se soumet pas sans `noValidate`) — ce composant ne pose jamais `required`.
//
// Noms de pays traduits par les fichiers `locale/es.json`/`locale/en.json` de la lib elle-même
// (240 pays) plutôt que réécrits dans les messages next-intl du projet — ce sont des libellés
// d'interface au sens de CLAUDE.md §5.1, mais la lib les fournit déjà dans le jeu fermé ES/EN.
export type PhoneFieldProps = {
  /** Libellé déjà traduit — un atome ne traduit rien. */
  label: string;
  /** Nom accessible du sélecteur d'indicatif, déjà traduit (ex. « Indicativo del país »). */
  countryLabel: string;
  /** Numéro au format E.164 (ex. "+573001234567"), ou "" tant qu'aucun chiffre n'est saisi. */
  value: string;
  onChange: (value: string) => void;
  name?: string;
  /** Pays présélectionné dans le sélecteur — Colombie par défaut (marché principal). */
  defaultCountry?: Country;
  width?: FieldWidth;
  isRequired?: boolean;
  isDisabled?: boolean;
  /** Message d'erreur déjà traduit. Sa seule présence rend le champ invalide. */
  error?: string;
  /** Texte d'aide déjà traduit. */
  hint?: string;
  placeholder?: string;
  testId?: string;
};

const LOCALE_LABELS = { es, en } as const;

// UN SEUL GROUPE VISUEL (plan 41, item S11) : l'indicatif et le numéro sont collés, arrondis
// seulement sur leurs bords extérieurs ; la bordure droite de l'indicatif sert de filet de
// séparation (le numéro n'a pas de bordure gauche). Deux boîtes espacées se lisaient comme deux
// champs. Le focus reste visible sur chaque partie : c'est un `outline` décalé (thème vitrine).
function PhoneFieldContainer({ children }: { children: React.ReactNode }) {
  return <div className="flex">{children}</div>;
}

function PhoneFieldInput(props: React.ComponentProps<"input">) {
  return <input {...props} className={`input ${FIELD_MIN_HEIGHT} w-full min-w-0 rounded-l-none border-l-0`} />;
}

function PhoneFieldCountrySelect({
  value,
  onChange,
  options,
  disabled,
  name,
  ariaLabel,
  testId,
}: {
  value: Country | undefined;
  onChange: (country: Country | undefined) => void;
  // `value` est absent (donc `undefined`) uniquement pour l'option "International" — jamais une
  // chaîne vide, cf. `getCountrySelectOptions` de la lib (pas de champ `divider` dans cette
  // version, contrairement à un exemple générique de la doc).
  options: { value?: Country; label: string }[];
  disabled?: boolean;
  name?: string;
  ariaLabel?: string;
  testId?: string;
}) {
  // ⚠️ Props listées explicitement, jamais un `{...rest}` : la lib passe aussi `iconComponent`
  // (rendu du drapeau, qu'on ne veut pas ici) et `onFocus`/`onBlur` directement à ce composant —
  // rien n'est filtré en amont, contrairement à l'input (cf. en-tête). Tout ce qu'on ne déclare pas
  // ici est simplement ignoré, jamais reposé sur le <select> natif.
  return (
    <select
      // ⚠️ `truncate` (overflow-hidden + ellipsis) : sans lui, un `<select>` natif coupe le nom du
      // pays choisi net, sans "…" — constaté visuellement sur "Colombia" → "Colomb" à `w-24`.
      className={`input ${FIELD_MIN_HEIGHT} w-28 truncate shrink-0 rounded-r-none`}
      value={value ?? "ZZ"}
      disabled={disabled}
      name={name}
      aria-label={ariaLabel}
      data-testid={testId}
      onChange={(event) => {
        const nextValue = event.target.value;
        onChange(nextValue === "ZZ" ? undefined : (nextValue as Country));
      }}
    >
      {options.map((option) => (
        <option key={option.value ?? "ZZ"} value={option.value ?? "ZZ"}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function PhoneField({
  label,
  countryLabel,
  value,
  onChange,
  name,
  defaultCountry = "CO",
  width = "full",
  isRequired,
  isDisabled,
  error,
  hint,
  placeholder,
  testId,
}: PhoneFieldProps) {
  const locale = useLocale();
  const base = useId();
  const inputId = sousId(testId, "input") ?? `${base}-input`;
  const idAide = hint ? `${base}-hint` : undefined;
  const idErreur = error ? `${base}-error` : undefined;
  const describedBy = [idAide, idErreur].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`flex flex-col gap-1 ${FIELD_WIDTH_CLASSES[width]}`} data-testid={testId}>
      <Label htmlFor={inputId} isRequired={isRequired}>{label}</Label>
      <PhoneInput
        name={name}
        value={value || undefined}
        onChange={(next) => onChange(next ?? "")}
        defaultCountry={defaultCountry}
        labels={LOCALE_LABELS[locale as "es" | "en"] ?? es}
        disabled={isDisabled}
        containerComponent={PhoneFieldContainer}
        inputComponent={PhoneFieldInput}
        countrySelectComponent={PhoneFieldCountrySelect}
        numberInputProps={{
          id: inputId,
          placeholder,
          "aria-describedby": describedBy,
          "aria-invalid": error ? true : undefined,
          "aria-required": isRequired ? true : undefined,
          "data-testid": inputId,
        }}
        countrySelectProps={{
          ariaLabel: countryLabel,
          testId: sousId(testId, "country"),
        }}
      />
      {hint ? (
        <span id={idAide} className="text-sm text-muted" data-testid={sousId(testId, "hint")}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={idErreur} className="error-message" data-testid={sousId(testId, "error")}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
