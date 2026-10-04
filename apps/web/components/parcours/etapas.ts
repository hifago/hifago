import type { StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";
import { getRouter } from "@storybook/nextjs-vite/navigation.mock";
import { esperar } from "@/.storybook/support/interacciones";

// Outils des parcours (2026-10-01). Un parcours = une suite de stories d'ÉCRAN réutilisées, une par
// étape, dans l'ordre. Le DERNIER geste de chaque étape vérifie qu'elle mène bien à la suivante —
// un lien qui pointe ailleurs, ou une navigation qui ne part pas, casse le parcours en rouge dans
// l'onglet Interactions. Les vrais enchaînements de bout en bout restent prouvés par Playwright.

type Play = NonNullable<StoryObj["play"]>;

/** Une étape : la story d'écran, renommée « n · Étape », avec un `play` éventuel en plus du sien. */
export function etapa(numero: number, nombre: string, historia: StoryObj, play?: Play): StoryObj {
  return {
    ...historia,
    name: `${numero} · ${nombre}`,
    play: async (contexto) => {
      await historia.play?.(contexto);
      await play?.(contexto);
    },
  };
}

/** L'écran porte un lien vers `ruta` (préfixe de langue ignoré) : l'étape suivante est atteignable. */
export async function conduceA(raiz: HTMLElement, ruta: string) {
  await expect(await esperar(raiz, `a[href$="${ruta}"], a[href*="${ruta}?"]`)).toBeVisible();
}

/** L'action de l'étape a lancé une navigation vers une adresse contenant `fragmento`. */
export async function navegoA(fragmento: string) {
  await waitFor(() => {
    const destinos = getRouter().push.mock.calls.map(([destino]) => String(destino));
    expect(destinos.some((destino) => destino.includes(fragmento))).toBe(true);
  });
}
