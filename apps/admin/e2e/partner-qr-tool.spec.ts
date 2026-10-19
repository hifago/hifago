import { readFile, stat } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import {
  resetAvailability,
  getPrice,
  setPartnerCodeActive,
  WEB_APP_URL,
  ADMIN_APP_URL,
  webReferralUrl,
  mockMercadoPagoCheckout,
  seedDate,
} from "@hifago/e2e-support";
import { formatCop } from "@hifago/domain";

// Feature 18 (Socio : obtenir son lien/QR de vente attribué) — première boucle e2e de bout en
// bout AVEC un vrai lien généré par l'écran /partner/tools (pas un ?ref=<code> construit à la
// main dans le test, contrairement à e2e/attribution.spec.ts qui reste le précédent pour la partie
// "réservation invité via ?ref="). Le socio "referent.actif" (SEEDED_ACCOUNTS.referentActif) est le
// compte recommandé : un seul code actif seedé, SEED-REFACTIVE (cf. supabase/seed.sql), partenaire
// distinct du propriétaire de tour-lancha-guatape → commission_case='external_referrer' (10/7) une
// fois la commande créée (cf. create_order, supabase/migrations/20260814180000_*.sql).
const PRODUCT_ID = "b0000000-0000-4000-8000-000000000001"; // tour-lancha-guatape
const DATE = seedDate(20); // date dédiée à ce spec (cf. supabase/seed.sql), disjointe de toutes
// les dates 2026-09-05/07/10/12/13/14/15 déjà utilisées par les autres specs du panier.

