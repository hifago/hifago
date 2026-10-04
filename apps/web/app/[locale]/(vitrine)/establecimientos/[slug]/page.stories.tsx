import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { historiaDePagina } from "@/.storybook/support/pagina";
import {
  ESTABLECIMIENTO_KAYAM_FICHA,
  ESTABLECIMIENTO_MINIMO,
  ESTABLECIMIENTO_SIN_OFERTAS,
} from "@/.storybook/support/fixtures/catalogo";
import EstablecimientoPage from "./page";

// La fiche d'un établissement : photos, horaires, contact, équipements, puis ses hébergements et
// ses autres offres. Le titre de la section d'hébergement suit `modo` (chambres / maison entière).
const meta = { title: "Écrans/Fiche établissement", id: "ecrans-fiche-etablissement" } satisfies Meta;
export default meta;

const ficha = (slug: string) =>
  historiaDePagina({ Page: EstablecimientoPage, grupo: "vitrine", ruta: `/establecimientos/${slug}`, params: { slug } });

export const Completa: StoryObj = { ...ficha(ESTABLECIMIENTO_KAYAM_FICHA.slug), name: "Complète (chambres + offres)" };

export const Minima: StoryObj = {
  ...ficha(ESTABLECIMIENTO_MINIMO.slug),
  name: "Maison entière, presque vide (ni photo, ni horaires, ni contact)",
};

export const SinOfertas: StoryObj = {
  ...ficha(ESTABLECIMIENTO_SIN_OFERTAS.slug),
  name: "Rien à vendre",
};
