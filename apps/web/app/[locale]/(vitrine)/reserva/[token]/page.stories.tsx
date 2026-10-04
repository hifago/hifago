import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { esperar, pulsar } from "@/.storybook/support/interacciones";
import { simularRpc, simularSesion } from "@/.storybook/support/supabaseFalso";
import OrderResultPage from "./page";

// `/reserva/<jeton>` : le résultat d'une commande, un état par statut (`deriveOrderState`). La
// commande est choisie par son jeton parmi `support/fixtures/pedidos.ts`.
const meta = { title: "Écrans/Résultat de réservation", id: "ecrans-resultat-reservation" } satisfies Meta;
export default meta;

const pedido = (
  token: string,
  opciones: { preparar?: () => void; searchParams?: Record<string, string> } = {}
): StoryObj =>
  historiaDePagina({
    Page: OrderResultPage,
    grupo: "vitrine",
    ruta: `/reserva/${token}`,
    params: { token },
    ...opciones,
  });

export const PorPagar: StoryObj = { ...pedido("token-por-pagar"), name: "À payer (invité)" };

export const PorPagarCuenta: StoryObj = {
  ...pedido("token-por-pagar", { preparar: () => simularSesion("cuenta") }),
  name: "À payer (compte connecté)",
};

export const RedirigiendoMercadoPago: StoryObj = {
  ...pedido("token-por-pagar"),
  name: "Départ vers Mercado Pago",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, '[data-testid="pay-button"]');
    await expect(await esperar(canvasElement, '[data-testid="pay-button"]')).toBeDisabled();
  },
};

export const PagoNoIniciado: StoryObj = {
  ...pedido("token-por-pagar", {
    preparar: () =>
      simularRpc("create_payment_intent", { data: { ok: false, reason: "mercadopago_unavailable" }, error: null }),
  }),
  name: "Paiement impossible à lancer (Réessayer)",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, '[data-testid="pay-button"]');
    await expect(await esperar(canvasElement, '[data-testid="retry-payment-button"]')).toBeVisible();
  },
};

export const PagoRechazado: StoryObj = {
  ...pedido("token-por-pagar", { searchParams: { payment: "rejected" } }),
  name: "Retour : paiement refusé",
};

export const Confirmando: StoryObj = { ...pedido("token-confirmando"), name: "Paiement en cours de confirmation" };

export const Pagado: StoryObj = { ...pedido("token-pagado"), name: "Payée" };

export const ConfirmadoSinPago: StoryObj = { ...pedido("token-gratis"), name: "Confirmée sans paiement (gratuit)" };

export const PagoNoHonrado: StoryObj = { ...pedido("token-no-honrado"), name: "Payée mais non honorée" };

export const Reembolsado: StoryObj = { ...pedido("token-reembolsado"), name: "Remboursée" };

export const Expirado: StoryObj = { ...pedido("token-expirado"), name: "Expirée" };

export const Anulado: StoryObj = {
  ...pedido("token-anulado"),
  name: "Annulée",
  play: async ({ canvasElement }) => {
    await expect(await esperar(canvasElement, '[data-testid="order-state-cancelled"]')).toBeVisible();
  },
};

export const LineasMixtas: StoryObj = {
  ...pedido("token-mixto"),
  name: "Une ligne annulée, sans téléphone du titulaire",
};
