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

// L'accueil : sélecteur de types, bloc de recherche, un carrousel par type. Les états de la barre
// de recherche (raccourcis, suggestions, calendrier, personnes) s'obtiennent en cliquant.
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

export const MenuAbierto: StoryObj = {
  ...pagina(),
  name: "Menu ouvert",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, "header button[aria-expanded]");
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
