import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { esperar, pulsar } from "@/.storybook/support/interacciones";
import { simularRpc, simularSesion } from "@/.storybook/support/supabaseFalso";
import type { RutasSimuladas } from "@/.storybook/support/fetch";
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

// Une story qui simule aussi des Route Handlers (`/api/*`) : mêmes paramètres, plus `simularFetch`.
const conFetch = (historia: StoryObj, rutas: RutasSimuladas): StoryObj => ({
  ...historia,
  parameters: { ...historia.parameters, simularFetch: rutas },
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

// Trop tard pour payer (P4c) : la base refuse l'intent passé l'échéance de paiement. L'écran le dit
// en clair et retire le bouton, jamais une panne de Mercado Pago ni un « réessayer ».
export const PagoFueraDePlazo: StoryObj = {
  ...pedido("token-por-pagar", {
    preparar: () =>
      simularRpc("create_payment_intent", { data: { ok: false, reason: "order_expiring" }, error: null }),
  }),
  name: "Trop tard pour payer",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, '[data-testid="pay-button"]');
    const aviso = await esperar(canvasElement, '[data-testid="pms-notice"]');
    await expect(aviso).toHaveTextContent("Se agotó el tiempo para pagar");
  },
};

// Nuit PMS sans booking Lobby (P4a, P5d) : l'intent répond `pms_booking_missing`, l'écran tente
// de réserver chez le logement avant de payer. Requête laissée pendante : l'état « en cours ».
export const ConfirmandoAlojamiento: StoryObj = {
  ...conFetch(
    pedido("token-por-pagar", {
      preparar: () =>
        simularRpc("create_payment_intent", { data: { ok: false, reason: "pms_booking_missing" }, error: null }),
    }),
    { "/api/pms/reserve-nights": { demora: "nunca" } }
  ),
  name: "Logement en cours de confirmation avant paiement",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, '[data-testid="pay-button"]');
    const boton = await esperar(canvasElement, '[data-testid="pay-button"]');
    await expect(boton).toHaveTextContent("Confirmando con el alojamiento");
  },
};

// Même départ, mais le logement refuse (plus de disponibilité) : rien n'est encaissé, l'écran le
// dit et ne propose plus de payer.
export const AlojamientoNoConfirmado: StoryObj = {
  ...conFetch(
    pedido("token-por-pagar", {
      preparar: () =>
        simularRpc("create_payment_intent", { data: { ok: false, reason: "pms_booking_missing" }, error: null }),
    }),
    { "/api/pms/reserve-nights": { status: 409, body: { ok: false, reason: "pms_refused" } } }
  ),
  name: "Logement non confirmé : rien n'est encaissé",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, '[data-testid="pay-button"]');
    const aviso = await esperar(canvasElement, '[data-testid="pms-notice"]');
    await expect(aviso).toHaveTextContent("El alojamiento ya no está disponible");
  },
};

export const PagoRechazado: StoryObj = {
  ...pedido("token-por-pagar", { searchParams: { payment: "rejected" } }),
  name: "Retour : paiement refusé",
};

export const Confirmando: StoryObj = { ...pedido("token-confirmando"), name: "Paiement en cours de confirmation" };

export const Pagado: StoryObj = { ...pedido("token-pagado"), name: "Payée" };

export const ConfirmadoSinPago: StoryObj = { ...pedido("token-gratis"), name: "Confirmée sans paiement (gratuit)" };

// Payée mais non honorée : UN écran pour les quatre motifs de la base (payé après expiration ou
// annulation, écart de montant, nuit PMS sans booking, intent remplacé — P5d). Le motif n'est pas
// transmis au client ; le texte du détail, exact pour le premier seulement, attend Jérôme (G33).
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
