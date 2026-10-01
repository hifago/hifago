import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { esperar, escribir, pulsar } from "@/.storybook/support/interacciones";
import { simularErrorAuth, simularPendiente, simularSesion } from "@/.storybook/support/supabaseFalso";
import ResetPasswordPage from "./page";

// `/restablecer-password` — on y arrive depuis le lien de l'e-mail, qui ouvre une session. Sans
// session (lien expiré, déjà utilisé), l'écran ne montre pas le formulaire.
const meta = { title: "Écrans/Nouveau mot de passe", id: "ecrans-nouveau-mot-de-passe" } satisfies Meta;
export default meta;

const pagina = (preparar?: () => void) =>
  historiaDePagina({ Page: ResetPasswordPage, grupo: "auth", ruta: "/restablecer-password", preparar });

const conSesion = (extra?: () => void) => () => {
  simularSesion("cuenta");
  extra?.();
};

async function enviar(raiz: HTMLElement, confirmacion = "nueva-clave-segura") {
  await escribir(raiz, 'input[name="password"]', "nueva-clave-segura");
  await escribir(raiz, 'input[name="confirm-password"]', confirmacion);
  await pulsar(raiz, '[data-testid="reset-password-submit"]');
}

export const EnlaceInvalido: StoryObj = { ...pagina(), name: "Lien invalide ou expiré" };

export const Formulario: StoryObj = { ...pagina(conSesion()), name: "Formulaire" };

export const ContrasenasDistintas: StoryObj = {
  ...pagina(conSesion()),
  name: "Mots de passe différents",
  play: async ({ canvasElement }) => {
    await enviar(canvasElement, "otra-clave");
    await expect(await esperar(canvasElement, '[data-testid="reset-password-error"]')).toBeVisible();
  },
};

export const Guardando: StoryObj = {
  ...pagina(conSesion(() => simularPendiente("updateUser"))),
  name: "Enregistrement en cours",
  play: async ({ canvasElement }) => {
    await enviar(canvasElement);
    await expect(await esperar(canvasElement, '[data-testid="reset-password-submit"]')).toBeDisabled();
  },
};

export const Error: StoryObj = {
  ...pagina(conSesion(() => simularErrorAuth("same_password"))),
  name: "Erreur à l'enregistrement",
  play: async ({ canvasElement }) => {
    await enviar(canvasElement);
    await expect(await esperar(canvasElement, '[data-testid="reset-password-error"]')).toBeVisible();
  },
};
