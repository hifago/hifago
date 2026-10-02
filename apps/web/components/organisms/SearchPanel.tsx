"use client";

import { DateRangeField } from "@/components/molecules/DateRangeField";
import { PeopleField } from "@/components/molecules/PeopleField";
import type { CalendarLibelles, CalendarProps, PlageCalendrier } from "@/components/molecules/Calendar";
import { SearchBar, type SearchSuggestion } from "./SearchBar";

// Le bloc de recherche complet de l'accueil (2026-09-02, vague 8) : la barre de la vague 7, et
// sous elle les deux filtres. Rien d'autre.
//
// `"use client"` obligatoire : ses trois enfants importent le barrel `@hifago/ui`
// (CLAUDE.md §11.16).
//
// ⚠️ LES FILTRES SONT SOUS LA BARRE, PAS DANS LA PILULE (décision de Jérôme). Conséquence directe
// et voulue : `SearchBar.tsx` n'est pas rouvert. Les deux filtres sont ses FRÈRES dans le bloc.
// Sur mobile la barre perd son bouton « Buscar » (la touche de validation du clavier le remplace,
// d'où son `enterkeyhint="search"`), mais les deux filtres restent visibles aux deux gabarits :
// ce sont des contrôles, pas du contenu, il n'y a aucune raison d'en masquer un.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LA JONCTION QUI COMPTE
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ `SearchBar.onSubmit` rend LE TEXTE TAPÉ, pas les critères — c'est son contrat, et il vient
// d'une mesure : la vague 7 a constaté qu'`Entrée` seul ne déclenche RIEN dans un `ComboBox`
// react-aria, et a écrit six lignes pour qu'`Entrée` vaille « Rechercher ». Ce composant reçoit
// donc ce texte et le RECOMBINE avec ses filtres avant d'appeler son propre `onSubmit`. C'est la
// seule raison d'être de cette couche, et la story `Interactive` la met sous les yeux : `Entrée`
// au clavier doit émettre les TROIS critères, pas seulement le texte.
//
// ⚠️ UNE CONSÉQUENCE ASSUMÉE, à ne pas découvrir plus tard. `onSuggestionSelect` active une
// suggestion, qui peut être un vrai `<a href>` (la vague 7 l'a prévu). Cette navigation emporte le
// TEXTE et rien d'autre : atterrir sur une fiche produit PERD les dates et le nombre de personnes.
// C'est acceptable aujourd'hui — il n'existe pas encore de route de recherche pour les porter —
// mais ça cessera de l'être le jour où elle existera.

export type SearchCriteria = {
  query: string;
  dates: PlageCalendrier | null;
  people: number | null;
};

export type SearchPanelLabels = {
  search: {
    /** Nom accessible du champ, déjà traduit. */
    label: string;
    placeholder: string;
    submitLabel: string;
    /** Libellé du bouton pendant une recherche en cours, déjà traduit — cf. `SearchBar.pendingLabel`. */
    pendingLabel?: string;
    emptyLabel: string;
    /** Nom du bouton qui vide le champ, déjà traduit — cf. `SearchBar.clearLabel`. */
    clearLabel?: string;
  };
  dates: {
    placeholderLabel: string;
    calendar: CalendarLibelles;
  };
  people: {
    placeholderLabel: string;
    fieldLabel: string;
    /** Déjà ACCORDÉ par l'appelant (« 2 personas ») — voir `PeopleFieldProps.valueLabel`. */
    valueLabel?: string;
    /** Noms des deux boutons du pas-à-pas. REQUIS — voir `PeopleFieldProps.stepLabels`. */
    stepLabels: { increment: string; decrement: string };
  };
};

