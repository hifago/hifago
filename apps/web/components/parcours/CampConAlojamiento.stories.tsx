import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { pulsar, esperar } from "@/.storybook/support/interacciones";
import * as Ficha from "@/app/[locale]/(vitrine)/productos/[slug]/page.stories";
import * as MiViaje from "@/app/[locale]/(tunnel)/mi-viaje/page.stories";
import * as Indices from "@/app/[locale]/(vitrine)/indices.stories";
import { conduceA, etapa, navegoA } from "./etapas";

// Parcours 3 — un camp de 5 jours exige un hébergement qui le couvre : le panier bloque le
// paiement et renvoie vers les hébergements compatibles (retour de Jérôme du 2026-09-15).
const meta = { title: "Parcours/Camp : hébergement obligatoire", id: "parcours-camp-hebergement" } satisfies Meta;
export default meta;

export const Ficha1: StoryObj = etapa(
  1,
  "Fiche camp : édition choisie, ajout",
  Ficha.CampEdicionElegida,
  async ({ canvasElement }) => {
    await pulsar(canvasElement, '[data-testid="add-to-cart-button"]');
    // Après l'ajout d'un camp, la vitrine envoie directement vers les hébergements compatibles.
    await navegoA("alojamientoParaCamp=1");
  }
);

export const MiViajeBloqueado2: StoryObj = etapa(
  2,
  "Mi viaje : paiement bloqué",
  MiViaje.CampSinAlojamiento,
  async ({ canvasElement }) => {
    await expect(await esperar(canvasElement, '[data-testid="go-to-checkout"]')).toBeDisabled();
    await conduceA(canvasElement, "/alojamientos");
  }
);

export const Alojamientos3: StoryObj = etapa(
  3,
  "Hébergements pour le camp",
  Indices.AlojamientoParaCamp,
  async ({ canvasElement }) => {
    await expect(await esperar(canvasElement, '[data-testid="camp-lodging-hint"]')).toBeVisible();
  }
);

export const MiViajeDesbloqueado4: StoryObj = etapa(
  4,
  "Mi viaje : débloqué",
  MiViaje.CampConAlojamiento,
  async ({ canvasElement }) => {
    await conduceA(canvasElement, "/pago");
  }
);
