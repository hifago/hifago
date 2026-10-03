import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { TituloRubrica } from "./TituloRubrica";

// Plan 41, S1. Ce que ces stories servent à regarder : les trois tailles sur chacune des trois
// surfaces (le point bleu poudre sur l'or, or sur le clair et sur le marine ; le trait marine, or sur
// le marine — arbitrage D15), et un titre long qui passe sur deux lignes avec son point au bout.
//
// La taille `portada` est en `cqw` : chaque surface est donc aussi un `@container`, comme la
// section de l'accueil. À 1 280 px, le cadre de la story fait la colonne de l'accueil (960 px) pour
// que `portada` y rende ses 60 px.
const meta = {
  title: "Affichage/TituloRubrica",
  component: TituloRubrica,
  parameters: { layout: "fullscreen" },
  args: { as: "h2", texto: "Actividades", tamano: "seccion" },
} satisfies Meta<typeof TituloRubrica>;

export default meta;
type Story = StoryObj<typeof meta>;

function Surface({ superficie, children }: { superficie: "or" | "clara" | "marine"; children: ReactNode }) {
  return (
    <div data-superficie={superficie} className="px-5 py-8 sm:px-8">
      <div className="@container mx-auto flex max-w-[60rem] flex-col gap-10">{children}</div>
    </div>
  );
}

// Les trois tailles l'une sous l'autre. Un seul <h1> par story : `pagina` est le seul en h1.
function TroisTailles() {
  return (
    <>
      <TituloRubrica as="h2" texto="Actividades" tamano="portada" />
      <TituloRubrica as="h1" texto="Mi viaje" tamano="pagina" />
      <TituloRubrica as="h2" texto="Habitaciones" tamano="seccion" />
    </>
  );
}

export const SobreOro: Story = {
  render: () => (
    <Surface superficie="or">
      <TroisTailles />
    </Surface>
  ),
};

export const SobreClaro: Story = {
  render: () => (
    <Surface superficie="clara">
      <TroisTailles />
    </Surface>
  ),
};

export const SobreMarino: Story = {
  render: () => (
    <Surface superficie="marine">
      <TroisTailles />
    </Surface>
  ),
};

// À regarder à 390 px : le titre passe sur deux lignes, le point reste collé au dernier mot, le
// trait reste sous la dernière ligne.
export const TituloLargo: Story = {
  render: () => (
    <Surface superficie="or">
      <TituloRubrica as="h1" texto="Alojamientos para tu retiro de yoga en Guatapé" tamano="pagina" />
      <TituloRubrica as="h2" texto="Experiencias en el embalse y alrededores" tamano="seccion" />
    </Surface>
  ),
};

// Le nom d'un produit ou d'un établissement : police de titre, SANS point (§3.6 du plan).
export const NombrePropio: Story = {
  render: () => (
    <Surface superficie="or">
      <TituloRubrica as="h1" texto="Casa Kayam Hostel & Café" tamano="pagina" punto={false} />
    </Surface>
  ),
};
