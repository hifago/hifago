import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { localeCalendrier } from "./Calendar";
import { PageShell } from "@/components/atoms/PageShell";
import type { CalendarLibelles, PlageCalendrier } from "./Calendar";
import { DateRangeField } from "./DateRangeField";

// Le filtre « dates » du bloc de recherche.
//
// ⚠️ Toutes les dates sont FIGÉES sur septembre 2026 et « aujourd'hui » arrive en prop — même
// discipline que les stories de `Calendar` : le composant refuse de lire l'horloge, une story qui
// la lirait montrerait un mois différent chaque jour et le lot de jours éteints cesserait d'être
// celui qu'on croit vérifier.
//
// ⚠️ Le contenu d'un popover FERMÉ n'est pas dans le DOM. Les stories « ouvert » prennent donc le
// déclencheur au montage, comme le ferait un visiteur — sans ça il n'y a rien à regarder.
const AUJOURDHUI = "2026-09-15";

const LIBELLES_CALENDRIER: CalendarLibelles = {
  complet: "Completo",
  selectionne: "seleccionado",
  aujourdhui: "hoy",
};

const meta = {
  title: "Saisie/DateRangeField",
  component: DateRangeField,
  parameters: { layout: "padded" },
  args: {
    value: null,
    onChange: () => {},
    aujourdIso: AUJOURDHUI,
    placeholderLabel: "Fechas",
    calendarLabels: LIBELLES_CALENDRIER,
    locale: localeCalendrier("es"),
    testId: "dates",
  },
} satisfies Meta<typeof DateRangeField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Le composant est CONTRÔLÉ : sans état autour, choisir une date n'afficherait rien. */
function Cadre({
  valeurInitiale = null,
  ouvrir = false,
  isDisabled,
}: {
  valeurInitiale?: PlageCalendrier | null;
  ouvrir?: boolean;
  isDisabled?: boolean;
}) {
  const [plage, setPlage] = useState<PlageCalendrier | null>(valeurInitiale);

  useEffect(() => {
    if (!ouvrir) return;
    document.querySelector<HTMLButtonElement>('[data-testid="dates-trigger"]')?.click();
  }, [ouvrir]);

  return (
    <PageShell variant="large">
      <DateRangeField
        value={plage}
        onChange={setPlage}
        aujourdIso={AUJOURDHUI}
        placeholderLabel="Fechas"
        calendarLabels={LIBELLES_CALENDRIER}
        locale={localeCalendrier("es")}
        isDisabled={isDisabled}
        testId="dates"
      />
      <pre className="text-xs" data-testid="valeur">
        {plage ? `${plage.debut} → ${plage.fin ?? "(rien)"}` : "(aucune date)"}
      </pre>
    </PageShell>
  );
}

export const Vide: Story = { render: () => <Cadre /> };

// ⚠️ `fin === debut` : c'est l'état RÉEL après le premier clic, react-day-picker posant
// `{from: X, to: X}` (acquis du 2026-08-29). `formatRange` l'effondre tout seul en une seule date.
export const UneSeuleDate: Story = {
  render: () => <Cadre valeurInitiale={{ debut: "2026-09-18", fin: "2026-09-18" }} />,
};

export const UnePlage: Story = {
  render: () => <Cadre valeurInitiale={{ debut: "2026-09-18", fin: "2026-09-22" }} />,
};

// Le cas où le formatage change de forme : le mois doit apparaître des DEUX côtés.
export const PlageSurDeuxMois: Story = {
  render: () => <Cadre valeurInitiale={{ debut: "2026-09-28", fin: "2026-10-04" }} />,
};

// ⚠️ LA story à regarder à 390 px : c'est celle qui prouve que la grille tient dans l'écran. Le
// calendrier vaut `max-w-sm` (384 px) pour un gabarit de 390 — sans la largeur posée sur le
// popover, il déborde. On y voit aussi les jours du 1 au 14 éteints et la flèche « mois
// précédent » inerte.
export const OuvertMoisCourant: Story = { render: () => <Cadre ouvrir /> };

export const OuvertAvecPlage: Story = {
  render: () => <Cadre ouvrir valeurInitiale={{ debut: "2026-09-18", fin: "2026-09-22" }} />,
};

export const Desactive: Story = {
  render: () => <Cadre isDisabled valeurInitiale={{ debut: "2026-09-18", fin: "2026-09-22" }} />,
};
