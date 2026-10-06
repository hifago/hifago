import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";
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

async function enviar(raiz: HTMLElement, confirmacion = "NuevaClave2026", clave = "NuevaClave2026") {
  await escribir(raiz, 'input[name="password"]', clave);
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

export const ContrasenaDebil: StoryObj = {
  ...pagina(conSesion()),
  name: "Mot de passe hors règle",
  play: async ({ canvasElement }) => {
    await enviar(canvasElement, "nueva-clave", "nueva-clave");
    await expect(await esperar(canvasElement, '[data-testid="reset-password-error"]')).toHaveTextContent(
      "al menos 8 caracteres, con letras y números"
    );
  },
};

export const Guardando: StoryObj = {
  ...pagina(conSesion(() => simularPendiente("updateUser"))),
  name: "Enregistrement en cours",
  play: async ({ canvasElement }) => {
    await enviar(canvasElement);
    // `isPending` (react-aria) garde le bouton focalisable : `aria-disabled`, jamais `disabled`.
    const boton = await esperar(canvasElement, '[data-testid="reset-password-submit"]');
    await waitFor(() => expect(boton).toHaveAttribute("aria-disabled", "true"));
  },
};

export const MismaContrasena: StoryObj = {
  ...pagina(conSesion(() => simularErrorAuth("New password should be different", "same_password"))),
  name: "Même mot de passe qu'avant",
  play: async ({ canvasElement }) => {
    await enviar(canvasElement);
    await expect(await esperar(canvasElement, '[data-testid="reset-password-error"]')).toHaveTextContent(
      "distinta de la actual"
    );
  },
};

export const Error: StoryObj = {
  ...pagina(conSesion(() => simularErrorAuth("unexpected_failure"))),
  name: "Erreur à l'enregistrement",
  play: async ({ canvasElement }) => {
    await enviar(canvasElement);
    await expect(await esperar(canvasElement, '[data-testid="reset-password-error"]')).toBeVisible();
  },
};
