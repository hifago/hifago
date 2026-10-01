import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { esperar, escribir, pulsar } from "@/.storybook/support/interacciones";
import { simularErrorAuth, simularPendiente } from "@/.storybook/support/supabaseFalso";
import LoginPage from "./page";

// `/entrar`, chaque état que l'écran sait montrer (inventaire du 2026-10-01). Aucun code d'erreur
// Supabase n'est lu par l'écran : un seul message pour tout refus, c'est voulu.
const meta = { title: "Écrans/Connexion", id: "ecrans-connexion" } satisfies Meta;
export default meta;

const pagina = (opciones: { preparar?: () => void; searchParams?: Record<string, string> } = {}) =>
  historiaDePagina({ Page: LoginPage, grupo: "auth", ruta: "/entrar", ...opciones });

async function enviarFormulario({ canvasElement }: { canvasElement: HTMLElement }) {
  await escribir(canvasElement, 'input[name="email"]', "laura@ejemplo.co");
  await escribir(canvasElement, 'input[name="password"]', "una-clave-segura");
  await pulsar(canvasElement, 'form button[type="submit"]');
}

async function pulsarGoogle({ canvasElement }: { canvasElement: HTMLElement }) {
  await pulsar(canvasElement, '[data-testid="google-signin-button"]');
}

export const Formulario: StoryObj = { ...pagina(), name: "Formulaire vierge" };

export const RetornoGoogleFallido: StoryObj = {
  ...pagina({ searchParams: { error: "auth_callback_failed" } }),
  name: "Retour de Google échoué",
};

export const Conectando: StoryObj = {
  ...pagina({ preparar: () => simularPendiente("signInWithPassword") }),
  name: "Connexion en cours",
  play: async (contexto) => {
    await enviarFormulario(contexto);
    await expect(await esperar(contexto.canvasElement, 'form button[type="submit"]')).toBeDisabled();
  },
};

export const CredencialesRechazadas: StoryObj = {
  ...pagina({ preparar: () => simularErrorAuth("Invalid login credentials") }),
  name: "Identifiants refusés",
  play: async (contexto) => {
    await enviarFormulario(contexto);
    await expect(await esperar(contexto.canvasElement, '[data-testid="login-error"]')).toBeVisible();
  },
};

export const GoogleRedirigiendo: StoryObj = {
  ...pagina({ preparar: () => simularPendiente("signInWithOAuth") }),
  name: "Google : redirection en cours",
  play: pulsarGoogle,
};

export const GoogleFallido: StoryObj = {
  ...pagina({ preparar: () => simularErrorAuth("oauth_failed") }),
  name: "Google : échec",
  play: async (contexto) => {
    await pulsarGoogle(contexto);
    await expect(await esperar(contexto.canvasElement, '[data-testid="google-signin-button-error"]')).toBeVisible();
  },
};
