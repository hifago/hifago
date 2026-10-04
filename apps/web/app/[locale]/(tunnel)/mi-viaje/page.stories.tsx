import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, mocked } from "storybook/test";
import { getCartLines } from "@/lib/cart/getCartLines";
import { getPendingOrdersForViewer } from "@/lib/orders/getPendingOrdersForViewer";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { lineasDelCarritoSimulado } from "@/.storybook/support/datos";
import { esperar, pulsar } from "@/.storybook/support/interacciones";
import { simularCarrito, type LineaCarritoFalsa } from "@/.storybook/support/supabaseFalso";
import {
  CARRITO_CAMP_CON_ALOJAMIENTO,
  CARRITO_CAMP_SOLO,
  CARRITO_UN_DIA,
  CARRITO_VIAJE,
} from "@/.storybook/support/fixtures/carrito";
import { PEDIDOS_PENDIENTES } from "@/.storybook/support/fixtures/pedidos";
import CartPage from "./page";

// `/mi-viaje`, le panier. Zone « tunnel » : en-tête complet, pas de pied de page.
const meta = { title: "Écrans/Mi viaje", id: "ecrans-mi-viaje" } satisfies Meta;
export default meta;

const pagina = (preparar?: () => void) =>
  historiaDePagina({ Page: CartPage, grupo: "tunnel", ruta: "/mi-viaje", preparar });

const conCarrito = (lineas: LineaCarritoFalsa[], extra?: () => void) =>
  pagina(() => {
    simularCarrito(lineas);
    extra?.();
  });

export const Vacio: StoryObj = { ...pagina(), name: "Panier vide" };

export const VacioConReservaPendiente: StoryObj = {
  ...pagina(() => mocked(getPendingOrdersForViewer).mockResolvedValue(PEDIDOS_PENDIENTES)),
  name: "Panier vide, réservation à payer",
};

export const Viaje: StoryObj = { ...conCarrito(CARRITO_VIAJE), name: "Voyage : plusieurs établissements" };

export const ViajeDeUnDia: StoryObj = { ...conCarrito(CARRITO_UN_DIA), name: "Voyage d'un seul jour" };

export const LineaNoDisponible: StoryObj = {
  ...conCarrito(CARRITO_VIAJE, () =>
    mocked(getCartLines).mockImplementation(async () =>
      lineasDelCarritoSimulado().map((linea, indice) => (indice === 1 ? { ...linea, unavailable: true } : linea))
    )
  ),
  name: "Une offre n'est plus disponible",
};

export const CampSinAlojamiento: StoryObj = {
  ...conCarrito(CARRITO_CAMP_SOLO),
  name: "Camp sans hébergement (paiement bloqué)",
};

export const CampConAlojamiento: StoryObj = {
  ...conCarrito(CARRITO_CAMP_CON_ALOJAMIENTO),
  name: "Camp avec hébergement compatible",
};

export const QuitandoLinea: StoryObj = {
  ...conCarrito(CARRITO_VIAJE),
  name: "Retrait d'une ligne en cours",
  play: async ({ canvasElement }) => {
    const boton = await esperar(canvasElement, '[data-testid^="remove-line-"]');
    await pulsar(canvasElement, `[data-testid="${boton.dataset.testid}"]`);
    await expect(boton).toBeDisabled();
  },
};
