import { test, expect } from "@playwright/test";
import { confirmAndContinue, goToNextWizardStep } from "@hifago/e2e-support";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Accueil du prestataire (texte validé par Jérôme, 2026-10-19, providerWelcomeStep.ts) — une étape à
// la fois sur /partner : établissement, premier service, puis « También eres referente » jusqu'au
// compte Mercado Pago. Un établissement EN REVUE compte : l'accueil ne redit jamais « Aún no tienes
// ningún establecimiento » juste après sa création. Les combinaisons d'états sont prouvées par
// providerWelcomeStep.test.ts ; ici, un seul chemin heureux de bout en bout.
//
// Identité DÉDIÉE fraîchement invitée (même chemin que partner-propose-establishment-creation-
// photo.spec.ts) : un profil seedé a déjà établissement et services.
test("el prestador recién invitado ve una etapa a la vez: establecimiento, servicio, referente", async ({
  page,
  context,
}) => {
  const stamp = Date.now();
  const code = `E2E-PROV-WELCOME-${stamp}`;
  const email = `prov-welcome-e2e-${stamp}@test.local`;
  const password = "ProvWelcome1234!";

  // --- Admin : invitation Prestador ---
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/invitations/new");
  await page.locator('input[name="code"]').fill(code);
  await page.getByTestId("onboarding-path-select").click();
  await page.getByRole("option", { name: "Prestador" }).click();
  await page.getByTestId("create-invitation-button").click();
  const token = new URL(await page.getByTestId("invitation-link").inputValue()).searchParams.get("token");
  expect(token).toBeTruthy();

  // --- Étape 1 : première connexion ---
  await context.clearCookies();
  await page.goto(`/partner/join?token=${token}`);
  await page.locator('input[name="name"]').fill(`Prestador Bienvenida E2E ${stamp}`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByTestId("consent-checkbox").click();
  await page.getByTestId("join-submit-button").click();
  await page.waitForURL("**/partner");
  await expect(page.getByTestId("partner-establishment-pending")).toContainText("Paso 1: crea tu establecimiento");
  await expect(page.getByTestId("partner-status-compact")).toHaveCount(0);

  await page.getByTestId("partner-establishment-pending-action").click();
  await page.waitForURL("**/partner/establishment/new");
  await page.waitForLoadState("networkidle");
  await page.locator("#proposal-nombre").fill(`Guía Sin Oficina ${stamp}`);
  // WhatsApp du socio, obligatoire depuis 20261019170000.
  await page.getByTestId("proposal-whatsapp-input").fill("3001234567");
  await page.getByTestId("submit-establishment-proposal-button").click();
  await confirmAndContinue(page, "establishment-proposal-confirmation");

  // --- Étape 2 : le formulaire de service s'ouvre sur « ce qu'est un service » ---
  await expect(page).toHaveURL(/\/partner\/products\/new\?establecimiento=[0-9a-f-]{36}$/);
  await expect(page.getByTestId("partner-provider-service-step")).toBeVisible();

  // L'accueil dit l'établissement en revue et propose le premier service — plus l'étape 1.
  await page.goto("/partner");
  await expect(page.getByTestId("partner-establishment-pending")).toHaveCount(0);
  const serviceStep = page.getByTestId("partner-provider-service-step");
  await expect(serviceStep.getByTestId("partner-establishment-in-review")).toBeVisible();
  await serviceStep.getByTestId("partner-provider-service-step-action").click();
  await expect(page).toHaveURL(/\/partner\/products\/new\?establecimiento=[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");

  await page.locator('input[name="nombre"]').fill(`Caminata Guiada ${stamp}`);
  await goToNextWizardStep(page);
  await goToNextWizardStep(page);
  await page.getByTestId("price-input").fill("40000");
  await page.getByTestId("submit-product-proposal-button").click();
  await expect(page.getByTestId("product-form-confirmation-secondary-action")).toBeVisible();

  // --- Étape 3 : il est aussi référent ---
  await page.goto("/partner");
  await expect(page.getByTestId("partner-provider-service-step")).toHaveCount(0);
  await expect(page.getByTestId("partner-provider-referrer-step")).toContainText("También eres referente");

  await page.getByTestId("partner-provider-referrer-step-payout").click();
  await page.waitForURL("**/partner/account");
  await page.getByTestId("payout-mercadopago-account-input").fill(email);
  await page.getByTestId("save-payout-account-button").click();
  await expect(page.getByTestId("payout-account-registered")).toBeVisible();

  // Tout est fait : seule la revue de l'établissement reste signalée.
  await page.goto("/partner");
  await expect(page.getByTestId("partner-provider-referrer-step")).toHaveCount(0);
  await expect(page.getByTestId("partner-establishment-in-review")).toBeVisible();
});
