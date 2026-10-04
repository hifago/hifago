import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CartProvider } from "@/lib/cart/CartContext";
import { GoogleButton, OAuthSection } from "./GoogleButton";

// ⚠️ À SAVOIR AVANT DE CLIQUER : le playground tourne sur un FAUX client Supabase
// (`.storybook/support/supabaseFalso.ts`, depuis le 2026-10-01). Un appui « réussit » sans quitter
// la page — il n'y a pas de Google derrière —, et l'état d'échec ne s'affiche pas ici. Cet état est
// tenu par `GoogleButton.test.tsx` ; ces stories servent le reste : la place du logo, la cible
// tactile, le séparateur, et le rendu du bloc dans les deux langues et les deux thèmes.
//
// `CartProvider` : le bouton lit le panier (`useCart`) pour le déposer avant la redirection OAuth.
// Sans lui, les trois stories levaient « useCart doit être utilisé sous CartProvider » — relevé le
// 2026-10-01 par le contrôle de toutes les stories, défaut antérieur au lot des écrans.
const meta = {
  title: "Actions/GoogleButton",
  component: GoogleButton,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <CartProvider>
        <Story />
      </CartProvider>
    ),
  ],
} satisfies Meta<typeof GoogleButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaut: Story = {
  // La largeur des deux écrans qui le portent (`max-w-sm`) : hors de ce contenant, un bouton
  // `width="full"` s'étire à la fenêtre et ne montre pas ce qu'on regarde.
  decorators: [
    (Story) => (
      <div className="w-full max-w-sm">
        <Story />
      </div>
    ),
  ],
};

export const AvecUnNextATransporter: Story = {
  args: { next: "/mi-viaje" },
  decorators: Defaut.decorators,
};

/** Le bloc réellement monté sur `/entrar` et `/registro` — bouton, séparateur, puis le formulaire. */
export const BlocAuDessusDuFormulaire: StoryObj = {
  render: () => (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <OAuthSection next="/mi-viaje" />
      {/* Silhouette du formulaire email/mot de passe, pas les vrais champs : ce qu'on vient
          regarder ici, c'est l'équilibre entre le bouton et ce qui le suit. */}
      <div className="flex flex-col gap-4" aria-hidden="true">
        <div className="h-12 rounded-[var(--radius)] border border-border" />
        <div className="h-12 rounded-[var(--radius)] border border-border" />
        <div className="h-12 rounded-[var(--radius)] bg-surface-secondary" />
      </div>
    </div>
  ),
};
