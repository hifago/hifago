import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Les écrans socio qui affichent UNE fiche par son id ne s'ouvrent que sur les fiches de
// l'organisation connectée (2026-10-01, apps/admin/lib/partnerOwnership.ts). Les policies publiques
// laissent pourtant lire toute fiche en vente et tout établissement actif : sans le filtre posé par
// la page, un socio ouvrait l'écran d'édition d'une fiche d'un autre partenaire.
//
// Lecture seule : les deux organisations viennent du seed (supabase/seed.sql) — `operador.propuestas`
// (organisation b…0003) face à la fiche en vente b…0001 et à l'établissement actif b…0002 de
// l'organisation d'`operateur.actif`.
const PRODUIT_D_AUTRUI = "b0000000-0000-4000-8000-000000000001";
const ETABLISSEMENT_D_AUTRUI = "b0000000-0000-4000-8000-000000000002";
const PRODUIT_A_SOI = "b0000000-0000-4000-8000-000000000006";
const ETABLISSEMENT_A_SOI = "b0000000-0000-4000-8000-000000000004";

test("un socio n'ouvre que les fiches de son organisation, jamais celles d'un autre partenaire", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);

  for (const chemin of [
    `/partner/products/${PRODUIT_D_AUTRUI}/edit`,
    `/partner/products/${PRODUIT_D_AUTRUI}/availability`,
    `/partner/establishment/${ETABLISSEMENT_D_AUTRUI}/edit`,
  ]) {
    const reponse = await page.goto(chemin);
    expect(reponse?.status(), chemin).toBe(404);
    await expect(page.getByTestId("not-found-admin")).toBeVisible();
  }

  for (const chemin of [
    `/partner/products/${PRODUIT_A_SOI}/edit`,
    `/partner/products/${PRODUIT_A_SOI}/availability`,
    `/partner/establishment/${ETABLISSEMENT_A_SOI}/edit`,
  ]) {
    const reponse = await page.goto(chemin);
    expect(reponse?.status(), chemin).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("not-found-admin")).toHaveCount(0);
  }
});
