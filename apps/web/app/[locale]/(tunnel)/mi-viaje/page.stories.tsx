import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, mocked } from "storybook/test";
import { getCartLines, type CartLineAvailability } from "@/lib/cart/getCartLines";
import { getTripEvents, type TripEventForDisplay } from "@/lib/cart/getTripEvents";
import { getPendingOrdersForViewer } from "@/lib/orders/getPendingOrdersForViewer";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { lineasDelCarritoSimulado } from "@/.storybook/support/datos";
import { esperar, pulsar } from "@/.storybook/support/interacciones";
import {
  simularCarrito,
  simularSesion,
  simularTabla,
  type LineaCarritoFalsa,
} from "@/.storybook/support/supabaseFalso";
import {
  CARRITO_CAMP_CON_ALOJAMIENTO,
  CARRITO_CAMP_SOLO,
  CARRITO_UN_DIA,
  CARRITO_VIAJE,
} from "@/.storybook/support/fixtures/carrito";
import { PEDIDOS_PENDIENTES } from "@/.storybook/support/fixtures/pedidos";
import { addDaysIso, todayInBogota } from "@hifago/domain";
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

// Spec 42 : des eventos non réservables notés, mêlés aux réservations par date, hors du total — dont
// un dont l'admin a changé les dates après coup.
const EVENTOS_NOTADOS: TripEventForDisplay[] = [
  {
    id: "te-1",
    productId: "prod-jam",
    productName: "Kayam's Jam — noche de música",
    productSlug: "kayams-jam",
    establishmentName: "Casa Kayam",
    date: addDaysIso(todayInBogota(), 2),
    startTime: "20:00:00",
    onOccurrence: true,
  },
  {
    id: "te-2",
    productId: "prod-mercado",
    productName: "Mercado campesino",
    productSlug: "mercado-campesino",
    establishmentName: "Plaza de Guatapé",
    date: addDaysIso(todayInBogota(), 5),
    startTime: null,
    onOccurrence: false,
  },
];

/** Les eventos notés côté serveur (la liste) ET côté navigateur (la pastille de l'en-tête). */
const conEventos = (eventos: TripEventForDisplay[]) => () => {
  mocked(getTripEvents).mockResolvedValue(eventos);
  simularTabla(
    "trip_events",
    eventos.map((e) => ({ id: e.id, product_id: e.productId, date: e.date, products: { id: e.productId } }))
  );
};

export const ViajeConEventos: StoryObj = {
  ...conCarrito(CARRITO_VIAJE, conEventos(EVENTOS_NOTADOS)),
  name: "Voyage avec des eventos notés sans réservation",
};

export const SoloEventos: StoryObj = {
  ...pagina(() => {
    simularSesion("anonima");
    conEventos(EVENTOS_NOTADOS.slice(0, 1))();
  }),
  name: "Seulement des eventos notés (rien à payer)",
};

export const ViajeDeUnDia: StoryObj = { ...conCarrito(CARRITO_UN_DIA), name: "Voyage d'un seul jour" };

/** Le panier simulé, la disponibilité d'une ligne (ou de toutes) remplacée. */
const conDisponibilidad = (availability: CartLineAvailability, soloIndice?: number) => () =>
  mocked(getCartLines).mockImplementation(async () =>
    lineasDelCarritoSimulado().map((linea, indice) =>
      soloIndice === undefined || indice === soloIndice ? { ...linea, availability } : linea
    )
  );

// Le texte est celui de la raison rendue par `cart_lines_availability` (`CheckoutPage.errors`).
export const LineaNoDisponible: StoryObj = {
  ...conCarrito(CARRITO_VIAJE, conDisponibilidad({ status: "unavailable", reason: "full" }, 1)),
  name: "Une offre n'est plus disponible",
};

export const DisponibilidadDesconocida: StoryObj = {
  ...conCarrito(CARRITO_VIAJE, conDisponibilidad({ status: "unknown" })),
  name: "Disponibilité illisible (panne)",
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