export type SearchPanelProps = {
  /**
   * ⚠️ UN OBJET DE CRITÈRES, PAS TROIS PROPS. Le quatrième filtre — le type d'activité, déjà
   * présent dans `CatalogBrowser` et promis à son propre lot — s'ajoutera DANS le type, sans
   * toucher à une seule signature. C'est ce qui évite de rouvrir ce composant à chaque filtre.
   */
  criteria: SearchCriteria;
  onCriteriaChange: (criteria: SearchCriteria) => void;
  /** Reçoit TOUS les critères, pas seulement le texte. */
  onSubmit: (criteria: SearchCriteria) => void;
  /** Une recherche est en cours (`useTransition` de `BuscadorInicio`) — répercuté sur `SearchBar`. */
  isPending?: boolean;
  suggestions: SearchSuggestion[];
  onSuggestionSelect: (suggestion: SearchSuggestion) => void;
  /** REQUIS. `todayInBogota()`, jamais l'heure du navigateur — descend jusqu'à `Calendar`. */
  aujourdIso: string;
  /** Locale date-fns, descendue au calendrier ET au formatage de la plage. Voir `DateRangeField`. */
  locale?: CalendarProps["locale"];
  labels: SearchPanelLabels;
  testId?: string;
};

export function SearchPanel({
  criteria,
  onCriteriaChange,
  onSubmit,
  isPending,
  suggestions,
  onSuggestionSelect,
  aujourdIso,
  locale,
  labels,
  testId,
}: SearchPanelProps) {
  const sousId = (suffixe: string) => (testId ? `${testId}-${suffixe}` : undefined);
  const modifier = (partiel: Partial<SearchCriteria>) => onCriteriaChange({ ...criteria, ...partiel });

  return (
    <div className="flex w-full flex-col gap-2" data-testid={testId}>
      <SearchBar
        value={criteria.query}
        onValueChange={(query) => modifier({ query })}
        suggestions={suggestions}
        onSuggestionSelect={onSuggestionSelect}
        // ⚠️ Le texte vient de la BARRE, pas de `criteria.query` : les deux sont identiques
        // puisque l'état est contrôlé, mais c'est celui que la barre soumet qui fait foi. Lire
        // l'état ici rendrait ce composant dépendant du moment où le parent le repropage.
        onSubmit={(query) => onSubmit({ ...criteria, query })}
        isPending={isPending}
        label={labels.search.label}
        placeholder={labels.search.placeholder}
        submitLabel={labels.search.submitLabel}
        pendingLabel={labels.search.pendingLabel}
        emptyLabel={labels.search.emptyLabel}
        clearLabel={labels.search.clearLabel}
        testId={sousId("bar")}
      />

      {/* `flex-wrap` plutôt qu'une grille : à 390 px les deux déclencheurs tiennent côte à côte
          avec des libellés courts, et passent à la ligne d'eux-mêmes dès qu'un libellé long les y
          oblige — l'espagnol fait 20 à 25 % de plus que l'anglais. Rien n'est masqué selon la
          largeur : ce sont des contrôles. */}
      {/* `-ml-4` : un bouton `ghost` garde son padding (16 px) sans fond pour le montrer — la
          pastille de « Fechas » tomberait 16 px à droite du bord de la barre. La maquette les aligne.
          Le fond de survol, lui, déborde de 16 px à gauche : c'est le comportement voulu. */}
      <div className="-ml-4 flex flex-wrap items-center gap-2" data-testid={sousId("filters")}>
        <DateRangeField
          value={criteria.dates}
          onChange={(dates) => modifier({ dates })}
          aujourdIso={aujourdIso}
          placeholderLabel={labels.dates.placeholderLabel}
          calendarLabels={labels.dates.calendar}
          locale={locale}
          testId={sousId("dates")}
        />
        <PeopleField
          value={criteria.people}
          onChange={(people) => modifier({ people })}
          placeholderLabel={labels.people.placeholderLabel}
          valueLabel={labels.people.valueLabel}
          fieldLabel={labels.people.fieldLabel}
          stepLabels={labels.people.stepLabels}
          testId={sousId("people")}
        />
      </div>
    </div>
  );
}
