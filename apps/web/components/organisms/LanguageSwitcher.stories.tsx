import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Legende } from "../playground/Legende";

// Le sélecteur de langue, isolé. ⚠️ À voir OUVERT autant que fermé : c'est ouvert qu'on constate
// s'il déborde à 390 px, et que les drapeaux se distinguent en mode sombre.
//
// Basculer la langue dans la barre d'outils change le libellé du bouton — c'est voulu : chaque
// langue s'écrit dans la sienne, jamais traduite.
const meta = {
  title: "Coquille/LanguageSwitcher",
  component: LanguageSwitcher,
  parameters: {
    layout: "padded",
  // ⚠️ Sans ce paramètre, la story ne rend RIEN : le `Link` de next-intl auquel on passe une prop
  // `locale` lit le chemin courant pour reconstruire l'URL de l'autre langue, et hors d'une route
  // Next ce chemin vaut `null` — « Cannot read properties of null (reading 'pathname') ».
  // `@storybook/nextjs-vite` fournit ce contexte par story ; c'est le seul moyen ici, car
  // `.storybook/preview.tsx` appartient à l'agent thème. Constaté le 2026-09-02 : ce lot est le
  // premier à exercer un lien localisé dans le playground depuis que la story CatalogBrowser, qui
  // le prouvait, a été supprimée.
  nextjs: { appDirectory: true, navigation: { pathname: "/productos/kayak" } },
  },
} satisfies Meta<typeof LanguageSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ferme: Story = {
  args: { testId: "lang" },
};

// ⚠️ Le panneau est TOUJOURS dans le HTML, même fermé — seulement masqué. Cette story le rend
// visible en retirant l'attribut `hidden` après le montage, ce qui montre exactement ce que
// contient le HTML servi (et donc ce que Googlebot voit).
export const Ouvert: Story = {
  args: { testId: "lang" },
  render: (args) => (
    <div className="flex min-h-64 flex-col gap-3">
      <LanguageSwitcher {...args} />
      <Legende>
        Clique pour ouvrir. Le panneau existe dans le HTML même fermé : c&apos;est ce qui permet à la
        version anglaise d&apos;être découverte par le maillage interne, y compris sur mobile.
      </Legende>
    </div>
  ),
};

// Aligné à droite comme dans le header : à 390 px, le panneau ne doit pas déborder de l'écran.
export const AlignementADroite: Story = {
  args: { testId: "lang" },
  render: (args) => (
    <div className="flex min-h-64 justify-end">
      <LanguageSwitcher {...args} />
    </div>
  ),
};

// L'apparence `banderas` — « 🇪🇸 ESP  🇬🇧 ING », la rangée du header transparent de l'accueil
// (maquette de Jérôme, 2026-10-01). Les deux langues en liens directs, sur l'or où elle vit.
// Basculer la langue dans la barre d'outils : « ING » devient « ENG », l'abréviation est un libellé
// d'interface, traduit — contrairement aux endonymes du menu.
export const Banderas: Story = {
  args: { apariencia: "banderas", testId: "lang" },
  render: (args) => (
    <div className="bg-accent p-4 text-accent-foreground">
      <LanguageSwitcher {...args} />
    </div>
  ),
};
