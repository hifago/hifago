import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PageShell } from "@/components/atoms/PageShell";
import { PeopleField } from "./PeopleField";

// Le filtre « nombre de personnes ».
//
// ⚠️ `valueLabel` est calculé ICI, dans la story, exactement comme l'appelant réel le fera avec
// `t("people", { count })` : « 1 persona » / « 2 personas » n'est pas du formatage mais de la
// traduction accordée, et le composant ne traduit rien.
//
// ⚠️ Le contenu d'un popover fermé n'est pas dans le DOM : les stories « ouvert » prennent le
// déclencheur au montage.
const meta = {
  title: "Saisie/PeopleField",
  component: PeopleField,
  parameters: { layout: "padded" },
  args: {
    value: null,
    onChange: () => {},
    placeholderLabel: "Personas",
    fieldLabel: "¿Cuántas personas?",
    stepLabels: { increment: "Añadir una persona", decrement: "Quitar una persona" },
    testId: "personas",
  },
} satisfies Meta<typeof PeopleField>;

export default meta;
type Story = StoryObj<typeof meta>;

function accord(nombre: number): string {
  return nombre === 1 ? "1 persona" : `${nombre} personas`;
}

function Cadre({
  valeurInitiale = null,
  ouvrir = false,
  min,
  max,
  isDisabled,
}: {
  valeurInitiale?: number | null;
  ouvrir?: boolean;
  min?: number;
  max?: number;
  isDisabled?: boolean;
}) {
  const [nombre, setNombre] = useState<number | null>(valeurInitiale);

  useEffect(() => {
    if (!ouvrir) return;
    document.querySelector<HTMLButtonElement>('[data-testid="personas-trigger"]')?.click();
  }, [ouvrir]);

  return (
    <PageShell variant="pagina">
      <PeopleField
        value={nombre}
        onChange={setNombre}
        min={min}
        max={max}
        placeholderLabel="Personas"
        valueLabel={nombre === null ? undefined : accord(nombre)}
        fieldLabel="¿Cuántas personas?"
        stepLabels={{ increment: "Añadir una persona", decrement: "Quitar una persona" }}
        isDisabled={isDisabled}
        testId="personas"
      />
      <pre className="text-xs" data-testid="valeur">
        {nombre === null ? "(aucun nombre)" : String(nombre)}
      </pre>
    </PageShell>
  );
}

export const Vide: Story = { render: () => <Cadre /> };

export const AvecValeur: Story = { render: () => <Cadre valeurInitiale={3} /> };

export const Ouvert: Story = { render: () => <Cadre ouvrir valeurInitiale={2} /> };

// Au minimum : le bouton « − » doit être inerte, pas seulement sans effet.
export const AuMinimum: Story = { render: () => <Cadre ouvrir valeurInitiale={1} min={1} /> };

// Au maximum : le bouton « + » doit l'être aussi. C'est ici qu'on tente `abc`, `0` et un nombre
// au-dessus du plafond au clavier — react-aria analyse les nombres SELON LA LOCALE.
export const AuMaximum: Story = { render: () => <Cadre ouvrir valeurInitiale={8} min={1} max={8} /> };

export const Desactive: Story = { render: () => <Cadre isDisabled valeurInitiale={2} /> };
