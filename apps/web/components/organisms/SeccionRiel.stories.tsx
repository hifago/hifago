import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { COLUMNA_PORTADA } from "@/components/atoms/PageShell";
import { TARJETAS_POR_TIPO } from "@/.storybook/support/fixtures/catalogo";
import { SeccionRiel } from "./SeccionRiel";

// Plan 41, S3. Le rail de l'accueil, rendu hors de l'accueil : c'est ce que l'index par type (P1)
// et la fiche établissement (P4) vont poser. Les offres sont celles des écrans, avec leurs photos.
// Ce que ces stories servent à regarder :
//   - l'accueil (`portada` sur l'or) : la référence, qui doit rester celle d'`Écrans/Accueil` ;
//   - une rubrique (`seccion`) sur l'or et sur le clair : le conteneur et le motif restent ; le
//     point passe à l'or et la flèche du « GO » au bleu moyen sur le clair (F3) ;
//   - deux tuiles seulement : le conteneur épouse ses photos ;
//   - sans « GO » ni motif : la fiche établissement n'a pas de page « voir tout ».
// Chaque story pose la colonne de l'accueil (`COLUMNA_PORTADA`) : tout le rail est en `cqw` de
// cette colonne.
const actividades = TARJETAS_POR_TIPO.activity;

const meta = {
  title: "Structure/SeccionRiel",
  component: SeccionRiel,
  parameters: { layout: "fullscreen" },
  args: {
    titulo: "Actividades",
    tamanoTitulo: "seccion",
    hrefVerMas: "/actividades",
    labelVerMas: "Más actividades",
    tarjetas: actividades,
    locale: "es",
    labelDesde: "Desde",
    testId: "seccion-activity",
  },
} satisfies Meta<typeof SeccionRiel>;

export default meta;
type Story = StoryObj<typeof meta>;

function Surface({ superficie, children }: { superficie: "or" | "clara"; children: ReactNode }) {
  return (
    <div data-superficie={superficie} className="py-10">
      <div className={COLUMNA_PORTADA}>{children}</div>
    </div>
  );
}

const SOBRE_ORO: Story["decorators"] = [
  (Story) => (
    <Surface superficie="or">
      <Story />
    </Surface>
  ),
];
const SOBRE_CLARO: Story["decorators"] = [
  (Story) => (
    <Surface superficie="clara">
      <Story />
    </Surface>
  ),
];

// L'accueil, réglages compris (titre `portada`, tailles de texte de l'accueil).
export const Portada: Story = {
  args: { tamanoTitulo: "portada", minimosTexto: false },
  decorators: SOBRE_ORO,
};

// Une rubrique d'index par type (P1) : titre de section, planchers de texte des tuiles.
export const SeccionSobreOro: Story = {
  args: { titulo: "Agua" },
  decorators: SOBRE_ORO,
};

// Une rubrique sur une page claire : point or, flèche du « GO » en bleu moyen ; le rail reste marine.
export const SeccionSobreClaro: Story = {
  args: { titulo: "Actividades y servicios" },
  decorators: SOBRE_CLARO,
};

// Deux tuiles : le conteneur marine épouse ses photos au lieu de laisser un tiers vide.
export const DosTeselas: Story = {
  args: { titulo: "Agua", tarjetas: actividades.slice(0, 2) },
  decorators: SOBRE_ORO,
};

// La fiche établissement : pas de page « voir tout », donc pas de « GO » ; sans motif.
export const SinGoNiMotivo: Story = {
  args: {
    titulo: "Habitaciones",
    tarjetas: TARJETAS_POR_TIPO.lodging,
    hrefVerMas: undefined,
    labelVerMas: undefined,
    motivo: false,
  },
  decorators: SOBRE_CLARO,
};
