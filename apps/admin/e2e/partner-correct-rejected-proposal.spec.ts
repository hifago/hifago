import { test, expect } from "@playwright/test";
import { confirmAndContinue, createSignedInClient } from "@hifago/e2e-support";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Migration 20261104130000 (demande Jérôme, 2026-11-04) — une proposition refusée se CORRIGE :
// le partenaire la retrouve avec le motif, rouvre le formulaire prérempli, ne change que ce qui
// n'allait pas, et la même proposition revient en revue. Un seul chemin heureux de bout en bout ;
// les gardes, le réveil des activités refusées en cascade et « Descartar » sont prouvés par pgTAP
// (proposition_refusee_corrigeable.test.sql) et par EstablishmentActivities.test.tsx.
test("un establecimiento rechazado se corrige sin volver a empezar y vuelve a revisión", async ({
  page,
  context,
}) => {
  const stamp = Date.now();
  const wrongName = `Finca Mal Nombrada ${stamp}`;
  const fixedName = `Finca Bien Nombrada ${stamp}`;
  const address = `Calle ${stamp} # 1-2, Guatapé`;

  // --- Socio : propose l'établissement ---
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto("/partner/establishment/new");
  await page.waitForLoadState("networkidle");
  await page.locator("#proposal-nombre").fill(wrongName);
  await page.getByTestId("proposal-whatsapp-input").fill("3001234567");
  await page.getByTestId("proposal-address-input").fill(address);
  await page.getByTestId("submit-establishment-proposal-button").click();
  await confirmAndContinue(page, "establishment-proposal-confirmation");
  await expect(page).toHaveURL(/\/partner\/products\/new\?establecimiento=[0-9a-f-]{36}$/);
  const proposalId = new URL(page.url()).searchParams.get("establecimiento")!;

  // --- Admin : refuse, avec un motif ---
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/proposals/${proposalId}?entity=establishment`);
  await page.waitForLoadState("networkidle");
  await page.locator("#rejection-reason").fill("El nombre no es el de la finca");
  await page.getByTestId("reject-button").click();
  await expect(page.getByRole("alertdialog").filter({ hasText: "Propuesta rechazada." })).toBeVisible();

  // --- Socio : la proposition refusée est toujours là, avec son motif ---
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto("/partner/establishment");
  const stack = page.getByTestId(`pending-establishment-stack-${proposalId}`);
  await expect(stack.getByTestId("pending-creation-banner")).toContainText("Rechazada");
  await expect(stack.getByTestId(`rejection-reason-${proposalId}`)).toContainText("El nombre no es el de la finca");

  // « Corregir » : le formulaire repart de ce qui avait été envoyé.
  await stack.getByTestId(`correct-establishment-proposal-${proposalId}`).click();
  await expect(page).toHaveURL(new RegExp(`/partner/establishment/new\\?corregir=${proposalId}$`));
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("rejection-notice-reason")).toHaveText("El nombre no es el de la finca");
  await expect(page.locator("#proposal-nombre")).toHaveValue(wrongName);
  await expect(page.getByTestId("proposal-whatsapp-input")).toHaveValue("3001234567");
  await expect(page.getByTestId("proposal-address-input")).toHaveValue(address);

  // Seul le nom change.
  await page.locator("#proposal-nombre").fill(fixedName);
  await page.getByTestId("submit-establishment-proposal-button").click();
  await expect(page.getByTestId("establishment-proposal-confirmation")).toContainText("Propuesta corregida enviada");

  // La MÊME proposition revient en revue, corrigée, le reste intact.
  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: proposal } = await adminClient
    .from("establishment_proposals")
    .select("status, payload, rejection_reason")
    .eq("id", proposalId)
    .single();
  expect(proposal?.status).toBe("pending");
  expect(proposal?.rejection_reason).toBe("El nombre no es el de la finca");
  expect(proposal?.payload).toMatchObject({
    name: { es: fixedName },
    address,
    contact_phone: "+573001234567",
  });

  // --- Admin : la correction est signalée, avec le motif du refus précédent ---
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/proposals/${proposalId}?entity=establishment`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("resubmitted-notice")).toContainText("El nombre no es el de la finca");
  await expect(page.getByTestId("reject-button")).toBeEnabled();
});
