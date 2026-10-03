import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Migas } from "./Migas";

// Ce qu'on vient juger ici tient en deux points, tous deux invisibles dans un test :
//  • le fil reste sur UNE ligne aux deux gabarits, ou il se coupe proprement ;
//  • le dernier élément se distingue des précédents sans que la couleur soit le seul signal
//    (règle `.claude/rules/ui.md`) — HeroUI le rend en `<span>` non cliquable, pas en lien gris.
const meta = {
  title: "Affichage/Migas",
  component: Migas,
  parameters: { layout: "padded" },
  args: { etiqueta: "Ruta de navegación", locale: "es" as const },
} satisfies Meta<typeof Migas>;

export default meta;
type Story = StoryObj<typeof meta>;

// Une page de listing : deux niveaux. C'est le cas des quatre routes de type (spec 29 §5c).
export const DosNiveles: Story = {
  args: {
    items: [{ nombre: "Inicio", href: "/" }, { nombre: "Alojamientos" }],
  },
};

// Une page de catégorie : trois niveaux, le cas de `/es/actividades/kayak` (§5b).
export const TresNiveles: Story = {
  args: {
    items: [
      { nombre: "Inicio", href: "/" },
      { nombre: "Actividades", href: "/actividades" },
      { nombre: "Kayak" },
    ],
  },
};

// ⚠️ L'état limite à regarder en Mobile 390. Le nom d'une catégorie vient du contenu partenaire :
// personne ne garantit qu'il tient en un mot, et un admin peut écrire une phrase entière. Le fil
// ne doit ni déborder de l'écran ni forcer la page à défiler horizontalement — c'est une violation
// d'accessibilité, pas un défaut esthétique (`.claude/rules/ui.md`).
export const NombreLargo: Story = {
  args: {
    items: [
      { nombre: "Inicio", href: "/" },
      { nombre: "Actividades", href: "/actividades" },
      { nombre: "Deportes náuticos y experiencias acuáticas en el embalse de Guatapé" },
    ],
  },
};

// La page « Otras actividades » (§5b) : son nom vient de next-intl, pas de la base — mais le fil
// est identique à celui d'une vraie catégorie, et c'est voulu : pour le visiteur, c'en est une.
export const OtrasActividades: Story = {
  args: {
    items: [
      { nombre: "Inicio", href: "/" },
      { nombre: "Actividades", href: "/actividades" },
      { nombre: "Otras actividades" },
    ],
  },
};

// Plan 41, item C3 : un nom de CATÉGORIE long au milieu du fil. Sous `sm`, il est tronqué à environ
// 14 caractères avec une ellipse ; le dernier niveau va sur deux lignes au plus. Le texte entier
// reste dans le DOM (nom accessible), et le JSON-LD de la page ne change pas.
export const IntermedioLargo: Story = {
  args: {
    items: [
      { nombre: "Inicio", href: "/" },
      { nombre: "Actividades", href: "/actividades" },
      { nombre: "Deportes náuticos y experiencias acuáticas", href: "/actividades/deportes-nauticos" },
      { nombre: "Kayak al atardecer en el embalse con guía bilingüe y equipo incluido" },
    ],
  },
};

// Sa place à venir : le bandeau OR des pages intérieures (item S2). Les couleurs suivent la surface
// — liens marine soulignés au survol, page courante marine 600, séparateurs marine à 60 %.
export const SobreOro: Story = {
  args: TresNiveles.args,
  render: (args) => (
    <div data-superficie="or" className="p-4">
      <Migas {...args} />
    </div>
  ),
};
