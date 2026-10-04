"use client";

import { useId } from "react";
import { Checkbox as HeroUICheckbox } from "@hifago/ui";
import { sousId } from "./Field";

// La case à cocher de la vitrine (2026-09-02, vague 3).
//
// Absorbe les huit lignes de `CheckoutForm.tsx:388-396` (`Checkbox` + `Checkbox.Content` +
// `Checkbox.Control` + `Checkbox.Indicator`), seul usage du dépôt aujourd'hui : le consentement
// marketing.
//
// ⚠️ Ce composant fait une chose que les trois autres n'ont pas à faire : relier l'aide et
// l'erreur À LA MAIN. `Field`, `Textarea` et `Select` sont enveloppés par un champ react-aria qui
// pose `aria-describedby` tout seul ; la case à cocher, elle, n'a pas de conteneur de ce genre —
// `Description`/`ErrorMessage` y seraient de simples textes, reliés à rien. D'où les `id` générés
// et le `aria-describedby` explicite ci-dessous, vérifiés par un test : c'est précisément le genre
// de lien qui manque sans que rien ne le montre à l'écran.
//
// ⚠️ Piège de test à connaître (CLAUDE.md §11 point 5) : cliquer le wrapper racine d'un `Checkbox`
// HeroUI laisse l'état INCHANGÉ, sans lever d'erreur. Seul un clic sur l'`<input>` fonctionne.
//
// `"use client"` obligatoire (barrel @hifago/ui, CLAUDE.md §11.16).
export type CheckboxProps = {
  /** Libellé déjà traduit — un atome ne traduit rien. */
  label: string;
  isSelected: boolean;
  onChange: (isSelected: boolean) => void;
  name?: string;
  isDisabled?: boolean;
  /** Message d'erreur déjà traduit (« vous devez accepter… »). Rend la case invalide. */
  error?: string;
  /** Texte d'aide déjà traduit. Reste visible en erreur, contrairement aux autres champs. */
  hint?: string;
  testId?: string;
};

export function Checkbox({
  label,
  isSelected,
  onChange,
  name,
  isDisabled,
  error,
  hint,
  testId,
}: CheckboxProps) {
  const base = useId();
  const idAide = hint ? `${base}-hint` : undefined;
  const idErreur = error ? `${base}-error` : undefined;
  const describedBy = [idAide, idErreur].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1">
      <HeroUICheckbox
        // ⚠️ Cible tactile : la ligne d'une case à cocher fait environ 20 px de haut, très en
        // dessous des 44 px du README. Le plancher est posé sur la racine — qui est le <label>
        // cliquable — et non sur la case seule, pour que toute la ligne reste visable au pouce.
        // 44 px et non les 48 d'un champ (`FIELD_MIN_HEIGHT`) : c'est une ligne, pas une boîte.
        className="min-h-11 justify-center"
        name={name}
        isSelected={isSelected}
        onChange={onChange}
        isDisabled={isDisabled}
        isInvalid={Boolean(error)}
        aria-describedby={describedBy}
        data-testid={testId}
      >
        <HeroUICheckbox.Content>
          <HeroUICheckbox.Control>
            <HeroUICheckbox.Indicator />
          </HeroUICheckbox.Control>
          {label}
        </HeroUICheckbox.Content>
      </HeroUICheckbox>
      {hint ? (
        <span id={idAide} className="text-sm text-muted" data-testid={sousId(testId, "hint")}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span
          id={idErreur}
          // ⚠️ La classe BEM de HeroUI, pas une classe arbitraire écrite ici. Ce composant portait
          // la bonne couleur à la main — `--danger` est un aplat, mesuré à 3.56:1, sous le seuil
          // WCAG de 4.5:1 — pendant que Field, Textarea et Select déléguaient à HeroUI et
          // rendaient donc du texte insuffisamment contrasté. La décision est remontée dans
          // packages/ui/src/styles/globals.css le 2026-09-02 : `.error-message` y est recalibrée
          // pour tout le thème vitrine, et les quatre composants la suivent depuis un seul endroit.
          className="error-message"
          data-testid={sousId(testId, "error")}
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}
