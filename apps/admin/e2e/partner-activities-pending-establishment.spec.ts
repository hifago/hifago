import { test, expect } from "@playwright/test";
import {
  confirmAndContinue,
  createSignedInClient,
  goToNextWizardStep,
  selectValue,
} from "@hifago/e2e-support";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Migration 20261019120000 (demande Jérôme, 2026-10-19) — un partenaire propose son établissement
// et, dans la foulée, ses activités, sans attendre l'approbation ; l'admin approuve l'établissement
// SEUL (l'activité reste en attente), puis l'activité. Un seul chemin heureux de bout en bout : les
// gardes, le refus et le retrait en cascade sont prouvés par pgTAP
// (activites_etablissement_en_attente.test.sql). operador.propuestas : seul profil seedé avec une
// capacité operator ACTIVE (cf. partner-establishment-proposals.spec.ts).
test("un socio propone su establecimiento y una actividad en la misma sesión; el admin los aprueba por separado", async ({
  page,
  context,
}) => {
  const stamp = Date.now();
  const establishmentName = `Finca En Revisión ${stamp}`;
  const activityName = `Cabalgata Encadenada ${stamp}`;

  // --- Socio : l'établissement, puis « Añadir una actividad » depuis la confirmation ---
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto("/partner/establishment/new");
  await page.waitForLoadState("networkidle");
  await page.locator("#proposal-nombre").fill(establishmentName);
  await page.getByTestId("submit-establishment-proposal-button").click();
  await confirmAndContinue(page, "establishment-proposal-confirmation");

  await expect(page).toHaveURL(/\/partner\/products\/new\?establecimiento=[0-9a-f-]{36}$/);
  const establishmentProposalId = new URL(page.url()).searchParams.get("establecimiento")!;
  await page.waitForLoadState("networkidle");

  // L'établissement en revue est présélectionné, marqué comme tel.
  await expect(selectValue(page.getByTestId("establishment-select"))).toHaveText(
    `${establishmentName} (en revisión)`,
  );

  await page.locator('input[name="nombre"]').fill(activityName);
  await goToNextWizardStep(page);
  await goToNextWizardStep(page);
  await page.getByTestId("price-input").fill("40000");
  await page.getByTestId("submit-product-proposal-button").click();

  // « Añadir otra actividad » repart d'un formulaire vierge, même établissement présélectionné.
  await page.getByTestId("product-form-confirmation-secondary-action").click();
  await expect(page).toHaveURL(/nueva=\d+/);
  await page.waitForLoadState("networkidle");
  await expect(page.locator('input[name="nombre"]')).toHaveValue("");
  await expect(selectValue(page.getByTestId("establishment-select"))).toHaveText(
    `${establishmentName} (en revisión)`,
  );

  // L'activité s'affiche sous l'établissement en revue, en attente.
  await page.goto("/partner/establishment");
  const pendingStack = page.getByTestId(`pending-establishment-stack-${establishmentProposalId}`);
  await expect(pendingStack.getByTestId("pending-creation-banner")).toContainText(establishmentName);
  const pendingActivity = pendingStack.locator('[data-testid^="pending-product-creation-"]', {
    hasText: activityName,
  });
  await expect(pendingActivity).toContainText("Pendiente de revisión");

  // --- Admin : l'activité attend son établissement ---
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/proposals");
  const activityRow = page.locator('[data-testid^="proposal-row-"]', { hasText: activityName });
  await expect(activityRow).toContainText("Establecimiento en revisión");
  await activityRow.getByRole("link", { name: "Revisar" }).click();
  await expect(page).toHaveURL(/\/admin\/proposals\/[0-9a-f-]{36}$/);
  const activityProposalUrl = page.url();

  await expect(page.getByTestId("establishment-pending-notice")).toBeVisible();
  await expect(page.getByTestId("approve-button")).toBeDisabled();

  // --- L'établissement s'approuve SEUL ---
  await page.getByTestId("pending-establishment-link").click();
  await expect(page).toHaveURL(/\?entity=establishment$/);
  await expect(page.getByTestId("attached-activities")).toContainText(activityName);
  await page.getByTestId("approve-button").click();
  await expect(
    page.getByRole("alertdialog").filter({ hasText: "Propuesta aprobada — establecimiento creado." }),
  ).toBeVisible();

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: establishmentProposal } = await adminClient
    .from("establishment_proposals")
    .select("establishment_id")
    .eq("id", establishmentProposalId)
    .single();
  const { data: activityProposal } = await adminClient
    .from("product_proposals")
    .select("status, establishment_id")
    .eq("establishment_proposal_id", establishmentProposalId)
    .contains("payload", { name: { es: activityName } })
    .single();
  expect(activityProposal).toEqual({
    status: "pending",
    establishment_id: establishmentProposal!.establishment_id,
  });

  // --- Puis l'activité, séparément ---
  await page.goto(activityProposalUrl);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("establishment-pending-notice")).toHaveCount(0);
  await page.getByTestId("approve-button").click();
  await expect(page.getByRole("alertdialog").filter({ hasText: "Propuesta aprobada y publicada." })).toBeVisible();

  const { data: product } = await adminClient
    .from("products")
    .select("establishment_id")
    .eq("establishment_id", establishmentProposal!.establishment_id!)
    .contains("name", { es: activityName })
    .single();
  expect(product?.establishment_id).toBe(establishmentProposal!.establishment_id);
});
