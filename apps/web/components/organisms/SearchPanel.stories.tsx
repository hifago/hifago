import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { localeCalendrier } from "@/components/molecules/Calendar";
import { PageShell } from "@/components/atoms/PageShell";
import type { SearchSuggestion } from "./SearchBar";
import { SearchPanel, type SearchCriteria, type SearchPanelLabels } from "./SearchPanel";

// Le bloc de recherche complet : la barre, et les deux filtres sous elle.
//
// ⚠️ Dates FIGÉES sur septembre 2026 (même discipline que `Calendar` et `DateRangeField`), et
// libellés fournis à la main : ce lot n'ajoute AUCUNE clé de traduction, tout arrive déjà traduit
// en props. C'est ce qui le rend sans collision avec n'importe quel autre agent en vol.
const AUJOURDHUI = "2026-09-15";

const SUGGESTIONS: SearchSuggestion[] = [
  { id: "p-kayak", label: "Kayak en el Embalse de Guatapé", meta: "Actividad en Guatapé", kind: "product" },
  { id: "c-acuaticas", label: "Actividades acuáticas", meta: "12 actividades", kind: "category" },
  { id: "e-kayam", label: "Casa Kayam", meta: "Alojamiento en Guatapé", kind: "establishment" },
];

function libelles(nombre: number | null): SearchPanelLabels {
  return {
    search: {
      label: "Buscar actividades, alojamientos o lugares",
      placeholder: "¿Qué quieres hacer en Guatapé?",
      submitLabel: "Buscar",
      emptyLabel: "No encontramos nada con ese texto.",
    },
    dates: {
      placeholderLabel: "Fechas",
      calendar: { complet: "Completo", selectionne: "seleccionado", aujourdhui: "hoy" },
    },
    people: {
      placeholderLabel: "Personas",
      fieldLabel: "¿Cuántas personas?",
      stepLabels: { increment: "Añadir una persona", decrement: "Quitar una persona" },
      // Accordé par l'appelant — voir `PeopleFieldProps.valueLabel`.
      valueLabel: nombre === null ? undefined : nombre === 1 ? "1 persona" : `${nombre} personas`,
    },
  };
}

const VIDE: SearchCriteria = { query: "", dates: null, people: null };

const meta = {
  title: "Structure/SearchPanel",
  component: SearchPanel,
  parameters: { layout: "padded" },
  args: {
    criteria: VIDE,
    onCriteriaChange: () => {},
    onSubmit: () => {},
    suggestions: SUGGESTIONS,
    onSuggestionSelect: () => {},
    aujourdIso: AUJOURDHUI,
    locale: localeCalendrier("es"),
    labels: libelles(null),
    testId: "panneau",
  },
} satisfies Meta<typeof SearchPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

function Cadre({ initial = VIDE }: { initial?: SearchCriteria }) {
  const [criteres, setCriteres] = useState<SearchCriteria>(initial);
  const [journal, setJournal] = useState<string[]>([]);

  return (
    <PageShell variant="large">
      <SearchPanel
        criteria={criteres}
        onCriteriaChange={setCriteres}
        onSubmit={(c) =>
          setJournal((j) => [
            ...j,
            `RECHERCHE → texte: « ${c.query} » · dates: ${
              c.dates ? `${c.dates.debut} → ${c.dates.fin ?? "(rien)"}` : "(aucune)"
            } · personas: ${c.people ?? "(aucune)"}`,
          ])
        }
        suggestions={SUGGESTIONS}
        onSuggestionSelect={(s) => setJournal((j) => [...j, `SUGGESTION → ${s.label}`])}
        aujourdIso={AUJOURDHUI}
        locale={localeCalendrier("es")}
        labels={libelles(criteres.people)}
        testId="panneau"
      />
      {/* Le journal n'appartient pas au composant : c'est la story qui rend visible ce qu'il émet. */}
      <pre
        className="min-h-16 rounded-[var(--radius)] border border-border p-3 text-xs"
        data-testid="journal"
      >
        {journal.join("\n") || "(rien émis pour l'instant)"}
      </pre>
    </PageShell>
  );
}

export const Vide: Story = { render: () => <Cadre /> };

export const ToutRempli: Story = {
  render: () => (
    <Cadre
      initial={{
        query: "kayak",
        dates: { debut: "2026-09-18", fin: "2026-09-22" },
        people: 4,
      }}
    />
  ),
};

// ⚠️ LA story du lot, et le seul moyen de vérifier À L'ŒIL la jonction du §5. Protocole :
//   1. choisir des dates, puis un nombre de personnes ;
//   2. taper « kayak » dans la barre, SANS toucher aux flèches ;
//   3. presser `Entrée` — le journal doit écrire les TROIS critères, pas seulement le texte.
// C'est ce que `SearchBar` seul ne peut pas faire : son `onSubmit` ne rend que le texte tapé.
export const Interactive: Story = { render: () => <Cadre /> };

// L'espagnol fait 20 à 25 % de plus que l'anglais, et c'est lui qui fait déborder. À regarder à
// 390 px : les deux déclencheurs doivent passer à la ligne plutôt que sortir de l'écran.
export const LibellesLongs: Story = {
  render: () => (
    <Cadre
      initial={{
        query: "paseo en lancha por el embalse con guía local",
        dates: { debut: "2026-09-28", fin: "2026-10-04" },
        people: 12,
      }}
    />
  ),
};
