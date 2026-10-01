import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, mocked } from "storybook/test";
import { getMyOrders } from "@/lib/orders/getMyOrders";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { esperar, pulsar } from "@/.storybook/support/interacciones";
import { simularPendiente, simularRpc, simularSesion } from "@/.storybook/support/supabaseFalso";
import { MIS_RESERVAS, PEDIDO_SIN_PAGAR } from "@/.storybook/support/fixtures/cuenta";
import AccountOrdersPage from "./page";

// `/cuenta/reservas`. La story « toutes les variantes » montre les huit états de commande et
// chaque forme de ligne d'un coup ; les autres isolent un cas. Une ligne `reserved` porte
// « Anular » ; la confirmation prévient quand c'est la dernière ligne vivante de la commande.
const meta = { title: "Écrans/Mes réservations", id: "ecrans-mes-reservations" } satisfies Meta;
export default meta;

const pagina = (preparar?: () => void) =>
  historiaDePagina({
    Page: AccountOrdersPage,
    grupo: "cuenta",
    ruta: "/cuenta/reservas",
    preparar: () => {
      simularSesion("cuenta");
      preparar?.();
    },
  });

// La ligne d'une commande à UNE seule ligne vivante : sa confirmation porte l'avertissement.
const LINEA_UNICA = PEDIDO_SIN_PAGAR.lines[0].id;
const LINEA_DE_VARIAS = "l-421";

export const TodasLasVariantes: StoryObj = { ...pagina(), name: "Toutes les variantes (à venir + passées)" };

export const SoloProximas: StoryObj = {
  ...pagina(() => mocked(getMyOrders).mockResolvedValue({ upcoming: MIS_RESERVAS.upcoming, past: [] })),
  name: "Seulement à venir",
};

export const SinReservas: StoryObj = {
  ...pagina(() => mocked(getMyOrders).mockResolvedValue({ upcoming: [], past: [] })),
  name: "Aucune réservation",
};

export const ErrorDeCarga: StoryObj = {
  ...pagina(() => mocked(getMyOrders).mockResolvedValue(null)),
  name: "Erreur de chargement",
};

export const ConfirmarAnulacion: StoryObj = {
  ...pagina(),
  name: "Annulation : confirmation",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}"]`);
    await expect(await esperar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}-confirm"]`)).toBeVisible();
  },
};

export const ConfirmarUltimaLinea: StoryObj = {
  ...pagina(),
  name: "Annulation : dernière ligne de la commande",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, `[data-testid="cancel-line-${LINEA_UNICA}"]`);
    await expect(await esperar(canvasElement, `[data-testid="cancel-line-${LINEA_UNICA}-last-line"]`)).toBeVisible();
  },
};

export const Anulando: StoryObj = {
  ...pagina(() => simularPendiente("rpc:cancel_order_line")),
  name: "Annulation en cours",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}"]`);
    await pulsar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}-yes"]`);
    await expect(await esperar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}-no"]`)).toBeDisabled();
  },
};

// ⚠️ DÉFAUT RÉEL montré tel quel (relevé le 2026-10-01) : après un échec, la confirmation revient
// à la normale SANS message ; « No se pudo anular » n'apparaît qu'après un clic sur « No ». Cette
// story fait ce clic, pour que l'état d'erreur soit visible — l'écart est dans le code, pas ici.
export const AnulacionFallida: StoryObj = {
  ...pagina(() =>
    simularRpc("cancel_order_line", { data: { ok: false, reason: "line_not_active" }, error: null })
  ),
  name: "Annulation échouée (visible après « No », défaut connu)",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}"]`);
    await pulsar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}-yes"]`);
    await pulsar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}-no"]`);
    await expect(await esperar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}-error"]`)).toBeVisible();
  },
};
