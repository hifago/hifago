import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { esperar, escribir, pulsar } from "@/.storybook/support/interacciones";
import { simularPendiente } from "@/.storybook/support/supabaseFalso";
import ForgotPasswordPage from "./page";

// `/olvide-password`. Aucun état d'erreur, et c'est voulu : l'écran ne confirme jamais qu'un
// compte existe — « e-mail envoyé » s'affiche quoi que réponde Supabase.
const meta = { title: "Écrans/Mot de passe oublié", id: "ecrans-mot-de-passe-oublie" } satisfies Meta;
export default meta;

const pagina = (preparar?: () => void) =>
  historiaDePagina({ Page: ForgotPasswordPage, grupo: "auth", ruta: "/olvide-password", preparar });

async function enviar(raiz: HTMLElement) {
  await escribir(raiz, 'input[name="email"]', "laura@ejemplo.co");
  await pulsar(raiz, '[data-testid="forgot-password-submit"]');
}

export const Formulario: StoryObj = { ...pagina(), name: "Formulaire" };

export const Enviando: StoryObj = {
  ...pagina(() => simularPendiente("resetPasswordForEmail")),
  name: "Envoi en cours",
  play: async ({ canvasElement }) => {
    await enviar(canvasElement);
    // `isPending` (react-aria) garde le bouton focalisable : `aria-disabled`, jamais `disabled`.
    const boton = await esperar(canvasElement, '[data-testid="forgot-password-submit"]');
    await waitFor(() => expect(boton).toHaveAttribute("aria-disabled", "true"));
  },
};

export const CorreoEnviado: StoryObj = {
  ...pagina(),
  name: "E-mail envoyé",
  play: async ({ canvasElement }) => {
    await enviar(canvasElement);
    await expect(await esperar(canvasElement, '[data-testid="forgot-password-sent"]')).toBeVisible();
  },
};
