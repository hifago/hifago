import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { escribir, pulsar } from "@/.storybook/support/interacciones";
import * as Inscripcion from "@/app/[locale]/(auth)/registro/page.stories";
import * as Verificacion from "@/app/[locale]/(auth)/verificar-email/page.stories";
import * as Conexion from "@/app/[locale]/(auth)/entrar/page.stories";
import * as Reservas from "@/app/[locale]/(cuenta)/cuenta/reservas/page.stories";
import * as Perfil from "@/app/[locale]/(cuenta)/cuenta/perfil/page.stories";
import { conduceA, etapa, navegoA } from "./etapas";

// Parcours 5 — créer un compte, le confirmer, se connecter, retrouver ses réservations
// (e2e : signup.spec.ts, login.spec.ts, mis-reservas.spec.ts, perfil.spec.ts).
const meta = { title: "Parcours/Compte", id: "parcours-compte" } satisfies Meta;
export default meta;

export const Inscripcion1: StoryObj = etapa(1, "Inscription", Inscripcion.Formulario, async ({ canvasElement }) => {
  await escribir(canvasElement, 'input[name="email"]', "laura@ejemplo.co");
  await escribir(canvasElement, 'input[name="password"]', "una-clave-segura");
  await escribir(canvasElement, 'input[name="confirm-password"]', "una-clave-segura");
  await pulsar(canvasElement, '[data-testid="signup-submit-button"]');
  await navegoA("/verificar-email");
});

export const Verificacion2: StoryObj = etapa(2, "Vérifier son e-mail", Verificacion.ConEmail, async ({ canvasElement }) => {
  await conduceA(canvasElement, "/entrar");
});

export const Conexion3: StoryObj = etapa(3, "Connexion", Conexion.Formulario, async ({ canvasElement }) => {
  await escribir(canvasElement, 'input[name="email"]', "laura@ejemplo.co");
  await escribir(canvasElement, 'input[name="password"]', "una-clave-segura");
  await pulsar(canvasElement, 'form button[type="submit"]');
  await navegoA("/");
});

export const Reservas4: StoryObj = etapa(4, "Mes réservations : annuler une ligne", Reservas.ConfirmarAnulacion);

export const Perfil5: StoryObj = etapa(5, "Mon profil", Perfil.PerfilCompleto);
