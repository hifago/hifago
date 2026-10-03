import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import esOrderResult from "@/messages/es/OrderResultPage.json";
import { PuceEstado, TONO_POR_ESTADO_LINEA, TONO_POR_ESTADO_PEDIDO } from "./PuceEstado";

// Plan 41, S7. Les libellés sont ceux des messages réels (`OrderResultPage`, espagnol), pour juger la
// puce sur des longueurs vraies. Ce que ces stories servent à regarder :
//   - les cinq tons côte à côte : l'icône doit suffire à les distinguer, couleur mise à part ;
//   - les états de commande et de ligne, avec le ton que la table leur donne ;
//   - la puce posée sur l'or et sur le marine : son fond est opaque, elle ne change pas.
// Les contrastes de chaque ton sont mesurés sur cette story (journal du 2026-10-03).
const meta = {
  title: "Affichage/PuceEstado",
  component: PuceEstado,
  parameters: { layout: "padded" },
  args: { tono: "exito", children: "Realizada" },
} satisfies Meta<typeof PuceEstado>;

export default meta;
type Story = StoryObj<typeof meta>;

// Les libellés courts de ligne : ceux d'une puce. Ceux de commande sont des phrases d'écran
// (« ¡Pago confirmado! ») ; P7 et P8 choisiront le libellé court à poser dans la puce.
const LINEA = esOrderResult.lineStatus as Record<string, string>;

function Rangee({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export const Defecto: Story = {};

export const CincoTonos: Story = {
  render: () => (
    <Rangee>
      <PuceEstado tono="exito">Realizada</PuceEstado>
      <PuceEstado tono="alerta">Por pagar</PuceEstado>
      <PuceEstado tono="error">Expirada</PuceEstado>
      <PuceEstado tono="info">Confirmando</PuceEstado>
      <PuceEstado tono="neutro">Reservada</PuceEstado>
    </Rangee>
  ),
};

// Chaque état de ligne, au ton de la table.
export const EstadosDeLinea: Story = {
  render: () => (
    <Rangee>
      {Object.entries(TONO_POR_ESTADO_LINEA).map(([estado, tono]) => (
        <PuceEstado key={estado} tono={tono} testId={`puce-${estado}`}>
          {LINEA[estado]}
        </PuceEstado>
      ))}
    </Rangee>
  ),
};

// Chaque état de commande, au ton de la table (la clé tient lieu de libellé : voir plus haut).
export const EstadosDePedido: Story = {
  render: () => (
    <Rangee>
      {Object.entries(TONO_POR_ESTADO_PEDIDO).map(([estado, tono]) => (
        <PuceEstado key={estado} tono={tono}>
          {estado}
        </PuceEstado>
      ))}
    </Rangee>
  ),
};

// Les autres usages du plan, au ton choisi par l'appelant.
export const CuposYGratis: Story = {
  render: () => (
    <Rangee>
      <PuceEstado tono="neutro">3 cupos</PuceEstado>
      <PuceEstado tono="error">Completo</PuceEstado>
      <PuceEstado tono="exito">Gratis</PuceEstado>
    </Rangee>
  ),
};

// Sur l'or et sur le marine : le fond de la puce est mélangé au blanc, il ne prend pas la surface.
export const SobreOroYMarino: Story = {
  parameters: { layout: "fullscreen" },
  render: () => (
    <>
      {(["or", "marine"] as const).map((superficie) => (
        <div key={superficie} data-superficie={superficie} className="p-6">
          <Rangee>
            <PuceEstado tono="exito">Realizada</PuceEstado>
            <PuceEstado tono="alerta">Por pagar</PuceEstado>
            <PuceEstado tono="error">Expirada</PuceEstado>
            <PuceEstado tono="info">Confirmando</PuceEstado>
            <PuceEstado tono="neutro">Reservada</PuceEstado>
          </Rangee>
        </div>
      ))}
    </>
  ),
};
