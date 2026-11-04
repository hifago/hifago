import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createActiveOperatorEstablishment, createSignedInClient } from "@hifago/e2e-support";

// Horaires d'une activité proposés en édition par le partenaire (demande Jérôme du 2026-11-04,
// migration 20261104120000) — de bout en bout : le partenaire change un horaire depuis « Proponer
// edición », l'admin approuve, la fiche porte le nouvel horaire. Les variantes (horaires inchangés,
// tous retirés, règle illisible, passage « por hora ») sont prouvées par
// EditProposalForm.test.tsx, ModerateProposalForm.test.tsx et proposal_edit_slot_rules.test.sql.

// Partenaire de operador.propuestas@hifago.test (supabase/seed.sql).
const PARTNER_ID = "b0000000-0000-4000-8000-000000000003";

test("un socio change l'horaire de son activité, l'admin approuve, la fiche porte le nouvel horaire", async ({
  page,
  context,
}) => {
  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const suffix = Date.now();
  const establishmentId = await createActiveOperatorEstablishment(
    adminClient,
    PARTNER_ID,
    `Establecimiento Horarios ${suffix}`,
  );
  const productName = `Kayak Horarios E2E ${suffix}`;
  const { data: product, error: productError } = await adminClient
    .from("products")
    .insert({
      partner_id: PARTNER_ID,
      establishment_id: establishmentId,
      type: "activity",
      name: { es: productName },
      price_cop: 50000,
      slug: `kayak-horarios-e2e-${suffix}`,
    })
    .select("id")
    .single();
  if (productError || !product) throw new Error(`e2e setup: produit : ${productError?.message}`);
  const { error: rulesError } = await adminClient.rpc("replace_product_slot_rules", {
    p_product_id: product.id,
    p_rules: [{ weekdays: [1], start_time: "09:00", end_time: "12:00", slot_duration_minutes: 60, capacity: 4 }],
  });
  if (rulesError) throw new Error(`e2e setup: horaires : ${rulesError.message}`);

  // --- Partenaire : propose une capacité de 6 au lieu de 4 ---
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto(`/partner/products/${product.id}/edit`);
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("slot-rule-start-0")).toHaveValue("09:00");
  await page.getByTestId("slot-rule-capacity-0").fill("6");
  await page.getByTestId("submit-proposal-button").click();
  await expect(page.getByTestId("pending-proposal")).toBeVisible();

  // Rien n'est écrit avant l'approbation.
  const before = await adminClient.from("product_slot_rules").select("capacity").eq("product_id", product.id);
  expect(before.data).toEqual([{ capacity: 4 }]);

  // --- Admin : voit l'horaire en place et celui proposé, approuve ---
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/proposals");
  const row = page.locator('[data-testid^="proposal-row-"]', { hasText: productName });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "Revisar" }).click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("current-slot-rules")).toContainText("cupo 4");
  await expect(page.getByTestId("slot-rule-capacity-0")).toHaveValue("6");
  await page.getByTestId("approve-button").click();
  await expect(page.getByRole("alertdialog").filter({ hasText: "Propuesta aprobada." })).toBeVisible();

  // --- La fiche porte le nouvel horaire ---
  const after = await adminClient
    .from("product_slot_rules")
    .select("weekdays, start_time, end_time, slot_duration_minutes, capacity")
    .eq("product_id", product.id);
  expect(after.data).toEqual([
    { weekdays: [1], start_time: "09:00:00", end_time: "12:00:00", slot_duration_minutes: 60, capacity: 6 },
  ]);
});
