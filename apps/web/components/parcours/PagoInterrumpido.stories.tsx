import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { esperar } from "@/.storybook/support/interacciones";
import * as Resultado from "@/app/[locale]/(vitrine)/reserva/[token]/page.stories";
import * as MiViaje from "@/app/[locale]/(tunnel)/mi-viaje/page.stories";
import { conduceA, etapa } from "./etapas";

// Parcours 4 — le paiement est refusé, le client revient plus tard : la commande l'attend, il la
// retrouve depuis son panier vide et paie (e2e : payment-return.spec.ts, cart-resume-pending-order).
const meta = { title: "Parcours/Paiement interrompu, reprise", id: "parcours-paiement-reprise" } satisfies Meta;
export default meta;

export const Rechazado1: StoryObj = etapa(1, "Retour : paiement refusé", Resultado.PagoRechazado, async ({ canvasElement }) => {
  await expect(await esperar(canvasElement, '[data-testid="retry-payment-button"]')).toBeVisible();
});

export const MiViaje2: StoryObj = etapa(
  2,
  "Plus tard : panier vide, réservation à payer",
  MiViaje.VacioConReservaPendiente,
  async ({ canvasElement }) => {
    await conduceA(canvasElement, "/reserva/token-por-pagar");
  }
);

export const Reintento3: StoryObj = etapa(3, "Nouveau paiement", Resultado.RedirigiendoMercadoPago);

export const Pagado4: StoryObj = etapa(4, "Payée", Resultado.Pagado);
