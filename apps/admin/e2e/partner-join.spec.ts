import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createTestUser } from "@hifago/e2e-support";

// Les deux tests qui créent une invitation admin partagent le même compte admin seedé, dont le
// facteur TOTP a montré une contention sous exécution parallèle (constaté 2026-08-17, cf. entrée
// docs/journal/2026-08.md, 2026-08-17) — même rationale que partner-establishment-proposals.spec.ts.
test.describe.configure({ mode: "serial" });

// Scénario complet à deux acteurs (cf. plan Feature 13) : un admin crée une invitation et copie le
// lien, puis un contexte navigateur DIFFÉRENT (nouveau visiteur, jamais authentifié) ouvre ce
// lien, remplit le formulaire et atterrit sur son dashboard avec le rôle obtenu — preuve de bout
// en bout des trois écrans (/admin/invitations/new, /partner/join, /partner) dans le même test.
// Depuis la feature 29 (docs/specs/05-invitations-onboarding-dashboard-partenaire.md), la
// consommation réussie redirige vers /partner au lieu d'afficher un message inline.
test("un admin crée une invitation, un nouveau visiteur la consomme et atterrit sur son dashboard", async ({
  browser,
}) => {
  // Nom unique par run : la base locale n'est pas remise à zéro entre deux exécutions (comme
  // admin-establishment.spec.ts) — un code fixe casserait la contrainte unique dès la 2e exécution.
  const code = `E2E-JOIN-${Date.now()}`;

  // --- Acteur 1 : l'admin crée l'invitation ---------------------------------------------------
  const adminContext = await browser.newContext();
  await loginAs(adminContext, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const adminPage = await adminContext.newPage();

  await adminPage.goto("/admin/invitations/new");

  await adminPage.locator('input[name="code"]').fill(code);
  await adminPage.getByTestId("onboarding-path-select").click();
  await adminPage.getByRole("option", { name: "Referente" }).click();
  await adminPage.getByTestId("create-invitation-button").click();

  const linkInput = adminPage.getByTestId("invitation-link");
  await expect(linkInput).toBeVisible();
  const link = await linkInput.inputValue();
  const token = new URL(link).searchParams.get("token");
  expect(token).toBeTruthy();

  await adminContext.close();

  // --- Acteur 2 : un visiteur différent, jamais authentifié, consomme l'invitation -----------
  const visitorContext = await browser.newContext();
  const visitorPage = await visitorContext.newPage();

  await visitorPage.goto(`/partner/join?token=${token}`);

  // Feature 31 — révision 2026-08-19, 2e passe : contrairement à /login et /signup, le bouton
  // Google reste PROPOSÉ ici pour un visiteur neuf — le jeton d'invitation dans l'URL est la
  // preuve d'autorisation, la case n'a pas à être retirée sur cet écran précis (retour réel de
  // Jérôme après un premier blocage global trop large, cf. supabase/config.toml). Assertion
  // volontairement scopée à ça seul — piloter le vrai écran Google OAuth reste hors e2e
  // (hifago/CLAUDE.md §6 point 2).
  await expect(visitorPage.getByTestId("google-signin-button")).toBeVisible();

  // Les conditions sont consultables sans cocher la case au passage (signalé par Jérôme, ajouté
  // le 2026-08-15) — ouvrir/fermer la modale ne doit jamais basculer la case toute seule, un
  // bouton imbriqué dans Checkbox.Content déclencherait ce bug (cf. commentaire JoinForm.tsx).
  const consentCheckbox = visitorPage.getByTestId("consent-checkbox").locator('input[type="checkbox"]');
  await visitorPage.getByTestId("view-terms-button").click();
  await expect(visitorPage.getByRole("heading", { name: "Conditions du rôle partenaire" })).toBeVisible();
  await expect(visitorPage.getByText(/Lorem ipsum/)).toBeVisible();
  await expect(consentCheckbox).not.toBeChecked();
  await visitorPage.getByTestId("close-terms-button").click();
  await expect(consentCheckbox).not.toBeChecked();

  await visitorPage.locator('input[name="name"]').fill("Nouvelle Organisation E2E");
  await visitorPage
    .locator('input[name="email"]')
    .fill(`partner-join-e2e-${Date.now()}@test.local`);
  await visitorPage.locator('input[name="password"]').fill("PartnerJoin1234!");
  await visitorPage.getByTestId("consent-checkbox").click();
  await visitorPage.getByTestId("join-submit-button").click();

  await visitorPage.waitForURL("**/partner");
  // Référent seul, actif dès l'adhésion : son propre bandeau (décision de Gabriel, 2026-10-07),
  // jamais « Prestador activo / Mi establecimiento ».
  await expect(visitorPage.getByTestId("partner-status-referrer")).toHaveText("Referente activo");
  await expect(visitorPage.getByTestId("partner-status-compact")).toHaveCount(0);

  // Bug remonté par Jérôme (2026-08-25) : le nom saisi dans ce formulaire n'apparaissait jamais
  // sur "Mi cuenta" — consume_partner_invitation écrivait p_signer_name dans partners.display_name
  // (l'organisation) et role_agreements.signer_name (audit), jamais dans
  // partner_accounts.full_name (le profil du compte individuel lu par cette page). Corrigé en
  // migration 20260825150000.
  await visitorPage.goto("/partner/account");
  await expect(visitorPage.getByTestId("profile-full-name-input")).toHaveValue("Nouvelle Organisation E2E");

  await visitorContext.close();
});

// Constat 2026-08-17 : un visiteur déjà authentifié (bouton "Continuar con Google", ou toute
// session existante) sautait tout le formulaire créateur de compte — consume_partner_invitation
// ne s'appuie que sur auth.uid(), jamais sur le mode de connexion (cf. JoinForm.tsx). Piloter le
// vrai écran Google OAuth n'est pas testable en e2e (jamais le vrai écran Google, cf.
// hifago/CLAUDE.md §6 point 2) : ce test établit une session sur un compte créé directement en
// base (createTestUser, Feature 31 — révision 2026-08-19, inscription libre désormais bloquée,
// supabase/config.toml enable_signup=false) puis rouvre /partner/join avec cette session déjà
// active — exactement l'état dans lequel /auth/callback dépose un visiteur venu de Google, seule
// la provenance de la session diffère.
test("un visiteur déjà authentifié consomme l'invitation sans recréer de compte", async ({
  browser,
}) => {
  const code = `E2E-JOIN-CONNECTED-${Date.now()}`;

  const adminContext = await browser.newContext();
  await loginAs(adminContext, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const adminPage = await adminContext.newPage();

  await adminPage.goto("/admin/invitations/new");
  await adminPage.locator('input[name="code"]').fill(code);
  await adminPage.getByTestId("onboarding-path-select").click();
  await adminPage.getByRole("option", { name: "Referente" }).click();
  await adminPage.getByTestId("create-invitation-button").click();

  const linkInput = adminPage.getByTestId("invitation-link");
  await expect(linkInput).toBeVisible();
  const link = await linkInput.inputValue();
  const token = new URL(link).searchParams.get("token");
  expect(token).toBeTruthy();

  await adminContext.close();

  // --- Visiteur : compte confirmé et déjà connecté (créé directement en base, hors chemin
  // invitation) ---
  const email = `e2e-join-connected-${Date.now()}@test.local`;
  await createTestUser(email, "JoinConnected1234!");

  const visitorContext = await browser.newContext();
  await loginAs(visitorContext, email, "JoinConnected1234!");
  const visitorPage = await visitorContext.newPage();

  // --- Le même visiteur, déjà connecté, ouvre le lien d'invitation ---
  await visitorPage.goto(`/partner/join?token=${token}`);

  await expect(visitorPage.getByTestId("join-connected-as")).toContainText(email);
  await expect(visitorPage.getByTestId("google-signin-button")).toHaveCount(0);
  await expect(visitorPage.locator('input[name="email"]')).toHaveCount(0);
  await expect(visitorPage.locator('input[name="password"]')).toHaveCount(0);

  await visitorPage.locator('input[name="name"]').fill("Visiteur Déjà Connecté E2E");
  await visitorPage.getByTestId("consent-checkbox").click();
  await visitorPage.getByTestId("join-submit-button").click();

  await visitorPage.waitForURL("**/partner");
  await expect(visitorPage.getByTestId("partner-status-referrer")).toHaveText("Referente activo");

  await visitorContext.close();
});

test("un lien sans jeton affiche un message d'erreur clair, sans formulaire", async ({ page }) => {
  await page.goto("/partner/join");

  await expect(page.getByTestId("invalid-token-error")).toBeVisible();
  await expect(page.locator('input[name="email"]')).toHaveCount(0);
});
