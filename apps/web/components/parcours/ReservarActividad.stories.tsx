import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";
import { addDaysIso, todayInBogota } from "@hifago/domain";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { esperar, escribir, pulsar } from "@/.storybook/support/interacciones";
import { carritoSimulado, simularCarrito } from "@/.storybook/support/supabaseFalso";
import { ACTIVIDAD_CAMINATA } from "@/.storybook/support/fixtures/productos";
import * as Accueil from "@/app/[locale]/(vitrine)/page.stories";
import * as Ficha from "@/app/[locale]/(vitrine)/productos/[slug]/page.stories";
import CartPage from "@/app/[locale]/(tunnel)/mi-viaje/page";
import CheckoutPage from "@/app/[locale]/(tunnel)/pago/page";
import OrderResultPage from "@/app/[locale]/(vitrine)/reserva/[token]/page";
import { conduceA, etapa, navegoA } from "./etapas";

// Parcours 1 — réserver une activité en invité, de l'accueil au paiement (e2e : reserve.spec.ts).
const meta = { title: "Parcours/Réserver une activité", id: "parcours-reserver-activite" } satisfies Meta;
export default meta;

const dia = (desplazamiento: number) => addDaysIso(todayInBogota(), desplazamiento);

// Ce que l'étape 2 met au panier, et que les étapes 3 et 4 retrouvent.
const LINEA = [{ productId: ACTIVIDAD_CAMINATA.id, date: dia(1), qty: 2 }];

export const Accueil1: StoryObj = etapa(1, "Accueil", Accueil.Defecto, async ({ canvasElement }) => {
  await conduceA(canvasElement, `/productos/${ACTIVIDAD_CAMINATA.slug}`);
});

// Variante d'exploration de l'étape 1 (fond marine #132f61, cartes or), placée juste dessous pour
// passer de l'une à l'autre dans la barre latérale — même geste de sortie que l'étape 1.
export const Accueil1Invertido: StoryObj = {
  ...etapa(1, "Accueil", Accueil.DefectoColoresInvertidos, async ({ canvasElement }) => {
    await conduceA(canvasElement, `/productos/${ACTIVIDAD_CAMINATA.slug}`);
  }),
  name: "1 bis · Accueil — fond marine, cartes or",
};

export const Ficha2: StoryObj = etapa(2, "Fiche : date choisie, ajout", Ficha.FechaElegida, async ({ canvasElement }) => {
  await pulsar(canvasElement, '[data-testid="add-to-cart-button"]');
  await waitFor(() => expect(carritoSimulado()).toHaveLength(1));
});

export const MiViaje3: StoryObj = etapa(
  3,
  "Mi viaje",
  historiaDePagina({ Page: CartPage, grupo: "tunnel", ruta: "/mi-viaje", preparar: () => simularCarrito(LINEA) }),
  async ({ canvasElement }) => {
    await conduceA(canvasElement, "/pago");
  }
);

export const Pago4: StoryObj = etapa(
  4,
  "Pago : coordonnées, réservation",
  historiaDePagina({ Page: CheckoutPage, grupo: "tunnel", ruta: "/pago", preparar: () => simularCarrito(LINEA) }),
  async ({ canvasElement }) => {
    await escribir(canvasElement, 'input[name="holder-name"]', "Laura Restrepo");
    await escribir(canvasElement, 'input[name="holder-email"]', "laura@ejemplo.co");
    await escribir(canvasElement, "#holder-phone-input", "3001112233");
    await pulsar(canvasElement, '[data-testid="submit-order-button"]');
    await navegoA("/reserva/token-o-nueva");
  }
);

// La commande que l'étape 4 vient de créer (`create_order` simulée rend toujours `o-nueva`).
export const Resultado5: StoryObj = etapa(
  5,
  "Résultat : payer l'acompte",
  historiaDePagina({
    Page: OrderResultPage,
    grupo: "vitrine",
    ruta: "/reserva/token-o-nueva",
    params: { token: "token-o-nueva" },
  }),
  async ({ canvasElement }) => {
    await pulsar(canvasElement, '[data-testid="pay-button"]');
    await expect(await esperar(canvasElement, '[data-testid="pay-button"]')).toBeDisabled();
  }
);
