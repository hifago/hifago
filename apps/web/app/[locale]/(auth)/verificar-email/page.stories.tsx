import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { esperar, pulsar } from "@/.storybook/support/interacciones";
import { simularErrorAuth } from "@/.storybook/support/supabaseFalso";
import VerifyEmailPage from "./page";

// `/verificar-email`, l'écran qui suit une inscription. Le renvoi affiche un toast puis un compte
// à rebours de 30 s sur le bouton — les deux sont visibles ensemble dans les stories de renvoi.
const meta = { title: "Écrans/Vérification e-mail", id: "ecrans-verification-email" } satisfies Meta;
export default meta;

const pagina = (opciones: { preparar?: () => void; searchParams?: Record<string, string> } = {}) =>
  historiaDePagina({ Page: VerifyEmailPage, grupo: "auth", ruta: "/verificar-email", ...opciones });

const CON_EMAIL = { searchParams: { email: "laura@ejemplo.co" } };

export const SinEmail: StoryObj = { ...pagina(), name: "Sans e-mail connu" };

export const ConEmail: StoryObj = { ...pagina(CON_EMAIL), name: "Avec l'e-mail" };

export const ReenvioExitoso: StoryObj = {
  ...pagina(CON_EMAIL),
  name: "Renvoi réussi + compte à rebours",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, '[data-testid="resend-confirmation-button"]');
    await expect(await esperar(canvasElement, '[data-testid="resend-confirmation-button"]')).toBeDisabled();
  },
};

export const ReenvioFallido: StoryObj = {
  ...pagina({ ...CON_EMAIL, preparar: () => simularErrorAuth("over_email_send_rate_limit") }),
  name: "Renvoi échoué + compte à rebours",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, '[data-testid="resend-confirmation-button"]');
    await expect(await esperar(canvasElement, '[data-testid="resend-confirmation-button"]')).toBeDisabled();
  },
};
