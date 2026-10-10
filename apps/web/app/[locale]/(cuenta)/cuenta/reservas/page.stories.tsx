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
// « Anular » (`cancellable`, décidé en base) ; la confirmation prévient quand c'est la dernière
// ligne vivante de la commande, et ne parle de l'acompte que si la commande a été encaissée.
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
  name: "Annulation : confirmation (commande payée)",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}"]`);
    await expect(await esperar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}-confirm"]`)).toBeVisible();
    await expect(await esperar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}-no-refund"]`)).toBeVisible();
  },
};

// Commande impayée : rien n'a été encaissé, la confirmation ne parle d'aucun acompte.
export const ConfirmarUltimaLinea: StoryObj = {
  ...pagina(),
  name: "Annulation : dernière ligne d'une commande impayée",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, `[data-testid="cancel-line-${LINEA_UNICA}"]`);
    await expect(await esperar(canvasElement, `[data-testid="cancel-line-${LINEA_UNICA}-last-line"]`)).toBeVisible();
    await expect(canvasElement.querySelector(`[data-testid="cancel-line-${LINEA_UNICA}-no-refund"]`)).toBeNull();
  },
};

// Décision de Gabriel : le client SAIT que l'annulation a eu lieu.
export const AnulacionHecha: StoryObj = {
  ...pagina(() =>
    simularRpc("cancel_order_line", { data: { ok: true, remaining_active_lines: 1 }, error: null })
  ),
  name: "Annulation faite",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}"]`);
    await pulsar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}-yes"]`);
    await expect(await esperar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}-done"]`)).toHaveTextContent(
      "Anulaste"
    );
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

// Défaut connu n° 4 (relevé le 2026-10-01), corrigé par le plan 41, P8 : l'échec ne s'affichait
// qu'après un clic sur « No ». Il apparaît maintenant dès la réponse, avec le texte de son motif
// (ici : statut changé entre-temps — la confirmation se ferme et l'écran relit la base).
export const AnulacionFallida: StoryObj = {
  ...pagina(() =>
    simularRpc("cancel_order_line", { data: { ok: false, reason: "line_not_active" }, error: null })
  ),
  name: "Annulation échouée",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}"]`);
    await pulsar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}-yes"]`);
    await expect(await esperar(canvasElement, `[data-testid="cancel-line-${LINEA_DE_VARIAS}-error"]`)).toBeVisible();
  },
};
