import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { esperar, escribir, pulsar } from "@/.storybook/support/interacciones";
import { simularErrorAuth, simularPendiente } from "@/.storybook/support/supabaseFalso";
import SignupPage from "./page";

// `/registro`. Le succès SANS session part vers `/verificar-email` (écran à part). Un e-mail déjà
// pris n'est jamais distingué (message générique) ; seule la règle de mot de passe (8 caractères,
// lettres et chiffres) a son message, dit avant l'envoi.
const meta = { title: "Écrans/Inscription", id: "ecrans-inscription" } satisfies Meta;
export default meta;

const pagina = (opciones: { preparar?: () => void; searchParams?: Record<string, string> } = {}) =>
  historiaDePagina({ Page: SignupPage, grupo: "auth", ruta: "/registro", ...opciones });

async function enviar(raiz: HTMLElement, confirmacion = "ClaveSegura2026", clave = "ClaveSegura2026") {
  await escribir(raiz, 'input[name="email"]', "laura@ejemplo.co");
  await escribir(raiz, 'input[name="password"]', clave);
  await escribir(raiz, 'input[name="confirm-password"]', confirmacion);
  await pulsar(raiz, '[data-testid="signup-submit-button"]');
}

export const Formulario: StoryObj = { ...pagina(), name: "Formulaire vierge" };

export const EmailPrellenado: StoryObj = {
  ...pagina({ searchParams: { email: "laura@ejemplo.co" } }),
  name: "E-mail pré-rempli",
};

export const ContrasenasDistintas: StoryObj = {
  ...pagina(),
  name: "Mots de passe différents",
  play: async ({ canvasElement }) => {
    await enviar(canvasElement, "otra-clave");
    await expect(await esperar(canvasElement, '[data-testid="signup-error"]')).toBeVisible();
  },
};

export const ContrasenaDebil: StoryObj = {
  ...pagina(),
  name: "Mot de passe hors règle",
  play: async ({ canvasElement }) => {
    await enviar(canvasElement, "clave-segura", "clave-segura");
    await expect(await esperar(canvasElement, '[data-testid="signup-error"]')).toHaveTextContent(
      "al menos 8 caracteres, con letras y números"
    );
  },
};

export const Creando: StoryObj = {
  ...pagina({ preparar: () => simularPendiente("signUp") }),
  name: "Création en cours",
  play: async ({ canvasElement }) => {
    await enviar(canvasElement);
    await expect(await esperar(canvasElement, '[data-testid="signup-submit-button"]')).toBeDisabled();
  },
};

export const ErrorGenerico: StoryObj = {
  ...pagina({ preparar: () => simularErrorAuth("User already registered") }),
  name: "Erreur à la création",
  play: async ({ canvasElement }) => {
    await enviar(canvasElement);
    await expect(await esperar(canvasElement, '[data-testid="signup-error"]')).toBeVisible();
  },
};
