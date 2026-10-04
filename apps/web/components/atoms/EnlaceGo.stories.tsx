import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { EnlaceGo } from "./EnlaceGo";

// Plan 41, S5. Ce que ces stories servent à regarder : la flèche bleu poudre sur l'or (celle de
// l'accueil) et bleu moyen sur le clair (`--flecha-go`), les deux tailles, et le survol (GO ×1,05,
// flèche +4 px). Pas de story sur le marine, et c'est voulu : `go.webp` est marine et bleu ciel, il
// y disparaîtrait — le composant ne s'y pose jamais.
//
// La taille `portada` est en `cqw` : le cadre est un `@container` de la largeur de la colonne de
// l'accueil (960 px à 1 280).
const meta = {
  title: "Actions/EnlaceGo",
  component: EnlaceGo,
  parameters: { layout: "fullscreen" },
  args: { href: "/actividades", label: "Más actividades", tamano: "normal" },
} satisfies Meta<typeof EnlaceGo>;

export default meta;
type Story = StoryObj<typeof meta>;

function Surface({ superficie, children }: { superficie: "or" | "clara"; children: ReactNode }) {
  return (
    <div data-superficie={superficie} className="px-5 py-8 sm:px-8">
      <div className="@container mx-auto flex max-w-[60rem] flex-col items-end gap-6">{children}</div>
    </div>
  );
}

export const SobreOro: Story = {
  render: (args) => (
    <Surface superficie="or">
      <EnlaceGo {...args} tamano="portada" />
      <EnlaceGo {...args} tamano="normal" />
    </Surface>
  ),
};

export const SobreClaro: Story = {
  render: (args) => (
    <Surface superficie="clara">
      <EnlaceGo {...args} tamano="portada" />
      <EnlaceGo {...args} href="/establecimientos/casa-kayam" label="Ver Casa Kayam" tamano="normal" />
    </Surface>
  ),
};
