import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PageShell } from "./PageShell";

const Bloc = ({ children }: { children: React.ReactNode }) => (
  <section className="rounded-[16px] border border-border bg-surface p-6 text-surface-foreground">
    {children}
  </section>
);

const meta = {
  title: "Structure/PageShell",
  component: PageShell,
  parameters: { layout: "fullscreen" },
  args: {
    variant: "pagina",
    children: <Bloc>Contenu aligné sur l&apos;unique colonne des pages intérieures.</Bloc>,
  },
} satisfies Meta<typeof PageShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pagina: Story = {};

export const PaginaSurOr: Story = { args: { fondo: "acento" } };

export const FondPerdu: Story = {
  render: (args) => (
    <PageShell {...args}>
      <Bloc>Enfant ordinaire dans la colonne.</Bloc>
      <section data-bleed="" className="bg-default p-6 text-default-foreground">
        Enfant <code>data-bleed</code> bord à bord.
      </section>
      <Bloc>Retour dans la colonne.</Bloc>
    </PageShell>
  ),
};

export const Portada: Story = {
  args: {
    variant: "portada",
    children: <Bloc>L&apos;accueil dessine lui-même ses colonnes.</Bloc>,
  },
};
