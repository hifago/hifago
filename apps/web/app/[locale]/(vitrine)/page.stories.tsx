import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { addDaysIso, todayInBogota } from "@hifago/domain";
import { toast } from "@hifago/ui";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { esperar, escribir, pulsar } from "@/.storybook/support/interacciones";
import { simularCarrito, simularSesion } from "@/.storybook/support/supabaseFalso";
import type { RutasSimuladas } from "@/.storybook/support/fetch";
import { CARRITO_UN_DIA } from "@/.storybook/support/fixtures/carrito";
import { loadMessages, type Locale } from "@/messages";
import HomePage from "./page";

// L'accueil de la maquette de Jérôme (2026-10-01) : header transparent, héros (la rue aux zócalos,
// le grand logo, la navigation par type, la recherche), puis une section par type — titre, motif,
// conteneur marine de trois photos, « GO → ». Les états de la barre de recherche (raccourcis,
// suggestions, calendrier, personnes) s'obtiennent en cliquant.
//
// ⚠️ Plus d'état « Menu ouvert » : le header transparent de l'accueil n'a PAS de bouton de menu —
// les langues, Mi viaje et Mi cuenta y sont visibles à toutes les largeurs. Cet état se regarde
// désormais sur les autres écrans (`Coquille/SiteHeader`).
const meta = { title: "Écrans/Accueil", id: "ecrans-accueil" } satisfies Meta;
export default meta;

const dia = (desplazamiento: number) => addDaysIso(todayInBogota(), desplazamiento);

const pagina = (
  opciones: { searchParams?: Record<string, string>; preparar?: () => void; simularFetch?: RutasSimuladas } = {}
): StoryObj => {
  const historia = historiaDePagina({
    Page: HomePage,
    grupo: "vitrine",
    ruta: "/",
    searchParams: opciones.searchParams,
    preparar: opciones.preparar,
  });
  return opciones.simularFetch
    ? { ...historia, parameters: { ...historia.parameters, simularFetch: opciones.simularFetch } }
    : historia;
};

const SUGERENCIAS = "/api/catalogo/sugerencias";

export const Defecto: StoryObj = { ...pagina(), name: "Accueil" };

// Variante d'exploration (Jérôme, 2026-10-01) : fond de page et bandes en marine (#132f61, la
// marine de la charte), conteneurs de cartes et bouton secondaire en or (#ddae09). La permutation
// se fait sur les jetons `--accent` / `--default` au niveau de `<html>` (là où `--accent-hover`,
// `--default-hover`… sont dérivés), via une `<style>` montée avec la story et retirée avec elle :
// `globals.css` n'est pas touché. Même valeur dans les deux modes : c'est une maquette de couleur,
// pas un thème. Les couleurs passent par les jetons bruts de la charte (`--charte-*`, `globals.css`)
// et le mot-clé `white` — jamais un hex : `scripts/check-tokens.sh` le refuserait, stories comprises.
//
// Sur ce fond sombre, le texte du fond (`--accent-foreground` : header, langue, menu par type)
// passe en blanc, et les TITRES DES SECTIONS en or — le couple marine / or du logo lui-même, l'or sur
// fond SOMBRE n'étant pas l'interdit « or en texte sur fond clair » de la charte. La recherche, les
// points des titres et les flèches suivent `--default`, donc l'or.
//
// ⚠️ Adaptée le 2026-10-01 à la maquette de l'accueil, qui a remplacé les bandes défilantes et le
// petit logo du header : les conteneurs de photos portent `--accent-foreground` (le marine sur la
// vraie page), donc BLANC ici ; et le grand logo du héros, marine, est passé en blanc par un filtre
// — la charte n'a pas de déclinaison horizontale claire SANS or, et l'or s'y perdrait moins que le
// marine sur ce fond. Une maquette de couleur, pas un thème : rien de ceci n'atteint la production.
const PERMUTACION_ORO_AZUL = `
  :root[data-theme="vitrine"] {
    --accent: var(--charte-marine);
    --accent-foreground: white;
    --default: var(--charte-or);
    --default-foreground: var(--charte-marine);
  }
  /* Les boutons TRANSPARENTS posés sur le fond (icônes du header, puces Fechas / Personas) teintent
     leur texte au marine de --default-foreground : invisibles sur marine, constaté au rendu. */
  :root[data-theme="vitrine"] body:has(main[data-fondo="acento"]) :is(header .button--ghost, header .button--outline, [data-testid^="buscador-"][data-testid$="-trigger"]) {
    --btn-on-tint: white;
    --btn-line: color-mix(in oklab, white 60%, transparent);
  }
  :root[data-theme="vitrine"] main[data-fondo="acento"] section h2 {
    color: var(--charte-or);
  }
  :root[data-theme="vitrine"] main[data-fondo="acento"] h1 img {
    filter: brightness(0) invert(1);
  }
`;

