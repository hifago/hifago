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

// ⚠️ Les polices Geist ne sont VOLONTAIREMENT pas appliquées ici, et ce n'est pas un oubli :
// elles ne le sont pas non plus en production. `app/[locale]/layout.tsx` définit
// `--font-geist-sans`/`--font-geist-mono`, mais HeroUI et Tailwind v4 consomment `--font-sans` et
// `--font-mono` — des noms différents, que rien ne relie. La vitrine tourne donc sur la pile de
// polices système. Les appliquer ici ferait mentir le playground sur ce que voit un visiteur.
// Constaté le 2026-09-01 en montant ce playground ; signalé, non corrigé (hors périmètre), et
// toujours pas corrigé par le lot des pistes de couleur du même jour : le correctif tient en deux
// lignes dans `app/[locale]/layout.tsx`, mais il change la typographie de tout le site d'un coup,
// donc il est proposé à Jérôme plutôt qu'appliqué en passant. Voir `Playground/Palette`, section
// « Polices », qui affiche la pile réellement en vigueur à côté de celle qui était prévue.

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

// `withThemeByDataAttribute` (addon-themes) ne sait poser qu'UN attribut : sa clé de global est
// figée à "theme" dans son code (node_modules/@storybook/addon-themes/dist/index.js:28), donc en
// instancier deux les ferait se disputer le même global. D'où ce décorateur, écrit sur le même
// idiome que le sien — `useEffect` de storybook/preview-api, cible `document.documentElement`.
//
// ⚠️ La valeur neutre RETIRE l'attribut au lieu de le poser : `data-piste="aucune"` matcherait le
// sélecteur d'attribut `[data-piste]` du CSS, et forcerait un `color-scheme` sur une vitrine sans
// palette. C'est l'absence de l'attribut qui signifie « production actuelle », pas une valeur.
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
    // ⚠️ La clé est `palette` et non `piste`, et ce n'est pas cosmétique : Storybook MÉMORISE les
    // globals par navigateur, et `initialGlobals` n'écrase JAMAIS une valeur déjà mémorisée. Un
    // onglet ouvert avant ce lot gardait donc `piste=aucune` — donc aucune palette — donc un
    // sélecteur « Mode » parfaitement inerte, symptôme signalé par Jérôme et reproduit à
    // l'identique en repartant d'une session mémorisée. Renommer la clé rend l'ancienne valeur
    // caduque et fait s'appliquer le nouveau défaut pour tout le monde, sans vidage manuel.
    //
    // ⚠️ Le défaut est la palette de MARQUE, pas « aucune », et c'est un revirement : mon
    // premier choix était « aucune », pour que le playground ne mente pas sur la production. Sauf
    // que sans piste il n'existe aucune palette sombre — basculer « Mode » sur sombre ne faisait
    // alors STRICTEMENT RIEN, et la fonctionnalité passait pour cassée au premier contact (relevé
    // par Jérôme, 2026-09-01). Un défaut qui rend inerte le sélecteur d'à côté est un mauvais
    // défaut, même s'il est le plus honnête sur le papier. « Aucune piste » reste à un clic, et
    // son libellé dit maintenant pourquoi le mode n'y fait rien.
    palette: "hifago",
    mode: "clair",
    radius: "piste",
  },
  globalTypes: {
    // ⚠️ « Aucune piste » n'est PAS le défaut (voir `initialGlobals` plus bas), mais elle reste la
    // seule valeur qui montre la production telle qu'elle est : les défauts HeroUI, sans mode
    // sombre. C'est la valeur à choisir pour comparer une piste à l'existant. La story
    // `Playground/Palette` affiche les quatre pistes côte à côte par elle-même, sans dépendre de ce
    // sélecteur.
    palette: {
      description: "Piste visuelle de la vitrine (comparaison — aucune n'est encore adoptée)",
      // `title` explicite : sans lui, `dynamicTitle` affiche le libellé de l'item sélectionné, et
      // « Aucune piste (défauts HeroUI = production) » déborde de la barre d'outils.
      // Relevé par la contre-vérification de l'inventaire Storybook, pas constaté à l'œil.
      toolbar: {
        title: "Piste",
        // ⚠️ Pas `paintbrush` : c'est déjà l'icône du sélecteur de thème de @storybook/addon-themes
        // (dist/manager.js:56), les deux boutons seraient indiscernables dans la barre.
        icon: "photo",
        items: [
          { value: "aucune", title: "Aucune piste — production actuelle, pas de mode sombre" },
          { value: "hifago", title: "Hifago — la marque du portail legacy" },
          { value: "embalse", title: "Embalse — l'eau du barrage" },
          { value: "zocalo", title: "Zócalo — les frises peintes" },
          { value: "cal", title: "Cal — encre et papier" },
          { value: "chiva", title: "Chiva — flashy, trait noir, fond blanc" },
        ],
        dynamicTitle: true,
      },
    },
    // « Système » retire l'attribut et laisse `color-scheme: light dark` suivre la préférence du
    // système d'exploitation — c'est le comportement qu'aura la production une fois une piste
    // adoptée. Les deux autres valeurs le forcent, pour pouvoir comparer sans toucher aux réglages
    // de sa machine.
    mode: {
      description: "Clair, sombre, ou la préférence du système — sans effet si « Piste » vaut « Aucune »",
      toolbar: {
        title: "Mode",
        icon: "contrast",
        items: [
          { value: "clair", title: "Clair" },
          { value: "sombre", title: "Sombre" },
          { value: "systeme", title: "Préférence système" },
        ],
        dynamicTitle: true,
      },
    },
    // ⚠️ « Piste » = le rayon que la piste choisit elle-même ; les quatre autres valeurs le
    // forcent, pour comparer sans éditer le CSS. Demandé par Jérôme le 2026-09-02 (« radius
    // 6 8 12 18px à tester »). L'écart n'est PAS proportionnel d'un composant à l'autre : le
    // bouton reprend le jeton au facteur 1, la carte le triple et sature à 32 px — donc 12 et 18
    // rendent le même angle de carte. Détaillé au-dessus des blocs `data-radius` de globals.css.
    radius: {
      description: "Rayon des angles à l'essai — sans effet si « Piste » vaut « Aucune »",
      toolbar: {
        title: "Rayon",
        icon: "component",
        items: [
          { value: "piste", title: "Celui de la piste" },
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
    // Le thème est posé sur <html> en production par le layout ; ici c'est cet addon qui le pose.
    // ⚠️ Le thème `vitrine` ne définit toujours AUCUN jeton PAR DÉFAUT (le thème `admin` en définit
    // ~37) : basculer entre les deux montre exactement ce que la vitrine n'a pas. Ce qui a changé
    // le 2026-09-01, c'est qu'il existe désormais trois pistes candidates, chacune enfermée
    // derrière un `data-piste` que le sélecteur ci-dessus pose — et qu'aucune n'est adoptée. Tant
    // que le sélecteur est sur « Aucune piste », ce playground montre la production telle quelle.
    withThemeByDataAttribute({
      themes: { vitrine: "vitrine", admin: "admin" },
      defaultTheme: "vitrine",
      attributeName: "data-theme",
    }),
    // Posés APRÈS le thème dans le tableau (donc plus externes au rendu), mais l'ordre n'a en
    // pratique aucune importance : les trois écrivent des attributs indépendants sur le même
    // élément, aucun ne lit celui d'un autre.
    attributSurHtml("data-piste", "palette", "aucune"),
    attributSurHtml("data-mode", "mode", "systeme"),
    attributSurHtml("data-radius", "radius", "piste"),
  ],
};

export default preview;
