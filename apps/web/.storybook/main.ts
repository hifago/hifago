import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/nextjs-vite";

const support = (chemin: string) => fileURLToPath(new URL(`./support/${chemin}`, import.meta.url));

// Playground des composants de la vitrine. Décision de Jérôme du 2026-09-01 : Storybook plutôt
// qu'une route interne — elle clôt le point laissé ouvert par archive/apps/test-ux/README.md
// (« Storybook ou preview interne, décision séparée »).
//
// ⚠️ Les stories sont découvertes par GLOB, sans registre central. C'est délibéré : plusieurs
// agents créent des composants en parallèle dans le même répertoire de travail, et un registre
// serait le fichier que tous éditeraient en même temps. Ajouter un composant au playground ne
// demande donc de modifier AUCUN fichier partagé.

const config: StorybookConfig = {
  stories: [
    "../components/**/*.stories.@(ts|tsx)",
    // Les composants d'écran vivent encore dans app/[locale]/… ; leurs tests y sont déjà
    // colocalisés, leurs stories le sont donc aussi.
    "../app/**/*.stories.@(ts|tsx)",
  ],
  addons: ["@storybook/addon-themes", "@storybook/addon-a11y"],
  framework: { name: "@storybook/nextjs-vite", options: {} },
  // Stories d'ÉCRAN (2026-10-01) : une story rend le VRAI `page.tsx`, qui est un Server Component
  // asynchrone. Ce drapeau enveloppe chaque story dans un Suspense — sans effet sur les stories de
  // composants, qui ne suspendent jamais. Les données passent par les mocks de `preview.tsx`.
  features: { experimentalRSC: true },
  // Les vraies photos du catalogue de démonstration (`hifago/mockData/`, 82 fichiers) : on ne juge
  // pas un design sur des rectangles gris. Servies sous `/mock/…`, référencées par les fixtures de
  // `.storybook/support/fixtures/`. (La Sugo Pro Display d'essai n'est plus servie depuis que Jérôme
  // a confirmé Anton, le 2026-10-02 : `preview-head.html`.)
  staticDirs: [{ from: "../../../mockData", to: "/mock" }],
  // Les PAQUETS que les stories d'écran remplacent (2026-10-01) — par alias, pas par `sb.mock` :
  // `sb.mock("next-intl/server")` visait un chemin que le navigateur ne résout pas (il prend la
  // variante `react-client` du paquet), et le vrai module passait — « setRequestLocale is not
  // supported in Client Components », constaté. L'alias, lui, est appliqué avant toute résolution.
  // Les modules LOCAUX de `lib/`, eux, restent sous `sb.mock` (preview.tsx) : les stories doivent
  // pouvoir en piloter les réponses avec `mocked()`.
  viteFinal: async (viteConfig) => {
    const remplacements = [
      { find: /^next-intl\/server$/, replacement: support("mocks/next-intl-server.ts") },
      { find: /^@hifago\/supabase\/client$/, replacement: support("mocks/supabase-client.ts") },
      { find: /^@hifago\/supabase\/server$/, replacement: support("mocks/supabase-server.ts") },
    ];
    const existants = viteConfig.resolve?.alias ?? [];
    const liste = Array.isArray(existants)
      ? existants
      : Object.entries(existants).map(([find, replacement]) => ({ find, replacement }));
    return { ...viteConfig, resolve: { ...viteConfig.resolve, alias: [...remplacements, ...liste] } };
  },
};

export default config;
