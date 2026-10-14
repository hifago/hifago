import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BandeauLogos, type LogoBandeau } from "./BandeauLogos";

// Le bandeau déroulant de logos du pied.
//
// ⚠️ Toujours montré sur la surface MARINE : c'est là qu'il vit, et le logo de la mairie est en
// lettres blanches — sur une surface claire il disparaît. À regarder aux trois gabarits : la boucle
// ne doit laisser aucun trou à droite, même à 1 280 px avec un seul logo. Pour voir l'arrêt du
// mouvement : émuler `prefers-reduced-motion` dans les outils du navigateur.
const MAIRIE: LogoBandeau = {
  src: "/logos/municipio-guatape.webp",
  alt: "Municipio de Guatapé · Departamento de Antioquia",
  width: 443,
  height: 116,
};
const PUEBLO: LogoBandeau = {
  src: "/logos/guatape-pueblo-de-zocalos.webp",
  alt: "Guatapé · Pueblo de Zócalos y Colores",
  width: 805,
  height: 574,
};

const meta = {
  title: "Affichage/BandeauLogos",
  component: BandeauLogos,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div data-superficie="marine">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BandeauLogos>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaut: Story = {
  args: { logos: [MAIRIE, PUEBLO], testId: "bandeau" },
};

// Le cas limite du remplissage : un logo seul, répété huit fois par groupe.
export const UnSeulLogo: Story = {
  args: { logos: [PUEBLO], testId: "bandeau" },
};

// La liste telle qu'elle grandira : au-delà de huit logos, plus aucune répétition dans un groupe.
export const ListeLongue: Story = {
  args: {
    logos: Array.from({ length: 5 }, () => [MAIRIE, PUEBLO]).flat(),
    testId: "bandeau",
  },
};

// Sans logo, le composant ne rend rien : le pied garde son bord haut nu.
export const Vide: Story = {
  args: { logos: [], testId: "bandeau" },
};
