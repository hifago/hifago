import type { Decorator, Preview } from "@storybook/nextjs-vite";
import { withThemeByDataAttribute } from "@storybook/addon-themes";
import { useEffect } from "storybook/preview-api";
import { sb } from "storybook/test";
import { NextIntlClientProvider } from "next-intl";

import "../app/globals.css";
import { loadMessages, type Locale } from "../messages";
import { routing } from "../i18n/routing";
import { simularFetch } from "./support/fetch";
import { instalarDatosPorDefecto } from "./support/datos";
import { reiniciarSupabaseFalso } from "./support/supabaseFalso";

// ⚠️ Les polices sont chargées par `preview-head.html`, pas ici, et surtout pas par `next/font` :
// c'est une transformation du compilateur Next, qui n'existe pas sous Vite. Ce fichier-là pose
// `--font-poppins`/`--font-anton` sous LES MÊMES NOMS que `app/[locale]/layout.tsx` en production,
// parce que c'est la seule façon que le playground ne mente pas sur ce que voit un visiteur.
//
// Jusqu'au 2026-10-01, ce commentaire disait l'inverse — aucune police n'était appliquée, parce
// qu'aucune ne l'était non plus en production (`--font-geist-sans` posé d'un côté, `--font-sans` lu
// de l'autre, deux noms que rien ne reliait). La charte graphique Hifago 2026 a fermé ce défaut.
// `Playground/Palette`, section « Polices », affiche la pile réellement en vigueur et sert de
// vérification : un repli système y signalerait que le raccord a été défait.

// Modules de DONNÉES remplacés pour les stories d'écran (2026-10-01) — avec les alias de paquets de
// `main.ts`, c'est ce qui permet de rendre le vrai `page.tsx` SANS Docker, sans Supabase et sans
// `.env.local`. Mode ESPION : le vrai module est chargé (ses fonctions pures restent vraies), ses
// lectures sont redirigées vers les fixtures par `instalarDatosPorDefecto` (support/datos.ts), et
// une story en pilote la réponse par `mocked(fonction)`. Ne s'enregistre QU'ICI : Storybook refuse
// un `sb.mock` dans une story.
sb.mock(import("../lib/catalog/producto.ts"), { spy: true });
sb.mock(import("../lib/catalog/buscar.ts"), { spy: true });
sb.mock(import("../lib/catalog/establecimiento.ts"), { spy: true });
sb.mock(import("../lib/auth/viewer.ts"), { spy: true });
sb.mock(import("../lib/account/getMyProfile.ts"), { spy: true });
sb.mock(import("../lib/orders/getMyOrders.ts"), { spy: true });
sb.mock(import("../lib/cart/getCartLines.ts"), { spy: true });
sb.mock(import("../lib/orders/getPendingOrdersForViewer.ts"), { spy: true });
sb.mock(import("../lib/orders/getOrderByToken.ts"), { spy: true });

const LIBELLES_LOCALE: Record<Locale, string> = { es: "Español", en: "English" };

// Ce décorateur ne sert plus qu'au comparateur de rayon Storybook.
function attributSurHtml(attribut: string, global: string, valeurNeutre: string): Decorator {
  // Nommé, sinon react/display-name : un décorateur EST un composant pour ESLint.
  const Decorateur: Decorator = (Story, context) => {
    const valeur = String(context.globals[global] ?? valeurNeutre);
    useEffect(() => {
      const html = document.documentElement;
      if (valeur === valeurNeutre) html.removeAttribute(attribut);
      else html.setAttribute(attribut, valeur);
    }, [valeur]);
    return <Story />;
  };
  return Decorateur;
}

const preview: Preview = {
  // Les Route Handlers `/api/*` simulés par story (`parameters.simularFetch`) — mode d'emploi en
  // tête de `support/fetch.ts`. Le nettoyage renvoyé restaure le vrai `fetch` entre deux stories.
  beforeEach: ({ parameters }) => {
    // Une story n'hérite JAMAIS de la session ou du panier d'une autre — composants compris.
    reiniciarSupabaseFalso();
    instalarDatosPorDefecto();
    return simularFetch(parameters.simularFetch);
  },
  parameters: {
    // Trois gabarits repris de l'existant plutôt qu'inventés. ⚠️ Source exacte, parce que je
    // l'avais d'abord mal attribuée : 390×844 et 1280×900 viennent de
    // `.claude/skills/hifago-ui/SKILL.md` (« les mêmes deux viewports que le legacy testait ») —
    // et NON des tests e2e, dont la config Playwright utilise `devices["Desktop Chrome"]`, soit
    // 1280×720. 768 est le point de bascule `md` de Tailwind.
    viewport: {
      options: {
        mobile: { name: "Mobile 390", styles: { width: "390px", height: "844px" } },
        tablette: { name: "Tablette 768", styles: { width: "768px", height: "1024px" } },
        desktop: { name: "Desktop 1280", styles: { width: "1280px", height: "900px" } },
      },
    },
  },
  // Mobile par défaut : c'est la façon la plus simple d'imposer le « mobile d'abord » dans les
  // faits — on réserve une activité à Guatapé depuis un téléphone, et Google indexe le mobile.
  initialGlobals: {
    viewport: { value: "mobile", isRotated: false },
    locale: routing.defaultLocale,
    radius: "piste",
  },
  globalTypes: {
    // Comparateur de rayon conservé pour la charte de production.
    radius: {
      description: "Rayon des angles à l'essai sur la charte de production",
      toolbar: {
        title: "Rayon",
        icon: "component",
        items: [
          { value: "piste", title: "Rayon de production" },
          { value: "6", title: "6 px" },
          { value: "8", title: "8 px" },
          { value: "12", title: "12 px" },
          { value: "18", title: "18 px" },
        ],
        dynamicTitle: true,
      },
    },
    locale: {
      description: "Langue de l'interface",
      toolbar: {
        icon: "globe",
        // Dérivé de `routing.locales` : une troisième locale ajoutée dans i18n/routing.ts
        // apparaîtra ici toute seule. Écrite à la main, elle aurait manqué en silence — seuls les
        // libellés restent codés, ils n'ont pas d'autre source.
        items: routing.locales.map((valeur) => ({ value: valeur, title: LIBELLES_LOCALE[valeur] })),
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    // Sans ce provider, tout composant appelant useTranslations plante. Même pattern que les six
    // tests de composants du dépôt. Le sélecteur de langue n'est pas un gadget : l'espagnol est
    // 20 à 25 % plus long que l'anglais, et c'est lui qui fait déborder boutons et titres.
    (Story, context) => {
      const locale = (context.globals.locale as Locale) ?? routing.defaultLocale;
      return (
        <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
          <Story />
        </NextIntlClientProvider>
      );
    },
    // Le thème `vitrine` porte directement la charte Hifago 2026.
    withThemeByDataAttribute({
      themes: { vitrine: "vitrine", admin: "admin" },
      defaultTheme: "vitrine",
      attributeName: "data-theme",
    }),
    // Le rayon expérimental est posé après le thème ; les deux écrivent des attributs indépendants.
    attributSurHtml("data-radius", "radius", "piste"),
  ],
};

export default preview;
