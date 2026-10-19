import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createSignedInClient } from "@hifago/e2e-support";

// Fiche admin d'un socio : identité, contact et réseaux modifiés sur place (« Editar »,
// admin_update_partner_profile, 20261019160000). Chemin heureux seul — les refus et l'audit sont
// prouvés par supabase/tests/database/admin_update_partner_profile.test.sql, le calcul des
// changements par lib/partners/partnerProfile.test.ts.
test("admin modifie l'identité, le contact et les réseaux d'un socio", async ({ page, context }) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  // Partenaire DÉDIÉ (horodaté, nom retiré par le teardown), créé par la RPC : ce test ne porte
  // pas sur la création (admin-partner-create.spec.ts).
  const stamp = Date.now();
  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data, error } = await adminClient.rpc("create_partner_direct", {
    p_display_name: `Partner E2E Ficha ${stamp}`,
    p_roles: ["referrer"],
    p_email: `ficha-${stamp}@test.local`,
    p_phone: "+573000000000",
    p_send_invitation: false,
  });
  expect(error).toBeNull();
  const partnerId = (data as { partner_id: string }).partner_id;

  await page.goto(`/admin/partners/${partnerId}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("partner-identity-edit-button").click();

  await page.getByTestId("partner-edit-display_name-input").fill(`Partner E2E Ficha Nueva ${stamp}`);
  await page.getByTestId("partner-edit-email-input").fill(`nuevo-${stamp}@test.local`);
  await page.getByTestId("partner-edit-phone-input").fill("");
  await page.getByTestId("partner-edit-partner_city-input").fill("El Peñol");
  await page.getByTestId("partner-edit-instagram-input").fill("@ficha.e2e");
  await page.getByTestId("partner-edit-tags-input").fill("kayak, lago");
  await page.getByTestId("partner-identity-save-button").click();

  // Relu depuis le serveur (router.refresh), pas l'état local du formulaire.
  await expect(page.getByTestId("partner-identity-edit-button")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Partner E2E Ficha Nueva ${stamp}`);
  await expect(page.getByTestId("partner-email")).toHaveText(`nuevo-${stamp}@test.local`);
  await expect(page.getByTestId("partner-phone")).toHaveText("—");
  await expect(page.getByTestId("partner-city")).toHaveText("El Peñol");
  await expect(page.getByTestId("partner-instagram").getByRole("link")).toHaveAttribute(
    "href",
    "https://instagram.com/ficha.e2e",
  );
  await expect(page.getByTestId("partner-tags")).toHaveText("kayak, lago");

  const { data: stored } = await adminClient
    .from("partners")
    .select("display_name, email, phone, partner_city, instagram")
    .eq("id", partnerId)
    .single();
  expect(stored).toEqual({
    display_name: `Partner E2E Ficha Nueva ${stamp}`,
    email: `nuevo-${stamp}@test.local`,
    phone: null,
    partner_city: "El Peñol",
    instagram: "@ficha.e2e",
  });
});
