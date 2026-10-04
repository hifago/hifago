import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { TARJETAS_POR_TIPO } from "@/.storybook/support/fixtures/catalogo";
import type { TarjetaOferta } from "@/lib/catalog/tipos";
import { TeselaOferta } from "./TeselaOferta";

// Plan 41, S4. Les offres sont celles des écrans (`.storybook/support/fixtures/catalogo.ts`), avec
// leurs vraies photos : c'est sur une photo claire qu'on juge les bulles, et sur un nom long qu'on
// juge le cartouche. Ce que ces stories servent à regarder :
//   - les quatre formes du prix et la capacité, une bulle par information, jamais une bulle vide ;
//   - la carte groupée (« 3 alojamientos » à la place de l'établissement) ;
//   - la même tuile à trois largeurs (rail de l'accueil 202 / 288 px, grille 300 px) : intérieur
//     proportionnel, arrondi de 16 px FIXE, planchers de texte (nom 13, établissement 12, bulles 11) ;
//   - la tuile sans photo (fond bleu poudre).
// Les libellés sont passés traduits, comme le fait `TarjetaOferta` : la tuile ne traduit rien.
const [kayak, caminata, estudio, yoga] = TARJETAS_POR_TIPO.activity;
const [kayamAgrupado, bania] = TARJETAS_POR_TIPO.lodging;
const [, chiva, tuktuk] = TARJETAS_POR_TIPO.transport;
const zocalos = TARJETAS_POR_TIPO.evento[3];

const SIZES = "(min-width: 1024px) 300px, (min-width: 768px) 45vw, 90vw";

const meta = {
  title: "Affichage/TeselaOferta",
  component: TeselaOferta,
  parameters: { layout: "padded" },
  args: { oferta: kayak, locale: "es", labelDesde: "Desde", sizes: SIZES },
} satisfies Meta<typeof TeselaOferta>;

export default meta;
type Story = StoryObj<typeof meta>;

// Une tuile seule, à la largeur d'une colonne de grille (300 px). ⚠️ Pas dans le `meta` : Storybook
// CUMULE les décorateurs, et celui-ci contraindrait aussi les stories à plusieurs tuiles.
const UNA_TESELA: Story["decorators"] = [
  (Story) => (
    <div className="w-[300px] max-w-full">
      <Story />
    </div>
  ),
];

// Un montant, et l'établissement en sous-titre.
export const Defecto: Story = { decorators: UNA_TESELA };

// La carte GROUPÉE d'un établissement : « Desde » et le décompte à la place de l'établissement.
export const Agrupada: Story = {
  decorators: UNA_TESELA,
  args: { oferta: kayamAgrupado, labelConteo: "3 alojamientos" },
};

// Une chambre de fiche établissement : prix ET capacité, deux bulles.
export const ConCapacidad: Story = {
  decorators: UNA_TESELA,
  args: {
    oferta: { ...bania, capacidad: 8 } satisfies TarjetaOferta,
    labelCapacidad: "Hasta 8 personas",
  },
};

// Un prix libre, rendu tel quel (jamais formaté en COP).
export const PrecioTexto: Story = {
  decorators: UNA_TESELA,
  args: { oferta: zocalos },
};

// Ni prix ni photo : aucune bulle, le fond bleu poudre garde le carré.
export const SinFotoNiPrecio: Story = {
  decorators: UNA_TESELA,
  args: { oferta: { ...chiva, precio: null } satisfies TarjetaOferta },
};

// La même tuile à trois largeurs, côte à côte : l'intérieur suit la largeur, l'arrondi non. À 202 px,
// les planchers de texte jouent (nom 13 px, établissement 12, bulles 11).
function TroisLargeurs({ children }: { children: (largeur: string) => ReactNode }) {
  return (
    <ul className="flex flex-wrap items-start gap-4">
      {["w-[202px]", "w-[288px]", "w-[300px]"].map((largeur) => (
        <li key={largeur} className={largeur}>
          {children(largeur)}
        </li>
      ))}
    </ul>
  );
}

export const TresAnchos: Story = {
  render: (args) => (
    <TroisLargeurs>
      {() => <TeselaOferta {...args} oferta={caminata} />}
    </TroisLargeurs>
  ),
};

// Une grille de six tuiles réelles, comme une page de catégorie.
export const Grilla: Story = {
  render: (args) => (
    <ul className="grid max-w-[60rem] grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {[kayak, caminata, estudio, yoga, kayamAgrupado, tuktuk].map((oferta) => (
        <li key={oferta.clave}>
          <TeselaOferta
            {...args}
            oferta={oferta}
            labelConteo={oferta.nAlojamientos !== null ? `${oferta.nAlojamientos} alojamientos` : undefined}
          />
        </li>
      ))}
    </ul>
  ),
};