export const DefectoColoresInvertidos: StoryObj = {
  ...Defecto,
  name: "Accueil — fond marine, cartes or",
  decorators: [
    (Historia) => (
      <>
        <style>{PERMUTACION_ORO_AZUL}</style>
        <Historia />
      </>
    ),
  ],
};

export const ConectadoConCarrito: StoryObj = {
  ...pagina({
    preparar: () => {
      simularSesion("cuenta");
      simularCarrito(CARRITO_UN_DIA);
    },
  }),
  name: "Connecté, panier non vide",
};

export const ConCriterios: StoryObj = {
  ...pagina({ searchParams: { desde: dia(12), hasta: dia(15), personas: "2" } }),
  name: "Avec dates et personnes",
};

export const SoloUnTipo: StoryObj = { ...pagina({ searchParams: { tipo: "lodging" } }), name: "Un seul type (?tipo=)" };

export const SinResultados: StoryObj = {
  ...pagina({ searchParams: { q: "submarinismo" } }),
  name: "Recherche sans résultat",
};

export const DesdeElCarrito: StoryObj = {
  ...pagina({ searchParams: { desdeCarrito: "1" }, preparar: () => simularCarrito(CARRITO_UN_DIA) }),
  name: "Retour après un ajout (sections réordonnées)",
  // Le vrai parcours affiche ce toast juste avant d'arriver ici (`useAddToCart`).
  play: async ({ globals }) => {
    toast.success(loadMessages((globals.locale as Locale) ?? "es").ProductPage.addedToCart);
  },
};

export const AtajosDeTipo: StoryObj = {
  ...pagina(),
  name: "Recherche : raccourcis par type",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, '[data-testid="buscador-bar-input"]');
  },
};

export const Sugerencias: StoryObj = {
  ...pagina({
    simularFetch: {
      [SUGERENCIAS]: {
        body: {
          sugerencias: [
            { id: "prod-kayak", nombre: "Kayak en el embalse", tipo: "activity", esEstablecimiento: false, establecimiento: "Casa del Embalse", href: "/productos/kayak-en-el-embalse" },
            { id: "est-kayam", nombre: "Casa Kayam", tipo: "lodging", esEstablecimiento: true, establecimiento: null, href: "/establecimientos/casa-kayam" },
            { id: "prod-jam", nombre: "Kayam's Jam — noche de música", tipo: "evento", esEstablecimiento: false, establecimiento: null, href: "/productos/kayams-jam" },
          ],
        },
      },
    },
  }),
  name: "Recherche : suggestions",
  play: async ({ canvasElement }) => {
    await escribir(canvasElement, '[data-testid="buscador-bar-input"]', "kay");
  },
};

export const SinSugerencias: StoryObj = {
  ...pagina({ simularFetch: { [SUGERENCIAS]: { body: { sugerencias: [] } } } }),
  name: "Recherche : aucune suggestion",
  play: async ({ canvasElement }) => {
    await escribir(canvasElement, '[data-testid="buscador-bar-input"]', "zzz");
    await expect(await esperar(document.body, '[data-testid="buscador-bar-empty"]')).toBeVisible();
  },
};

export const CalendarioAbierto: StoryObj = {
  ...pagina(),
  name: "Recherche : calendrier ouvert",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, '[data-testid="buscador-dates-trigger"]');
  },
};

export const PersonasAbierto: StoryObj = {
  ...pagina(),
  name: "Recherche : nombre de personnes",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, '[data-testid="buscador-people-trigger"]');
  },
};
