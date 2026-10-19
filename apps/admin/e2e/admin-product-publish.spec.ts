import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { filaPorNombre } from "./support/filas";
import { confirmAndContinue, goToNextWizardStep, webProductUrl } from "@hifago/e2e-support";
import { slugify } from "../lib/utils";

test("admin dépublie puis republie une activité, invisible/visible côté public en conséquence", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  // Établissement + activité dédiés à ce test — sellable=true à la création (retour Jérôme,
  // 2026-08-20 : product-form.tsx n'écrase plus le défaut colonne).
  const establishmentName = `Establecimiento E2E Publish ${Date.now()}`;
  await page.goto("/admin/establishments/new");
  // Assistant par étapes (docs/specs/40) — étape 1 "Propietario y gestión" (partner), étape 2
  // "Detalles" (nombre).
  const partnerSearchPublish = page.getByTestId("partner-search");
  await partnerSearchPublish.click();
  await partnerSearchPublish.fill("Opérateur Actif");
  await page.getByRole("option", { name: /Opérateur Actif/ }).click();
  await goToNextWizardStep(page);
  await page.locator('input[name="nombre"]').fill(establishmentName);
  // WhatsApp du prestataire, obligatoire depuis 20261019170000.
  await page.getByTestId("establishment-whatsapp-input").fill("3001234567");
  await page.getByTestId("create-establishment-button").click();
  await confirmAndContinue(page, "establishment-form-confirmation");
  await expect(page).toHaveURL(/\/admin\/establishments$/);

  const row = filaPorNombre(page, establishmentName);
  await row.getByRole("link", { name: "+ Actividad" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/new\?establishment=/);
  // Spec 11 — ProductForm est nettement plus lourd à hydrater que l'ancien NewProductForm
  // (galerie/crop, éditeur de créneaux, autocomplete d'adresse) : sans cette attente, la toute
  // première interaction sur la page peut atteindre le DOM avant que React n'ait attaché ses
  // gestionnaires (valeur/submit perdus silencieusement, jamais reçus par le state React).
  await page.waitForLoadState("networkidle");

  const productName = `Actividad E2E Publish ${Date.now()}`;
  await page.locator('input[name="nombre"]').fill(productName);

  // Assistant par étapes (docs/specs/40) — étape 1 validée, traverse l'étape 2 "Detalles" sans
  // rien y saisir (tout y est optionnel pour une actividad) jusqu'à l'étape 3 "Comercialización".
  await goToNextWizardStep(page);
  await goToNextWizardStep(page);
  await page.locator('input[name="price"]').fill("40000");
  await page.getByTestId("create-product-button").click();
  await confirmAndContinue(page, "product-form-confirmation");
  await expect(page).toHaveURL(/\/admin\/establishments$/);

  await row.getByRole("link", { name: /actividades/ }).click();
  // Attente identique à celle du formulaire produit (ci-dessus) : cliquer un <Link> Next.js
  // avant que la page ne soit hydratée peut laisser l'URL inchangée (la transition client-side
  // n'a rien à intercepter tant que React n'a pas attaché le routeur).
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: productName }).click();
  await expect(page).toHaveURL(/\/admin\/products\/.+\/edit$/);
  const editUrl = page.url();

  const statusBadge = page.getByTestId("product-status-badge");
  const toggleButton = page.getByTestId("toggle-sellable-button");
  await expect(statusBadge).toHaveText("Vendible");

  const slug = slugify(productName);
  await context.clearCookies();
  const publishedResponse = await page.goto(webProductUrl(slug));
  expect(publishedResponse?.status()).toBe(200);
  await expect(page.getByText(productName)).toBeVisible();

  // Dépublier — retour en admin (cookies effacés ci-dessus) -----------------------------------
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(editUrl);
  await expect(statusBadge).toHaveText("Vendible");

  await toggleButton.click();
  await expect(statusBadge).toHaveText("No vendible");

  await context.clearCookies();
  const unpublishedResponse = await page.goto(webProductUrl(slug));
  expect(unpublishedResponse?.status()).toBe(404);

  // Republier — prouve le sens inverse du bascule, pas seulement dépublier une fois -------------
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(editUrl);
  await expect(statusBadge).toHaveText("No vendible");

  await toggleButton.click();
  await expect(statusBadge).toHaveText("Vendible");

  await context.clearCookies();
  const republishedResponse = await page.goto(webProductUrl(slug));
  expect(republishedResponse?.status()).toBe(200);
});
