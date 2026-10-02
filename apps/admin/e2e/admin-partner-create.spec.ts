import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { toggleCheckbox } from "@hifago/e2e-support";

// Feature 26 (docs/specs/01-admin-creation-partenaire.md) — la garde /admin/* (compte non-admin
// renvoyé vers sa propre page) est déjà couverte une seule fois par admin-establishment.spec.ts, jamais
// redupliquée par écran (même convention suivie ici que pour les autres "new" existants).
//
// toggleCheckbox (cf. packages/e2e-support/src/dom.ts) : piège Checkbox HeroUI v3 constaté ici
// (2026-08-14) — cliquer le testid racine (même en { force: true }, suffisant pour un Switch)
// laisse l'état inchangé sans erreur ; seul un clic ciblant .locator("input") fonctionne.

test("un compte admin crea un partner mínimo, sin invitación, y lo ve en su ficha", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  // Nom unique par run — la base locale n'est pas remise à zéro entre deux exécutions e2e (même
  // précaution que admin-establishment.spec.ts).
  const displayName = `Partner E2E Mínimo ${Date.now()}`;

  await page.goto("/admin/partners/new");

  await page.getByTestId("display-name-input").fill(displayName);
  // Referente coché par défaut, aucune capacité prestador, aucun código, aucune invitation :
  // désactive "Enviar invitación" (requiert un código) pour rester sur le chemin minimal.
  await toggleCheckbox(page.getByTestId("send-invitation-checkbox"));
  await expect(page.getByTestId("send-invitation-checkbox").locator("input")).not.toBeChecked();

  await page.getByTestId("create-partner-button").click();

  await expect(page).toHaveURL(/\/admin\/partners\/[^/]+$/);
  await expect(page.getByRole("heading", { name: displayName })).toBeVisible();
  await expect(page.getByTestId("capabilities-table").getByText("referrer")).toBeVisible();
});

test("un compte admin crea un partner prestador con código, perfil comercial e invitación", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  const displayName = `Partner E2E Completo ${Date.now()}`;
  const code = `E2ECOMPLETO${Date.now()}`;

  await page.goto("/admin/partners/new");

  await page.getByTestId("display-name-input").fill(displayName);
  // Prestador implica también referente (invariant operator ⇒ referrer, garanti côté RPC/trigger
  // — referente reste coché par défaut ici, pas besoin de le décocher/recocher).
  await toggleCheckbox(page.getByTestId("role-operator-checkbox"));
  await expect(page.getByTestId("role-operator-checkbox").locator("input")).toBeChecked();
  await page.getByTestId("code-input").fill(code);
  await page.getByTestId("address-input").fill("Carrera 1 # 2-34, Guatapé");

  // "Enviar invitación" reste coché par défaut — un código est maintenant renseigné, la
  // validation cliente passe.
  await page.getByTestId("create-partner-button").click();

  // Écran de révélation unique du lien d'invitation (même garantie que NewInvitationForm : seul
  // le hash du jeton persiste côté serveur, le lien brut ne s'affiche qu'ici, une fois).
  await expect(page.getByTestId("invitation-link")).toBeVisible();
  await expect(page.getByTestId("invitation-link")).toHaveValue(/\/partner\/join\?token=.+/);

  // Le partner créé apparaît bien dans le registre (la colonne "capacidades activas" de la liste
  // ne montre que le statut active — les capacités créées ici démarrent pending_review par design,
  // spec §10 — donc la vérification des rôles se fait sur la fiche détail, pas la liste).
  await page.goto("/admin/partners");
  const partnerRow = page.locator("tr", { hasText: displayName });
  await expect(partnerRow).toBeVisible();
  await partnerRow.getByRole("link", { name: "Ver" }).click();
  const capabilitiesTable = page.getByTestId("capabilities-table");
  await expect(capabilitiesTable.getByText("referrer")).toBeVisible();
  await expect(capabilitiesTable.getByText("operator")).toBeVisible();
});

test("prestador solo (sin marcar referente) crea igual la capacidad referente implícita", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  // operator ⇒ referrer (invariant Tranche 1, trigger DB) : create_partner_direct doit préposer
  // 'referrer' même si l'admin ne coche que "Prestador" — ce cas précis n'est pas exercé par les
  // deux tests ci-dessus (où referente reste coché par défaut).
  const displayName = `Partner E2E Solo Prestador ${Date.now()}`;

  await page.goto("/admin/partners/new");
  await page.getByTestId("display-name-input").fill(displayName);
  await toggleCheckbox(page.getByTestId("role-referrer-checkbox")); // décoche
  await expect(page.getByTestId("role-referrer-checkbox").locator("input")).not.toBeChecked();
  await toggleCheckbox(page.getByTestId("role-operator-checkbox"));
  await expect(page.getByTestId("role-operator-checkbox").locator("input")).toBeChecked();
  await toggleCheckbox(page.getByTestId("send-invitation-checkbox")); // pas de código en este test

  await page.getByTestId("create-partner-button").click();

  await expect(page).toHaveURL(/\/admin\/partners\/[^/]+$/);
  const capabilitiesTable = page.getByTestId("capabilities-table");
  await expect(capabilitiesTable.getByText("referrer")).toBeVisible();
  await expect(capabilitiesTable.getByText("operator")).toBeVisible();
});
