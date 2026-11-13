import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createSignedInClient, switchInput, toggleSwitch } from "@hifago/e2e-support";

// 20261112180000 — fiche partenaire : un code de plus (un QR par hôtel d'un même groupe) et l'option
// « reverser les 17 % » de l'auto-recomendación. Chemin heureux seulement : les refus (code pris,
// trop long, non-admin) et le calcul sont prouvés en base (partner_commission_settings.test.sql,
// create_order.test.sql cas 16c/16g).
test("admin ajoute un code à un partenaire et lui active la comisión de auto-recomendación à 17 %", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  // Partenaire DÉDIÉ, horodaté (retiré par le teardown global avec ses codes ; l'option part avec
  // lui, on delete cascade).
  const stamp = Date.now();
  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: created, error: createError } = await adminClient.rpc("create_partner_direct", {
    p_display_name: `Partner E2E Comision ${stamp}`,
    p_roles: ["referrer"],
    p_code: `E2E-HOTEL-A-${stamp}`,
    p_send_invitation: false,
  });
  expect(createError).toBeNull();
  const partnerId = (created as { partner_id: string }).partner_id;

  await page.goto(`/admin/partners/${partnerId}`);
  await page.waitForLoadState("networkidle");

  // Un deuxième code, pour le même partenaire.
  const secondCode = `E2E-HOTEL-B-${stamp}`;
  await page.getByTestId("new-code-input").fill(secondCode);
  await page.getByTestId("add-code-button").click();
  await expect(page.getByTestId(`code-row-${secondCode}`)).toBeVisible();
  await expect(page.getByTestId(`code-row-E2E-HOTEL-A-${stamp}`)).toBeVisible();
  const { data: codeRow } = await adminClient
    .from("partner_codes")
    .select("partner_id, active")
    .eq("code", secondCode)
    .single();
  expect(codeRow).toEqual({ partner_id: partnerId, active: true });

  // L'option : décochée par défaut (8 %), cochée → 17 %, lue côté serveur après chaque geste.
  const rebateSwitch = page.getByTestId("self-referral-full-rebate-switch");
  await expect(switchInput(rebateSwitch)).not.toBeChecked();
  await toggleSwitch(rebateSwitch);
  await expect(switchInput(rebateSwitch)).toBeChecked();
  await expect
    .poll(async () => {
      const { data } = await adminClient
        .from("partner_self_referral_rebates")
        .select("partner_id")
        .eq("partner_id", partnerId);
      return data?.length ?? 0;
    })
    .toBe(1);

  await toggleSwitch(rebateSwitch);
  await expect(switchInput(rebateSwitch)).not.toBeChecked();
  await expect
    .poll(async () => {
      const { data } = await adminClient
        .from("partner_self_referral_rebates")
        .select("partner_id")
        .eq("partner_id", partnerId);
      return data?.length ?? 0;
    })
    .toBe(0);
});
