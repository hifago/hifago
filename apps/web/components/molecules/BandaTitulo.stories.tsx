import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BandaTitulo } from "./BandaTitulo";

// La bande qui porte le titre d'une section du catalogue (2026-10-01, référence fournie par
// Jérôme : « PROJETS À LA UNE » sur ateliercestparla.com).
//
// ⚠️ CETTE STORY EXISTE PARCE QUE LE COMPORTEMENT NE SE VOIT QU'EN FAISANT DÉFILER. La bande ne
// s'anime pas toute seule : elle avance quand la page descend et REVIENT quand elle remonte. Une
// capture ne le montre pas, un test en jsdom le prouve sans le donner à voir — il faut la molette.
// D'où le bloc de 200 vh en dessous : sans de quoi scroller, la story afficherait un titre
// parfaitement immobile et on la croirait cassée.
//
// ⚠️ Et le corollaire : en « mouvement réduit » (réglage système, ou l'émulation
// `prefers-reduced-motion` de DevTools), la bande ne doit PLUS bouger du tout et ne rendre qu'UNE
// copie du titre — c'est délibéré (WCAG 2.3.3), pas une panne.
const meta = {
  title: "Molécules/BandaTitulo",
  component: BandaTitulo,
  parameters: { layout: "fullscreen" },
  args: { titulo: "Actividades", tituloAs: "h2", testId: "banda" },
  decorators: [
    (Story) => (
      // Le fond or et le texte marine viennent de la SECTION en production, jamais de la bande
      // elle-même — elle hérite de `currentColor`. Les reproduire ici est ce qui rend la story
      // honnête : posée sur un fond blanc, elle ne dirait rien du contraste réellement obtenu.
      <div className="bg-accent text-accent-foreground">
        <Story />
        <div className="h-[200vh] p-6 text-sm">
          Faites défiler : la bande avance vers la gauche, puis revient quand vous remontez.
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof BandaTitulo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defecto: Story = { name: "Actividades" };

// Le titre le plus COURT du catalogue, et le cas limite de la boucle : moins de texte par copie,
// donc un segment plus étroit, donc plus de copies nécessaires pour couvrir un écran large. Les
// huit copies sont dimensionnées pour tenir jusqu'à ~2 560 px — à vérifier ici, pas en théorie.
export const TituloCorto: Story = { args: { titulo: "Camps" }, name: "Titre court (Camps)" };

// Le plus LONG des cinq. À regarder à 390 px : une seule copie occupe alors plus que l'écran, et
// la bande doit rester lisible sans jamais faire défiler la PAGE horizontalement.
export const TituloLargo: Story = {
  args: { titulo: "Alojamientos" },
  name: "Titre long (Alojamientos)",
};
