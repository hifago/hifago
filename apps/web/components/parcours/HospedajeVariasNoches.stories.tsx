import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";
import { addDaysIso, todayInBogota } from "@hifago/domain";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { pulsar } from "@/.storybook/support/interacciones";
import { carritoSimulado, simularCarrito, simularSesion } from "@/.storybook/support/supabaseFalso";
import { ALOJAMIENTO_GLAMPING } from "@/.storybook/support/fixtures/productos";
import * as Accueil from "@/app/[locale]/(vitrine)/page.stories";
import * as Indices from "@/app/[locale]/(vitrine)/indices.stories";
import * as Establecimiento from "@/app/[locale]/(vitrine)/establecimientos/[slug]/page.stories";
import * as Ficha from "@/app/[locale]/(vitrine)/productos/[slug]/page.stories";
import * as Resultado from "@/app/[locale]/(vitrine)/reserva/[token]/page.stories";
import CartPage from "@/app/[locale]/(tunnel)/mi-viaje/page";
import CheckoutPage from "@/app/[locale]/(tunnel)/pago/page";
import { conduceA, etapa, navegoA } from "./etapas";

// Parcours 2 — un compte connecté réserve deux nuits de glamping en passant par l'établissement
// (e2e : reserve-lodging-range.spec.ts, establishment-page.spec.ts).
const meta = { title: "Parcours/Hébergement sur plusieurs nuits", id: "parcours-hebergement-nuits" } satisfies Meta;
export default meta;

const dia = (desplazamiento: number) => addDaysIso(todayInBogota(), desplazamiento);

// Les deux nuits choisies à l'étape 4 (du jour 1 au jour 3), retrouvées aux étapes 5 et 6.
const NOCHES = [{ productId: ALOJAMIENTO_GLAMPING.id, date: dia(1), endDate: dia(3), qty: 1 }];

const conCuentaYNoches = () => {
  simularSesion("cuenta");
  simularCarrito(NOCHES);
};

export const Accueil1: StoryObj = etapa(1, "Accueil", Accueil.Defecto, async ({ canvasElement }) => {
  await conduceA(canvasElement, "/alojamientos");
});

export const Alojamientos2: StoryObj = etapa(2, "Hébergements", Indices.Alojamientos, async ({ canvasElement }) => {
  await conduceA(canvasElement, "/establecimientos/casa-kayam");
});

export const Establecimiento3: StoryObj = etapa(3, "Casa Kayam", Establecimiento.Completa, async ({ canvasElement }) => {
  await conduceA(canvasElement, `/productos/${ALOJAMIENTO_GLAMPING.slug}`);
});

export const Ficha4: StoryObj = etapa(
  4,
  "Glamping : deux nuits, ajout",
  Ficha.AlojamientoRangoElegido,
  async ({ canvasElement }) => {
    await pulsar(canvasElement, '[data-testid="add-to-cart-button"]');
    await waitFor(() => expect(carritoSimulado()).toHaveLength(1));
  }
);

export const MiViaje5: StoryObj = etapa(
  5,
  "Mi viaje",
  historiaDePagina({ Page: CartPage, grupo: "tunnel", ruta: "/mi-viaje", preparar: conCuentaYNoches }),
  async ({ canvasElement }) => {
    await conduceA(canvasElement, "/pago");
  }
);

export const Pago6: StoryObj = etapa(
  6,
  "Pago : coordonnées pré-remplies",
  historiaDePagina({ Page: CheckoutPage, grupo: "tunnel", ruta: "/pago", preparar: conCuentaYNoches }),
  async ({ canvasElement }) => {
    await pulsar(canvasElement, '[data-testid="submit-order-button"]');
    await navegoA("/reserva/token-o-nueva");
  }
);

export const Resultado7: StoryObj = etapa(7, "Résultat : payée", Resultado.Pagado);
