import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, mocked } from "storybook/test";
import { getPartnerAccountProfileFields } from "@/lib/account/getMyProfile";
import { getPendingOrdersForViewer } from "@/lib/orders/getPendingOrdersForViewer";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { esperar, escribir, pulsar } from "@/.storybook/support/interacciones";
import {
  simularCarrito,
  simularPendiente,
  simularRpc,
  simularSesion,
  simularTabla,
} from "@/.storybook/support/supabaseFalso";
import type { RutasSimuladas } from "@/.storybook/support/fetch";
import { CARRITO_VIAJE } from "@/.storybook/support/fixtures/carrito";
import { PEDIDOS_PENDIENTES } from "@/.storybook/support/fixtures/pedidos";
import CheckoutPage from "./page";

// `/pago` : récapitulatif en lecture seule + coordonnées du titulaire. Le pré-remplissage dépend
// de qui paie (invité, compte avec profil, compte sans profil mais avec une commande passée).
const meta = { title: "Écrans/Pago", id: "ecrans-pago" } satisfies Meta;
export default meta;

const pagina = (preparar?: () => void, simularFetch?: RutasSimuladas): StoryObj => {
  const historia = historiaDePagina({ Page: CheckoutPage, grupo: "tunnel", ruta: "/pago", preparar });
  return simularFetch ? { ...historia, parameters: { ...historia.parameters, simularFetch } } : historia;
};

const invitado = (extra?: () => void) => () => {
  simularCarrito(CARRITO_VIAJE);
  extra?.();
};

const cuenta = (extra?: () => void) => () => {
  simularSesion("cuenta");
  simularCarrito(CARRITO_VIAJE);
  extra?.();
};

/** Remplit ce que l'invité doit saisir, puis envoie. */
async function completar(raiz: HTMLElement, { telefono = "3001112233" } = {}) {
  await escribir(raiz, 'input[name="holder-name"]', "Laura Restrepo");
  await escribir(raiz, 'input[name="holder-email"]', "laura@ejemplo.co");
  await escribir(raiz, "#holder-phone-input", telefono);
  await pulsar(raiz, '[data-testid="submit-order-button"]');
}

export const Vacio: StoryObj = { ...pagina(), name: "Panier vide" };

export const VacioConReservaPendiente: StoryObj = {
  ...pagina(() => mocked(getPendingOrdersForViewer).mockResolvedValue(PEDIDOS_PENDIENTES)),
  name: "Panier vide, réservation à payer",
};

export const Invitado: StoryObj = { ...pagina(invitado()), name: "Invité : formulaire vide" };

export const CuentaConPerfil: StoryObj = { ...pagina(cuenta()), name: "Compte : pré-rempli depuis le profil" };

export const CuentaDesdeUltimaReserva: StoryObj = {
  ...pagina(
    cuenta(() => {
      mocked(getPartnerAccountProfileFields).mockResolvedValue({ fullName: "", phone: "" });
      simularTabla("orders", [
        { account_id: "cuenta-1", holder_name: "Laura R.", holder_phone: "+573001112233" },
        { id: "o-nueva", access_token: "token-o-nueva" },
      ]);
    })
  ),
  name: "Compte : pré-rempli depuis la dernière réservation",
};

// ⚠️ « WhatsApp manquant » n'a PAS de story, et ce n'est pas un oubli : le `<form>` n'a pas
// `noValidate` et le champ est requis, donc c'est l'infobulle NATIVE du navigateur qui bloque
// l'envoi, avant le message de l'app (`checkout-error`, jamais atteint vide). Constaté le
// 2026-10-01 en écrivant cette story ; `.claude/rules/apps.md` prescrit `noValidate` sur un
// formulaire à champ requis — signalé, non corrigé ici (hors périmètre).
export const TelefonoInvalido: StoryObj = {
  ...pagina(invitado()),
  name: "WhatsApp invalide",
  play: async ({ canvasElement }) => {
    await completar(canvasElement, { telefono: "123" });
    await expect(await esperar(canvasElement, '[data-testid="checkout-error"]')).toBeVisible();
  },
};

export const Procesando: StoryObj = {
  ...pagina(invitado(() => simularPendiente("rpc:create_order"))),
  name: "Réservation en cours",
  play: async ({ canvasElement }) => {
    await completar(canvasElement);
    await expect(await esperar(canvasElement, '[data-testid="submit-order-button"]')).toBeDisabled();
  },
};

export const CupoAgotado: StoryObj = {
  ...pagina(
    invitado(() =>
      simularRpc("create_order", { data: { ok: false, reason: "full", line: { qty: 2 } }, error: null })
    )
  ),
  name: "Refus : plus de places",
  play: async ({ canvasElement }) => {
    await completar(canvasElement);
    await expect(await esperar(canvasElement, '[data-testid="checkout-error"]')).toBeVisible();
  },
};

export const PmsRechazo: StoryObj = {
  ...pagina(invitado(), {
    "/api/pms/reserve-nights": { status: 409, body: { ok: false, reason: "pms_refused", released: true } },
  }),
  name: "Refus de l'hôtel (PMS), réservation libérée",
  play: async ({ canvasElement }) => {
    await completar(canvasElement);
    await expect(await esperar(canvasElement, '[data-testid="checkout-error"]')).toBeVisible();
  },
};
