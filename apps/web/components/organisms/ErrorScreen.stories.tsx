import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ErrorScreen } from "./ErrorScreen";

// L'écran d'erreur partagé par les frontières de zone et par `global-error.tsx`. À regarder aux deux
// gabarits (390 / 1280) : c'est le seul écran que le visiteur voit quand tout le reste a échoué, il
// doit tenir sans la coquille. Le message de l'erreur passé ici ne doit JAMAIS apparaître à l'écran.
const meta = {
  title: "Structure/ErrorScreen",
  component: ErrorScreen,
  parameters: {
    layout: "fullscreen",
    // Même raison que SiteHeader.stories.tsx : le `Link` localisé lit le chemin courant, `null`
    // hors d'une route Next.
    nextjs: { appDirectory: true, navigation: { pathname: "/productos/kayak" } },
  },
  args: {
    error: Object.assign(new Error('relation "public.products" does not exist'), { digest: "abc123" }),
    retry: () => {},
    zone: "vitrine",
    testId: "error-vitrine",
  },
} satisfies Meta<typeof ErrorScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Frontière de zone : rendue dans la coquille, lien d'accueil localisé. */
export const Defaut: Story = {};

/** `global-error.tsx` : hors du routage localisé, lien d'accueil complet suivi d'un rechargement. */
export const HorsRoutage: Story = {
  args: { inicioHref: "/es", testId: "global-error" },
};
