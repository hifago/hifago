import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PageShell } from "@/components/atoms/PageShell";
import { Title } from "@/components/atoms/Title";
import { SiteFooter } from "./SiteFooter";

// Le footer de la vitrine.
//
// ⚠️ La story qui compte est `SousUnePage` : isolé, un footer ne dit rien — c'est sa relation au
// contenu qui se juge (le pied colle-t-il au contenu quand la page est courte ?). À regarder aux
// deux gabarits et dans les deux langues. Depuis le plan 41 (item C2), le pied est la surface
// MARINE de la charte : ouvrir aussi le menu de langue, dont le panneau doit rester blanc.
const meta = {
  title: "Coquille/SiteFooter",
  component: SiteFooter,
  parameters: {
    layout: "fullscreen",
    // Sans ce paramètre, la story ne rend rien : le `LanguageSwitcher` réutilisé ici passe une
    // prop `locale` au `Link` de next-intl, qui lit le chemin courant — `null` hors d'une route
    // Next. Même geste que les stories du header.
    nextjs: { appDirectory: true, navigation: { pathname: "/productos/kayak" } },
  },
} satisfies Meta<typeof SiteFooter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaut: Story = {
  args: { testId: "footer" },
};

// ⚠️ À 390 px la liste s'empile, elle ne se comprime pas — et rien n'est masqué selon la largeur.
// C'est aussi le gabarit où les cinq liens doivent rester visables au pouce.
export const Empile: Story = {
  args: { testId: "footer" },
  render: (args) => (
    <div className="max-w-[390px]">
      <SiteFooter {...args} />
    </div>
  ),
};

// La seule story honnête : le footer sous une vraie page. Contenu court exprès — c'est là qu'on
// voit si le pied remonte coller au texte au lieu de tenir le bas de l'écran.
export const SousUnePage: Story = {
  args: { testId: "footer" },
  render: (args) => (
    <div className="flex min-h-screen flex-col">
      <PageShell variant="pagina">
        <Title as="h1">Alojamientos y actividades en Guatapé</Title>
        <p className="text-sm">
          Página corta, volontairement : c&apos;est le cas où un footer mal posé remonte coller au
          contenu au lieu de rester en bas de l&apos;écran.
        </p>
      </PageShell>
      <SiteFooter {...args} />
    </div>
  ),
};

// Contenu long : le footer doit se trouver APRÈS le défilement, jamais collé en bas de la fenêtre.
export const SousUnePageLongue: Story = {
  args: { testId: "footer" },
  render: (args) => (
    <div className="flex min-h-screen flex-col">
      <PageShell variant="pagina">
        <Title as="h1">Alojamientos y actividades en Guatapé</Title>
        {Array.from({ length: 10 }, (_, i) => (
          <p key={i} className="text-sm">
            Párrafo {i + 1} — desplázate hasta abajo para ver el pie de página después del
            contenido, con su banda de color y sus enlaces.
          </p>
        ))}
      </PageShell>
      <SiteFooter {...args} />
    </div>
  ),
};
