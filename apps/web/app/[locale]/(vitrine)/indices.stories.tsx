import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { mocked } from "storybook/test";
import { addDaysIso, todayInBogota } from "@hifago/domain";
import { buscarCategorias } from "@/lib/catalog/buscar";
import { historiaDePagina } from "@/.storybook/support/pagina";
import ActividadesPage from "./actividades/page";
import AlojamientosPage from "./alojamientos/page";
import TransportesPage from "./transportes/page";
import CampsPage from "./camps/page";
import EventosPage from "./eventos/page";

// L'index d'un type (`/actividades`, `/alojamientos`…) : une section par catégorie, avec son
// aperçu. Les cinq routes rendent le même écran (`IndiceCategoriasConOfertas`) ; on les montre
// toutes parce que leur contenu, donc leur rendu, diffère.
const meta = { title: "Écrans/Index par type", id: "ecrans-index-par-type" } satisfies Meta;
export default meta;

const dia = (desplazamiento: number) => addDaysIso(todayInBogota(), desplazamiento);

type Pagina = Parameters<typeof historiaDePagina>[0]["Page"];

const indice = (
  Page: Pagina,
  ruta: string,
  opciones: { searchParams?: Record<string, string>; preparar?: () => void } = {}
) => historiaDePagina({ Page, grupo: "vitrine", ruta, ...opciones });

// ⚠️ DÉFAUT RÉEL montré tel quel (relevé le 2026-10-01) : la catégorie de rattrapage « otras »
// arrive ici avec un nom VIDE (`buscar.ts` le laisse à "", seule la page de catégorie le traduit),
// d'où un `<h2>` vide sous la dernière section des activités.
export const Actividades: StoryObj = {
  ...indice(ActividadesPage, "/actividades"),
  name: "Activités (dont « otras » au titre vide, défaut connu)",
};

export const Alojamientos: StoryObj = { ...indice(AlojamientosPage, "/alojamientos"), name: "Hébergements" };

export const Transportes: StoryObj = { ...indice(TransportesPage, "/transportes"), name: "Transports" };

export const Camps: StoryObj = { ...indice(CampsPage, "/camps") };

export const Eventos: StoryObj = { ...indice(EventosPage, "/eventos"), name: "Événements" };

export const SinResultados: StoryObj = {
  ...indice(ActividadesPage, "/actividades", { searchParams: { q: "submarinismo" } }),
  name: "Recherche sans résultat",
};

export const SeccionVacia: StoryObj = {
  ...indice(CampsPage, "/camps", { preparar: () => mocked(buscarCategorias).mockResolvedValue([]) }),
  name: "Section encore vide",
};

export const AlojamientoParaCamp: StoryObj = {
  ...indice(AlojamientosPage, "/alojamientos", {
    searchParams: { alojamientoParaCamp: "1", desde: dia(7), hasta: dia(11) },
  }),
  name: "Hébergements pour un camp (bandeau, N nuits)",
};

export const AlojamientoParaEvento: StoryObj = {
  ...indice(AlojamientosPage, "/alojamientos", {
    searchParams: { alojamientoParaEvento: "1", desde: dia(9), hasta: dia(10) },
  }),
  name: "Hébergements pour un événement (bandeau)",
};
