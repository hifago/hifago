import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Title } from "./Title";

// Ce que ces stories servent à voir : que le NIVEAU et le RÔLE sont deux axes séparés. C'est la
// décision la moins évidente de l'atome, et la seule qu'on peut vérifier d'un coup d'œil — le
// panneau « Accessibility » vérifie l'ordre des titres pendant qu'on regarde leur rôle. Les rôles
// sont ceux de la charte (plan 41, §3.3) : `pagina`, `seccion`, `bloque`, `etiqueta`.
const meta = {
  title: "Affichage/Title",
  component: Title,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Title>;

export default meta;
type Story = StoryObj<typeof meta>;

// Le cas de loin le plus fréquent : le <h1> d'une page, `size` non renseigné, donc `pagina`.
export const Defaut: Story = {
  args: { as: "h1", children: "Alojamientos y actividades en Guatapé" },
};

// Les trois niveaux avec leur rôle par défaut, empilés dans l'ordre — h1 → h2 → h3, sans saut.
export const TousLesNiveaux: Story = {
  // `args` en plus du `render` : Storybook exige les props requises du composant même quand la
  // story rend elle-même (typage `Meta<typeof Title>`). Ils pilotent le premier titre, pour que les
  // contrôles de la barre latérale restent utiles au lieu d'être décoratifs.
  args: { as: "h1", children: "h1 — pagina par défaut" },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <Title {...args} />
      <Title as="h2">h2 — seccion par défaut</Title>
      <Title as="h3">h3 — bloque par défaut</Title>
    </div>
  ),
};

// Les quatre rôles, sous une fiche : c'est l'échelle réelle d'une page intérieure. `etiqueta` est
// en Poppins — jamais la police de titre sous 20 px.
export const TousLesRoles: Story = {
  args: { as: "h1", children: "Casa Kayam" },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <Title {...args} />
      <Title as="h2">Habitaciones</Title>
      <Title as="h3" size="bloque">
        Equipamiento
      </Title>
      <Title as="h3" size="etiqueta">
        General
      </Title>
    </div>
  ),
};

// ⚠️ La raison d'être de la prop `size`. Les <h2> « Disponibilidad » des formulaires de
// réservation se lisent comme des titres de bloc : sans `size`, on les écrirait <h3> pour obtenir
// ce rôle, et la hiérarchie sauterait un niveau sous un <h1>. Ici le <h2> reste un <h2>.
export const PetitH2: Story = {
  args: { as: "h2", size: "bloque", children: "Disponibilidad" },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <Title as="h1">Kayak en el embalse</Title>
      <Title {...args} />
    </div>
  ),
};

// Titre de 120 caractères : c'est la longueur réelle d'un nom de produit espagnol (« Recorrido
// guiado en lancha… », déjà en base). À regarder en Mobile 390 — c'est là que la césure se juge.
export const TexteLong: Story = {
  args: {
    as: "h1",
    children:
      "Recorrido guiado en lancha por el Embalse de Guatapé con parada fotográfica en la Piedra del Peñol",
  },
};
