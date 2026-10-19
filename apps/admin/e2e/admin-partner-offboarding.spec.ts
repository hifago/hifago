import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { filaPorNombre } from "./support/filas";
import {
  confirmAndContinue,
  goToNextWizardStep,
  webProductUrl,
  selectValue,
} from "@hifago/e2e-support";
import { slugify } from "../lib/utils";

test("admin déroule les 4 étapes d'offboarding d'un partenaire, ses activités disparaissent du catalogue public après l'étape 1", async ({
  page,
  context,
  browser,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  // Partenaire dédié à ce test — jamais un partenaire seedé partagé (offboarding_unpublish dépublie
  // TOUS les produits sellable du partenaire, un effet de bord destructeur trop large pour un
  // partenaire réutilisé par d'autres specs e2e). Créé via le parcours d'invitation complet
  // (feature 13), chemin "provider" pour obtenir referrer + operator d'un coup.
  const stamp = Date.now();
  const partnerName = `Organización Offboarding E2E ${stamp}`;
  const invitationCode = `E2E-OFFBOARD-${stamp}`;

  await page.goto("/admin/invitations/new");
  await page.locator('input[name="code"]').fill(invitationCode);
  await page.getByTestId("onboarding-path-select").click();
  await page.getByRole("option", { name: "Prestador" }).click();
  await page.getByTestId("create-invitation-button").click();

  const linkInput = page.getByTestId("invitation-link");
  await expect(linkInput).toBeVisible();
  const link = await linkInput.inputValue();
  const token = new URL(link).searchParams.get("token");
  expect(token).toBeTruthy();

  // Contexte séparé, jamais authentifié : consomme l'invitation, crée le partenaire.
  const visitorContext = await browser.newContext();
  const visitorPage = await visitorContext.newPage();
  await visitorPage.goto(`/partner/join?token=${token}`);
  await visitorPage.locator('input[name="name"]').fill(partnerName);
  await visitorPage
    .locator('input[name="email"]')
    .fill(`offboarding-e2e-${stamp}@test.local`);
  await visitorPage.locator('input[name="password"]').fill("OffboardingE2E1234!");
  await visitorPage.getByTestId("consent-checkbox").click();
  await visitorPage.getByTestId("join-submit-button").click();
  // Depuis la feature 29 (docs/specs/05-invitations-onboarding-dashboard-partenaire.md), une
  // consommation réussie redirige vers /partner au lieu d'afficher un message inline.
  await visitorPage.waitForURL("**/partner");
  await visitorContext.close();

  // Établissement + activité rattachés à ce nouveau partenaire, publiés (sellable=true).
  const establishmentName = `Establecimiento Offboarding E2E ${stamp}`;
  await page.goto("/admin/establishments/new");
  // Assistant par étapes (docs/specs/40) — étape 1 "Propietario y gestión" (partner), étape 2
  // "Detalles" (nombre).
  const partnerSearchOffboarding = page.getByTestId("partner-search");
  await partnerSearchOffboarding.click();
  await partnerSearchOffboarding.fill(partnerName);
  await page.getByRole("option", { name: new RegExp(partnerName) }).click();
  await goToNextWizardStep(page);
  await page.locator('input[name="nombre"]').fill(establishmentName);
  // WhatsApp du prestataire, obligatoire depuis 20261019170000.
  await page.getByTestId("establishment-whatsapp-input").fill("3001234567");
  await page.getByTestId("create-establishment-button").click();
  await confirmAndContinue(page, "establishment-form-confirmation");
  await expect(page).toHaveURL(/\/admin\/establishments$/);

  const establishmentRow = filaPorNombre(page, establishmentName);
  await establishmentRow.getByRole("link", { name: "+ Actividad" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/new\?establishment=/);
  // Spec 11 — ProductForm est nettement plus lourd à hydrater que l'ancien NewProductForm
  // (galerie/crop, éditeur de créneaux, autocomplete d'adresse) : sans cette attente, la toute
  // première interaction sur la page peut atteindre le DOM avant que React n'ait attaché ses
  // gestionnaires (valeur/submit perdus silencieusement, jamais reçus par le state React).
  await page.waitForLoadState("networkidle");

  const productName = `Actividad Offboarding E2E ${stamp}`;
  await page.locator('input[name="nombre"]').fill(productName);

  // Assistant par étapes (docs/specs/40) — étape 1 validée, traverse l'étape 2 "Detalles" sans
  // rien y saisir (tout y est optionnel pour une actividad) jusqu'à l'étape 3 "Comercialización".
  await goToNextWizardStep(page);
  await goToNextWizardStep(page);
  await page.locator('input[name="price"]').fill("35000");
  await page.getByTestId("create-product-button").click();
  await confirmAndContinue(page, "product-form-confirmation");
  await expect(page).toHaveURL(/\/admin\/establishments$/);

  await establishmentRow.getByRole("link", { name: /actividades/ }).click();
  // Cliquer un <Link> Next.js avant hydratation de la page cible peut laisser l'URL inchangée.
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: productName }).click();
  await expect(page).toHaveURL(/\/admin\/products\/.+\/edit$/);
  // Déjà publié à la création (sellable=true par défaut, retour Jérôme 2026-08-20).
  await expect(page.getByTestId("product-status-badge")).toHaveText("Vendible");

  const slug = slugify(productName);
  await context.clearCookies();
  const publishedResponse = await page.goto(webProductUrl(slug));
  expect(publishedResponse?.status()).toBe(200);

  // Ouvre l'offboarding du partenaire ------------------------------------------------------------
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/partners");
  const partnerRow = filaPorNombre(page, partnerName);
  await partnerRow.getByRole("link", { name: "Ver" }).click();
  await page.getByTestId("offboarding-link").click();
  await expect(page).toHaveURL(/\/admin\/partners\/.+\/offboarding$/);
  const offboardingUrl = page.url();

  // Étapes 3 et 4 verrouillées tant que la précédente n'est pas complète ------------------------
  await expect(page.getByTestId("offboarding-step3-button")).toBeDisabled();
  await expect(page.getByTestId("offboarding-step4-button")).toBeDisabled();
  await expect(page.getByTestId("offboarding-step2-info")).toBeVisible();

  // Étape 1 : dépublier ------------------------------------------------------------------------
  await page.getByTestId("offboarding-step1-button").click();
  await expect(page.getByTestId("offboarding-step1-done")).toBeVisible();

  // La fiche produit publique disparaît (dépubliée par l'action groupée) ------------------------
  await context.clearCookies();
  const unpublishedResponse = await page.goto(webProductUrl(slug));
  expect(unpublishedResponse?.status()).toBe(404);

  // Étape 2 : rien à faire, jamais de bouton -----------------------------------------------------
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(offboardingUrl);
  await expect(page.getByTestId("offboarding-step1-done")).toBeVisible();

  // Étape 3 : attester le règlement, maintenant activée -------------------------------------------
  await expect(page.getByTestId("offboarding-step3-button")).toBeEnabled();
  await page
    .getByTestId("offboarding-step3-note")
    .fill("Pago verificado manualmente por Jerome, fuera de la plataforma.");
  await page.getByTestId("offboarding-step3-button").click();
  await expect(page.getByTestId("offboarding-step3-done")).toBeVisible();

  // Étape 4 : retirer la capacité, maintenant activée ----------------------------------------------
  await expect(page.getByTestId("offboarding-step4-button")).toBeEnabled();
  await expect(page.getByTestId("offboarding-step4-reminder")).toContainText("1 establecimiento");
  await page.getByTestId("offboarding-step4-button").click();
  await expect(page.getByTestId("offboarding-step4-done")).toBeVisible();
  await expect(page.getByTestId("offboarding-complete-banner")).toBeVisible();

  // Preuve du scope : operator suspendu, referrer intact -------------------------------------------
  // selectValue() scope l'assertion à la valeur affichée, pas à la ligne entière : le Select
  // HeroUI garde un <select> natif caché (fallback accessibilité/formulaire) qui liste TOUJOURS le
  // texte de tous les statuts possibles — un .toContainText sur la ligne entière matcherait
  // "suspended" qu'il soit sélectionné ou non, faussant l'assertion négative.
  await page.goto(page.url().replace(/\/offboarding$/, ""));
  const capabilitiesTable = page.getByTestId("capabilities-table");
  const operatorRow = capabilitiesTable.locator("tr", { hasText: "operator" });
  await expect(selectValue(operatorRow)).toContainText("suspended");
  const referrerRow = capabilitiesTable.locator("tr", { hasText: "referrer" });
  await expect(selectValue(referrerRow)).not.toContainText("suspended");
});
