import { test, expect, type Page } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Responsive obligatoire sur apps/admin (hifago/CLAUDE.md §2.6, .claude/rules/ui.md) : un
// formulaire en colonnes s'empile sous md (2026-10-02). Prouvé sur les champs de ProductTypeFields,
// les mêmes que le wizard de création (/admin/products/new), ouverts ici d'un coup par la page
// d'édition d'une activité seedée — lecture seule, rien n'est enregistré.
const ACTIVITE_SEEDEE = "b0000000-0000-4000-8000-000000000006";

async function boites(page: Page, gauche: string, droite: string) {
  const a = await page.getByTestId(gauche).boundingBox();
  const b = await page.getByTestId(droite).boundingBox();
  if (!a || !b) throw new Error(`champ introuvable : ${gauche} / ${droite}`);
  return { a, b };
}

const PAIRES: [string, string][] = [
  ["min-qty-input", "max-qty-input"],
  ["lat-input", "lon-input"],
];

test("à 390 px, les paires de champs du formulaire d'activité s'empilent", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/products/${ACTIVITE_SEEDEE}/edit`);

  for (const [gauche, droite] of PAIRES) {
    const { a, b } = await boites(page, gauche, droite);
    // Empilés : même colonne, le second entièrement sous le premier.
    expect(Math.abs(a.x - b.x), `${gauche}/${droite} : même colonne`).toBeLessThan(2);
    expect(b.y, `${gauche}/${droite} : l'un sous l'autre`).toBeGreaterThanOrEqual(a.y + a.height);
  }
});

test("à 1280 px, les mêmes paires restent côte à côte", async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/products/${ACTIVITE_SEEDEE}/edit`);

  for (const [gauche, droite] of PAIRES) {
    const { a, b } = await boites(page, gauche, droite);
    expect(Math.abs(a.y - b.y), `${gauche}/${droite} : même ligne`).toBeLessThan(2);
    expect(b.x, `${gauche}/${droite} : à droite`).toBeGreaterThan(a.x + a.width - 1);
  }
});
