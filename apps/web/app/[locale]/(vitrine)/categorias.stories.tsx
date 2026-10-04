import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, mocked } from "storybook/test";
import { buscarTipo } from "@/lib/catalog/buscar";
import type { TarjetaOferta } from "@/lib/catalog/tipos";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { esperar, pulsar } from "@/.storybook/support/interacciones";
import type { RutasSimuladas } from "@/.storybook/support/fetch";
import { TARJETAS_POR_TIPO } from "@/.storybook/support/fixtures/catalogo";
import ActividadesCategoriaPage from "./actividades/[categoria]/page";

// La page d'une catégorie (`/actividades/agua`…) : grille de cartes, compteur, chargement par
// tranches de 24 (« Cargar más », puis défilement infini). Les cinq types partagent cet écran
// (`ListadoTipo`) : les activités suffisent à en montrer tous les états.
const meta = { title: "Écrans/Catégorie", id: "ecrans-categorie" } satisfies Meta;
export default meta;

const LISTADO = "/api/catalogo/listado";

const categoria = (
  slug: string,
  opciones: { searchParams?: Record<string, string>; preparar?: () => void; simularFetch?: RutasSimuladas } = {}
): StoryObj => {
  const historia = historiaDePagina({
    Page: ActividadesCategoriaPage,
    grupo: "vitrine",
    ruta: `/actividades/${slug}`,
    params: { categoria: slug },
    searchParams: opciones.searchParams,
    preparar: opciones.preparar,
  });
  return opciones.simularFetch
    ? { ...historia, parameters: { ...historia.parameters, simularFetch: opciones.simularFetch } }
    : historia;
};

/** 40 cartes, pour dépasser une tranche de 24 : le catalogue réel en compte bien plus. */
const MUCHAS: TarjetaOferta[] = Array.from({ length: 40 }, (_, i) => {
  const base = TARJETAS_POR_TIPO.activity[i % TARJETAS_POR_TIPO.activity.length];
  return { ...base, clave: `${base.clave}-${i}`, testId: `${base.testId}-${i}` };
});

const conMuchas = () =>
  mocked(buscarTipo).mockImplementation(async (_tipo, _criterios, { limite, desplazamiento }) => {
    const tarjetas = MUCHAS.slice(desplazamiento, desplazamiento + limite);
    return { tarjetas, total: MUCHAS.length, hayMas: desplazamiento + tarjetas.length < MUCHAS.length };
  });

export const ConDescripcion: StoryObj = { ...categoria("agua"), name: "Catégorie avec description" };

export const SinDescripcion: StoryObj = { ...categoria("musica"), name: "Catégorie sans description" };

export const Otras: StoryObj = { ...categoria("otras"), name: "« Otras » (le rattrapage)" };

export const CargarMas: StoryObj = {
  ...categoria("agua", {
    preparar: conMuchas,
    simularFetch: { [LISTADO]: { body: { tarjetas: MUCHAS.slice(24), hayMas: false } } },
  }),
  name: "Plus de 24 offres (« Cargar más »)",
};

export const Cargando: StoryObj = {
  ...categoria("agua", { preparar: conMuchas, simularFetch: { [LISTADO]: { demora: "nunca" } } }),
  name: "Chargement de la suite",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, '[data-testid="listado-cargar-mas"]');
  },
};

export const ErrorAlCargar: StoryObj = {
  ...categoria("agua", {
    preparar: conMuchas,
    simularFetch: { [LISTADO]: { status: 500, body: { ok: false, reason: "catalogo_no_disponible" } } },
  }),
  name: "Échec du chargement (Reintentar)",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, '[data-testid="listado-cargar-mas"]');
    await expect(await esperar(canvasElement, '[data-testid="listado-cargar-mas"]')).toBeEnabled();
  },
};

export const SinResultados: StoryObj = {
  ...categoria("agua", { searchParams: { q: "submarinismo" } }),
  name: "Recherche sans résultat",
};