test("un socio génère son lien/QR réel sur /partner/tools, un visiteur anonyme réserve via ce lien, la commande apparaît sur /partner/commissions", async ({
  page,
  context,
  browser,
}) => {
  await resetAvailability(PRODUCT_ID, DATE, { capacity: 10, booked: 0 });
  // e2e/admin-partner-registry.spec.ts fait volontairement BASCULER l'état actif de ce même code
  // partagé (jamais remis à zéro entre deux runs, cf. commentaire dédié dans ce spec) — remis à un
  // état actif connu ici pour que ce test reste déterministe quel que soit l'ordre d'exécution.
  await setPartnerCodeActive("SEED-REFACTIVE", true);

  // Permissions presse-papier accordées explicitement (Chromium seul projet configuré, cf.
  // playwright.config.ts) — localhost est un contexte "sécurisé" pour l'API Clipboard même en
  // http, mais la permission navigateur reste nécessaire pour readText()/writeText() sans geste
  // utilisateur simulé par du vrai JS (le clic Playwright suffit pour writeText, readText exige la
  // permission accordée ici pour la vérification côté test). Origine = apps/admin (ADMIN_APP_URL,
  // où /partner/tools vit réellement depuis la scission monorepo web/admin) — la copie s'exécute
  // sur cette page-là, pas sur apps/web (BASE_URL).
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ADMIN_APP_URL });

  // 1. Le socio se connecte et ouvre /partner/tools.
  await loginAs(context, SEEDED_ACCOUNTS.referentActif, SEEDED_PASSWORD);
  await page.goto("/partner/tools");

  const codeEntry = page.getByTestId("partner-code-entry");
  await expect(codeEntry).toBeVisible();

  // 2. Le code s'affiche, se copie (presse-papier vérifié), le lien attribué aussi.
  const codeValue = await codeEntry.getByTestId("partner-code-value").inputValue();
  expect(codeValue).toBe("SEED-REFACTIVE"); // cf. supabase/seed.sql — seul code actif de ce socio.

  await codeEntry.getByTestId("copy-code-button").click();
  await expect(codeEntry.getByTestId("copy-code-button")).toHaveText("Copiado ✓");
  const clipboardAfterCode = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardAfterCode).toBe(codeValue);

  const linkValue = await codeEntry.getByTestId("partner-link-value").inputValue();
  expect(linkValue).toBe(webReferralUrl(codeValue)); // structure confirmée par l'agent impl.

  await codeEntry.getByTestId("copy-link-button").click();
  await expect(codeEntry.getByTestId("copy-link-button")).toHaveText("Copiado ✓");
  const clipboardAfterLink = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardAfterLink).toBe(linkValue);

  // 3. Téléchargement du QR en SVG et en PNG — fichiers non vides, suffixe cohérent.
  const [svgDownload] = await Promise.all([
    page.waitForEvent("download"),
    codeEntry.getByTestId("download-svg-button").click(),
  ]);
  expect(svgDownload.suggestedFilename()).toBe(`hifago-${codeValue}.svg`);
  const svgPath = await svgDownload.path();
  expect(svgPath).not.toBeNull();
  const svgStat = await stat(svgPath as string);
  expect(svgStat.size).toBeGreaterThan(0);
  const svgContent = await readFile(svgPath as string, "utf-8");
  expect(svgContent).toContain("<svg");

  const [pngDownload] = await Promise.all([
    page.waitForEvent("download"),
    codeEntry.getByTestId("download-png-button").click(),
  ]);
  expect(pngDownload.suggestedFilename()).toBe(`hifago-${codeValue}.png`);
  const pngPath = await pngDownload.path();
  expect(pngPath).not.toBeNull();
  const pngStat = await stat(pngPath as string);
  expect(pngStat.size).toBeGreaterThan(0);

  // 4. Le lien attribué RÉEL affiché à l'écran (linkValue, capturé ci-dessus) sert de point de
  // départ au visiteur — jamais une valeur reconstruite à la main.

  // 5. Nouveau contexte de navigateur (visiteur anonyme, aucun cookie de session du socio).
  const visitorContext = await browser.newContext();
  const visitorPage = await visitorContext.newPage();

  await visitorPage.goto(linkValue);
  // Le Route Handler /[locale]/r/[code] redirige en 302 vers /[locale]?ref=<code> (code actif) —
  // atterrissage confirmé sur l'accueil, avec le paramètre d'attribution capturé par proxy.ts.
  await expect(visitorPage).toHaveURL(`${WEB_APP_URL}/es?ref=${codeValue}`);
  await expect(visitorPage.getByTestId("tarjeta-tour-lancha-guatape-link")).toBeVisible();

  // 6. Le visiteur réserve un produit en tant qu'invité (parcours établi par e2e/reserve.spec.ts /
  // e2e/attribution.spec.ts : catalogue → fiche produit → panier → checkout, guest checkout).
  await visitorPage.getByTestId("tarjeta-tour-lancha-guatape-link").click();
  await expect(visitorPage.getByTestId("product-name")).toBeVisible();

  await visitorPage.locator(`[data-date="${DATE}"]`).click();
  await visitorPage.getByTestId("add-to-cart-button").click();
  await expect(visitorPage.getByTestId("added-to-cart")).toBeVisible();

  await visitorPage.getByTestId("go-to-checkout-link").click();
  await expect(visitorPage).toHaveURL(/\/es\/checkout/);

  const price = await getPrice(PRODUCT_ID);

  await visitorPage.locator('input[name="holder-name"]').fill("Cliente E2E QR Tool");
  await visitorPage.locator('input[name="holder-phone"]').fill("+57 300 111 9090");
  await visitorPage.locator('input[name="holder-email"]').fill("cliente.qrtool@example.com");
  // `redirectUrl` = le motif de l'écran de résultat (cf. `mockMercadoPagoCheckout`).
  const { redirectUrl } = await mockMercadoPagoCheckout(visitorPage);
  await visitorPage.getByTestId("submit-order-button").click();
  await visitorPage.waitForURL(redirectUrl);

  await visitorContext.close();

  // 7. Retour sur le contexte du socio (session déjà ouverte) : la commande créée par le visiteur
  // apparaît sur /partner/commissions — preuve par l'UI que referrer_partner_id a bien été attribué
  // via la route de redirect + la capture ?ref= existante de proxy.ts.
  await page.goto("/partner/commissions");

  const commissionRow = page.locator("tr", { hasText: DATE });
  await expect(commissionRow).toBeVisible();
  await expect(commissionRow).toContainText("Estimada"); // commande fraîchement créée, statut 'reserved'.

  // external_referrer (8/9 depuis le 2026-10-19, cf. create_order) : referrer_commission_cop =
  // round(total_cop * 0.08), total_cop = price_cop * qty(1). Jamais un montant figé en dur (base
  // locale partagée).
  const expectedCommission = Math.round(price * 0.08);
  await expect(commissionRow.getByTestId(/^referrer-commission-/)).toHaveText(formatCop(expectedCommission));
});
