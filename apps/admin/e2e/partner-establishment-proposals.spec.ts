import { test, expect } from "@playwright/test";
import {
  confirmAndContinue,
  createSignedInClient,
  createActiveOperatorEstablishment,
} from "@hifago/e2e-support";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// docs/specs/06-gestion-etablissement.md — un partenaire ne crée/n'édite jamais directement sa
// fiche établissement : il propose, un admin approuve (même invariant que product_proposals/
// submit_photos_proposal, spec 04). operador.propuestas (Feature 15, seed.sql) est le seul profil
// seedé avec une capacité operator ACTIVE — utilisé pour toutes les propositions ci-dessous.
//
// Exécution en série (pas fullyParallel, cf. playwright.config.ts) : les 3 tests partagent le même
// partenaire seedé et le garde-fou métier "au plus une proposition kind='create' pending par
// partenaire" (submit_establishment_creation_proposal, §7) — les faire courir en parallèle ferait
// échouer par collision légitime sur ce plafond, pas une vraie panne.
test.describe.configure({ mode: "serial" });

test("un socio propone la creación de un establecimiento, publicado solo tras aprobación admin", async ({
  page,
  context,
}) => {
  const proposedName = `Nuevo Hostal Propuesto ${Date.now()}`;

  // --- Socio : propone, jamais publié directement ---
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto("/partner/establishment/new");

  await page.locator("#proposal-nombre").fill(proposedName);
  await page.getByTestId("proposal-address-input").fill("Vereda El Roble, Guatapé");
  await page.getByTestId("submit-establishment-proposal-button").click();

  // Écran de confirmation plein écran (docs/specs/40 §4) — remplace le formulaire, son bouton
  // d'action déclenche la redirection auparavant immédiate.
  // Action secondaire : l'action principale enchaîne désormais sur « Añadir una actividad »
  // (20261019120000) ; ce parcours-ci revient à la liste.
  await page.getByTestId("establishment-proposal-confirmation-secondary-action").click();

  await expect(page).toHaveURL(/\/partner\/establishment$/);
  await expect(page.getByTestId("pending-creation-banner")).toBeVisible();
  await expect(page.getByTestId("pending-creation-banner")).toContainText(proposedName);
  await expect(page.getByTestId("establishment-list")).not.toContainText(proposedName);

  // --- Admin : la proposition apparaît marquée "Creación", sans valeur actuelle ---
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/proposals");

  // kind='create' n'a pas encore d'établissement : la liste affiche le nom PROPOSÉ (seul disponible,
  // cf. AdminProposalsPage) — contrairement à kind='edit', où elle affiche le nom ACTUEL (cf. test
  // suivant), fidèle au même choix déjà fait pour product_proposals (toujours le nom de l'entité
  // ACTUELLE quand elle existe).
  const row = page.locator('[data-testid^="proposal-row-"]', { hasText: proposedName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Creación");
  await row.getByRole("link", { name: "Revisar" }).click();

  await expect(page).toHaveURL(/\/admin\/proposals\/.+\?entity=establishment/);
  await expect(page.getByTestId("no-current-establishment")).toBeVisible();
  await expect(page.getByTestId("proposed-values")).toContainText(proposedName);

  await page.getByTestId("approve-button").click();
  // Le succès n'est plus un texte inline mais un toast (docs/specs/16-notifications-toast.md) —
  // HeroUI rend chaque toast avec role="alertdialog", le message passé à toast.success(...)
  // devient son titre visible.
  await expect(
    page.getByRole("alertdialog").filter({ hasText: "Propuesta aprobada — establecimiento creado." }),
  ).toBeVisible();

  // --- Le nouvel établissement existe désormais dans le registre admin ---
  // Le registre est éditable en ligne (20261013145629) : le nom est la VALEUR d'un champ, que
  // getByText ne lit pas — on cible la ligne, dont le nom accessible le contient.
  await page.goto("/admin/establishments");
  await expect(page.getByRole("row", { name: new RegExp(proposedName) })).toBeVisible();

  // --- La liste du socio reflète l'établissement publié, plus de proposition en attente ---
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto("/partner/establishment");
  await expect(page.getByTestId("pending-creation-banner")).toHaveCount(0);
  await expect(page.getByTestId("establishment-list")).toContainText(proposedName);
});

test("un socio propone une edición de su establecimiento ya rattaché, publicado solo tras aprobación admin", async ({
  page,
  context,
}) => {
  // Établissement DÉDIÉ à ce test (pas le b0000000-...-004 partagé par d'autres specs, ex.
  // admin-establishment-edit.spec.ts) : ce test approuve réellement une édition qui change le nom
  // affiché, une fixture partagée entre fichiers de test créerait une vraie collision de contenu,
  // pas seulement un nom dupliqué (même leçon que partner-propose-photo.spec.ts §1). Créé via
  // create_establishment (admin) puis activé via set_capability_status — même chemin que suivrait
  // l'admin en approuvant une proposition, cf. §7 de la spec.
  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const seedName = `Establecimiento Dedicado ${Date.now()}`;
  const newEstablishmentId = await createActiveOperatorEstablishment(
    adminClient,
    "b0000000-0000-4000-8000-000000000003",
    seedName,
  );

  const proposedName = `Establecimiento Editado ${Date.now()}`;

  // --- Socio : propone une édition sur son établissement déjà rattaché ---
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto(`/partner/establishment/${newEstablishmentId}/edit`);

  await expect(page.getByTestId("pending-edit-proposal")).toHaveCount(0);
  await expect(page.locator("#edit-proposal-nombre")).toHaveValue(seedName);

  await page.locator("#edit-proposal-nombre").fill(proposedName);
  await page.getByTestId("edit-proposal-address-input").fill("Calle Propuesta 456");
  await page.getByTestId("submit-edit-proposal-button").click();

  // Écran de confirmation contenu dans la carte (docs/specs/40 §4) — remplace l'ancienne bannière
  // au-dessus du formulaire toujours éditable. Contenu générique, PAS nominatif (contrairement à
  // l'ancienne bannière) : la preuve que la proposition a bien retenu `proposedName` est que
  // "Editar de nuevo" restaure le formulaire avec cette valeur, pas un texte affiché sur l'écran.
  const pendingEditConfirmation = page.getByTestId("pending-edit-proposal");
  await expect(pendingEditConfirmation).toBeVisible();
  await expect(pendingEditConfirmation).toContainText("Cambios enviados para revisión");

  await confirmAndContinue(page, "pending-edit-proposal");
  await expect(page.locator("#edit-proposal-nombre")).toHaveValue(proposedName);

  // --- Admin : la fiche affiche encore le nom ACTUEL (seed) en valeur de la ligne, marquée
  // "Edición" — la liste affiche toujours le nom actuel de l'entité, jamais le nom proposé, cf.
  // test précédent (kind='create' fait exception faute d'entité existante). ---
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/proposals");

  const row = page.locator('[data-testid^="proposal-row-"]', { hasText: seedName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Edición");
  await row.getByRole("link", { name: "Revisar" }).click();

  await expect(page.getByTestId("current-values")).toContainText(seedName);
  await expect(page.getByTestId("no-current-establishment")).toHaveCount(0);
  await expect(page.getByTestId("proposed-values")).toContainText(proposedName);

  await page.getByTestId("approve-button").click();
  // Le succès n'est plus un texte inline mais un toast (docs/specs/16-notifications-toast.md) —
  // HeroUI rend chaque toast avec role="alertdialog", le message passé à toast.success(...)
  // devient son titre visible.
  await expect(page.getByRole("alertdialog").filter({ hasText: "Propuesta aprobada." })).toBeVisible();

  // --- La fiche admin reflète désormais le nom publié ---
  await page.goto(`/admin/establishments/${newEstablishmentId}`);
  await expect(page.getByRole("heading", { name: proposedName })).toBeVisible();

  // --- Le socio ne voit plus de proposition en attente, le formulaire reflète la valeur publiée ---
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto(`/partner/establishment/${newEstablishmentId}/edit`);
  await expect(page.getByTestId("pending-edit-proposal")).toHaveCount(0);
  await expect(page.locator("#edit-proposal-nombre")).toHaveValue(proposedName);
});

test("un socio retira su propuesta de creación pendiente", async ({ page, context }) => {
  const proposedName = `Hostal A Retirar ${Date.now()}`;

  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto("/partner/establishment/new");

  await page.locator("#proposal-nombre").fill(proposedName);
  await page.getByTestId("submit-establishment-proposal-button").click();
  // Action secondaire : l'action principale enchaîne désormais sur « Añadir una actividad »
  // (20261019120000) ; ce parcours-ci revient à la liste.
  await page.getByTestId("establishment-proposal-confirmation-secondary-action").click();

  await expect(page).toHaveURL(/\/partner\/establishment$/);
  await expect(page.getByTestId("pending-creation-banner")).toContainText(proposedName);

  await page.getByTestId("withdraw-creation-proposal-button").click();
  await expect(page.getByTestId("pending-creation-banner")).toHaveCount(0);

  // Le plafond dédié (1 proposition kind='create' pending) est bien libéré : une nouvelle
  // proposition peut être soumise immédiatement, sans "pending_creation_exists".
  await page.goto("/partner/establishment/new");
  await page.locator("#proposal-nombre").fill(`${proposedName} bis`);
  await page.getByTestId("submit-establishment-proposal-button").click();
  // Action secondaire : l'action principale enchaîne désormais sur « Añadir una actividad »
  // (20261019120000) ; ce parcours-ci revient à la liste.
  await page.getByTestId("establishment-proposal-confirmation-secondary-action").click();
  await expect(page).toHaveURL(/\/partner\/establishment$/);
  await expect(page.getByTestId("pending-creation-banner")).toContainText(`${proposedName} bis`);

  // Nettoyage explicite : la base locale n'est pas remise à zéro entre deux exécutions e2e (cf.
  // partner-propose-photo.spec.ts) — une proposition "bis" laissée pending ferait échouer le test
  // "un socio propone la creación..." au prochain run (pending_creation_exists).
  await page.getByTestId("withdraw-creation-proposal-button").click();
  await expect(page.getByTestId("pending-creation-banner")).toHaveCount(0);
});
