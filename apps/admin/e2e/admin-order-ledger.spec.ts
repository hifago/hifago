import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { formatCop } from "@hifago/domain";

// Feature 12 (Admin : consulter le ledger d'une commande) — "Cliente Ledger Seed"
// (supabase/seed.sql) porte 3 lignes sur le même produit/référent externe (Prestador Propuestas
// Org) : une fulfilled (commission « A pagar »), une cancelled_by_client (compensation A3 « A
// pagar » à l'établissement) et une fulfilled déjà réglée (« Pagada »). Commande DÉDIÉE, pas
// "Cliente Referido Seed" (feature 9) — cf. commentaire dans seed.sql. Révisé le 2026-11-12
// (20261112200000) : l'état se LIT dans le ledger (avant : « Ganado »/« Redistribuido » déduits du
// statut de la ligne, jamais « Pagada »).
test("admin ouvre une commande depuis la liste, voit la ventilation par ligne et l'état réel du ledger", async ({
  page,
}) => {
  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/orders");
  // Liste client-heavy : sans ça, le clic sur « Ver pedido » arrive avant l'hydratation et le
  // <Link> reste inerte, sans erreur (constaté le 2026-11-13, 2 runs sur 2 — .claude/rules/tests.md).
  await page.waitForLoadState("networkidle");

  const seedRow = page.locator("tr", { hasText: "Cliente Ledger Seed" }).first();
  await expect(seedRow).toBeVisible();
  await seedRow.getByRole("link", { name: "Ver pedido" }).click();
  await expect(page).toHaveURL(/\/admin\/orders\/.+/);

  await expect(page.getByTestId("order-meta")).toContainText("Prestador Propuestas Org");

  const ledgerTable = page.getByTestId("ledger-table");
  await expect(ledgerTable).toBeVisible();

  const zero = formatCop(0);
  const referrerShare = formatCop(8000);
  const providerEarned = formatCop(66400); // 80000 (total) - 13600 (acompte)
  const providerRedistributed = formatCop(74400); // 66400 (part structurelle) + 8000 (compensation)

  // Ligne fulfilled (2026-10-03) → commission « A pagar » : due au référent, pas encore payée.
  const fulfilledRow = ledgerTable.locator("tr", { hasText: "2026-10-03" });
  await expect(fulfilledRow).toBeVisible();
  await expect(fulfilledRow.getByTestId(/^ledger-state-/)).toHaveText("A pagar");
  await expect(fulfilledRow.getByTestId(/^referrer-due-/)).toHaveText(referrerShare);
  await expect(fulfilledRow.getByTestId(/^provider-due-/)).toHaveText(providerEarned);

  // Ligne cancelled_by_client (2026-10-04), acompte payé → compensation A3 : la part référent
  // tombe à 0 et part à l'établissement — le montant de la compensation RÉELLE du ledger.
  const cancelledRow = ledgerTable.locator("tr", { hasText: "2026-10-04" });
  await expect(cancelledRow).toBeVisible();
  await expect(cancelledRow.getByTestId(/^ledger-state-/)).toHaveText("Compensación · A pagar");
  await expect(cancelledRow.getByTestId(/^referrer-due-/)).toHaveText(zero);
  await expect(cancelledRow.getByTestId(/^provider-due-/)).toHaveText(providerRedistributed);

  // Ligne fulfilled déjà réglée (2026-10-05) → « Pagada », que l'ancienne dérivation ne pouvait
  // jamais afficher.
  const paidRow = ledgerTable.locator("tr", { hasText: "2026-10-05" });
  await expect(paidRow.getByTestId(/^ledger-state-/)).toHaveText("Pagada");
});
