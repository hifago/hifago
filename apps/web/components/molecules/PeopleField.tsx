"use client";

import { Label, NumberField, Popover } from "@hifago/ui";
import { FilterTrigger } from "./DateRangeField";

// Le filtre « nombre de personnes » du bloc de recherche (2026-09-02, vague 8).
//
// `"use client"` obligatoire : ce fichier importe le barrel `@hifago/ui` (CLAUDE.md §11.16).
//
// ⚠️ Le déclencheur vient de `DateRangeField` — voir le commentaire de `FilterTrigger` : les deux
// filtres partagent EXACTEMENT la même forme, et le lot a figé la liste des fichiers à trois. Le
// sortir dans son propre fichier est une suite, pas un oubli.
//
// ⚠️ Un popover pour un simple pas-à-pas, c'est un CLIC DE PLUS qu'un `−  2  +` posé directement
// dans la rangée. C'est assumé : Jérôme a choisi deux déclencheurs de même forme, et un contrôle
// nu à côté d'un déclencheur à chevron aurait cassé l'alignement du bloc. Le coût est signalé au
// rapport plutôt que caché — c'est à lui d'arbitrer s'il veut revenir dessus.
//
// ⚠️ Le popover est légitime ici pour la même raison que sur les dates : aucun contenu indexable,
// aucun lien. La règle de `LanguageSwitcher` (qui refuse le popover parce qu'il masque ses liens
// au rendu serveur) ne s'applique pas — détaillé dans l'en-tête de `DateRangeField`.

function IconePersonnes() {
  return (
    // Un GROUPE plein, comme sur la maquette : la personne du milieu devant deux autres. Plein et
    // non au trait : il vit dans une pastille de 24 px, où un trait de 2 px se perdrait.
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5 shrink-0" aria-hidden="true">
      <circle cx="12" cy="7.5" r="3.6" />
      <path d="M5.2 20.5c0-3.9 3-6.4 6.8-6.4s6.8 2.5 6.8 6.4z" />
      <circle cx="4.6" cy="9.6" r="2.5" />
      <path d="M0.4 18.6c0-2.9 1.8-4.8 4.3-4.8 0.9 0 1.7 0.2 2.4 0.7-1.4 1.2-2.3 2.6-2.6 4.1z" />
      <circle cx="19.4" cy="9.6" r="2.5" />
      <path d="M23.6 18.6c0-2.9-1.8-4.8-4.3-4.8-0.9 0-1.7 0.2-2.4 0.7 1.4 1.2 2.3 2.6 2.6 4.1z" />
    </svg>
  );
}

export type PeopleFieldProps = {
  value: number | null;
  onChange: (value: number | null) => void;
  /** Défaut 1 : une recherche à zéro personne ne veut rien dire. */
  min?: number;
  max?: number;
  /** Ce qu'affiche le déclencheur quand aucun nombre n'est choisi. Déjà traduit. */
  placeholderLabel: string;
  /**
   * Ce qu'il affiche quand un nombre l'est. Déjà traduit ET DÉJÀ ACCORDÉ.
   * ⚠️ Une chaîne, calculée par l'appelant, et pas un gabarit interne : « 1 persona » / « 2
   * personas » n'est pas du formatage mais de la traduction accordée, que seul `next-intl` sait
   * faire (`t("people", { count })`) et qui vit chez l'appelant. L'état étant contrôlé, il se
   * recalcule à chaque changement sans effort.
   */
  valueLabel?: string;
  /** Le libellé du champ DANS le popover, VISIBLE. Déjà traduit. */
  fieldLabel: string;
  /**
   * ⚠️ REQUIS, et déjà traduits. Sans eux, react-aria nomme ses deux boutons « Increase » et
   * « Decrease » — EN ANGLAIS EN DUR, quelle que soit la langue de la page (mesuré au rendu sur
   * une interface espagnole). C'est exactement le défaut que `Calendar` corrige avec ses
   * `libelles` : react-day-picker y écrit « Today, » et « , selected » de la même façon. Les
   * rendre obligatoires est le seul moyen de ne pas servir de l'anglais à un visiteur
   * hispanophone.
   */
  stepLabels: { increment: string; decrement: string };
  isDisabled?: boolean;
  testId?: string;
};

export function PeopleField({
  value,
  onChange,
  min = 1,
  max,
  placeholderLabel,
  valueLabel,
  fieldLabel,
  stepLabels,
  isDisabled,
  testId,
}: PeopleFieldProps) {
  const sousId = (suffixe: string) => (testId ? `${testId}-${suffixe}` : undefined);

  return (
    <Popover>
      <FilterTrigger
        icon={<IconePersonnes />}
        fieldLabel={fieldLabel}
        // `valueLabel` absent alors qu'une valeur existe : on affiche le nombre nu plutôt que le
        // substitut. Un « Personas » affiché sur un filtre à 3 personnes serait un mensonge.
        value={value === null ? null : (valueLabel ?? String(value))}
        placeholderLabel={placeholderLabel}
        isDisabled={isDisabled}
        testId={sousId("trigger")}
      />
      <Popover.Content>
        <Popover.Dialog aria-label={fieldLabel} className="w-[calc(100vw-3rem)] max-w-xs">
          <NumberField
            value={value ?? undefined}
            // ⚠️ `NaN` et pas `null` quand le champ est vidé : c'est ce que react-aria envoie, et
            // le laisser remonter tel quel mettrait `NaN` dans les critères de recherche.
            onChange={(nombre) => onChange(Number.isNaN(nombre) ? null : nombre)}
            minValue={min}
            maxValue={max}
            isDisabled={isDisabled}
            data-testid={sousId("field")}
          >
            {/* Libellé VISIBLE, exigé par le §7 du lot : un pas-à-pas sans intitulé ne dit pas ce
                qu'il compte. */}
            <Label>{fieldLabel}</Label>
            {/* ⚠️ `size-11` = 44 px sur les deux boutons. Mesuré sans : 40 × 40, soit sous la
                cible tactile qu'exige components/README.md — et un pas-à-pas est précisément ce
                qu'on actionne au pouce, plusieurs fois de suite. HeroUI les dimensionne sur la
                hauteur du champ, qui vaut 40. */}
            <NumberField.Group>
              <NumberField.DecrementButton
                aria-label={stepLabels.decrement}
                className="size-11 shrink-0"
                data-testid={sousId("decrement")}
              />
              <NumberField.Input data-testid={sousId("input")} />
              <NumberField.IncrementButton
                aria-label={stepLabels.increment}
                className="size-11 shrink-0"
                data-testid={sousId("increment")}
              />
            </NumberField.Group>
          </NumberField>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
