import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { filaPorNombre } from "./support/filas";
import {
  confirmAndContinue,
  goToNextWizardStep,
  webProductUrl,
  mockMercadoPagoCheckout,
  nextMonthIsoDate,
} from "@hifago/e2e-support";
import { slugify } from "../lib/utils";

// Feature 20 (Admin : créer et réserver un camp multi-jours) — chemin admin-direct de bout en
// bout : création du camp, calendrier de la ressource partagée de l'établissement, calendrier de
// la capacité propre du camp, réservation réelle depuis le portail client, puis une seconde
// tentative sur une ressource désormais épuisée.
//
// 5 dates consécutives = jours 1 à 5 du mois SUIVANT le mois courant (jamais le mois courant
// lui-même, dont le nombre de jours restants dépend de la date d'exécution) — garantit que les 5
// jours sont dans le futur ET dans le MÊME mois affiché par FullCalendar après un seul clic sur
// "suivant", sans jamais chevaucher une frontière de mois.
// Mois suivant celui de GUATAPÉ depuis le lot fuseau (2026-08-28) : cette copie locale partait de
// `getUTCMonth()`, qui bascule au mois suivant dès 19 h heure locale le dernier jour du mois — le
// test visait alors un mois de plus que celui qu'un clic sur « suivant » affiche.
function nextMonthFirstFiveDates(): string[] {
  return Array.from({ length: 5 }, (_, i) => nextMonthIsoDate(i + 1));
}

async function goToNextMonth(page: import("@playwright/test").Page) {
  await page.waitForSelector(".fc");
  await page.locator(".fc-next-button").click();
}

async function setCalendarCapacity(page: import("@playwright/test").Page, date: string, capacity: string) {
  await page.locator(`.fc-daygrid-day[data-date="${date}"]`).click();
  await page.waitForSelector('[role="dialog"]');
  await page.locator('input[name="capacity"]').fill(capacity);
  await page.getByTestId("save-availability-button").click();
  await page.waitForSelector('[role="dialog"]', { state: "hidden" });
}

test("admin crée un camp, configure la ressource partagée et la capacité propre, réserve depuis le portal client, puis refuse sur ressource épuisée", async ({
  page,
  context,
}) => {
  const stamp = Date.now();
  const [day1, day2, day3, day4, day5] = nextMonthFirstFiveDates();

  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  // 1. Établissement dédié -------------------------------------------------------------------
  const establishmentName = `Establecimiento Camp E2E ${stamp}`;
  await page.goto("/admin/establishments/new");
  // Assistant par étapes (docs/specs/40) — étape 1 "Propietario y gestión" (partner), étape 2
  // "Detalles" (nombre).
  const partnerSearchCamp = page.getByTestId("partner-search");
  await partnerSearchCamp.click();
  await partnerSearchCamp.fill("Opérateur Actif");
  await page.getByRole("option", { name: /Opérateur Actif/ }).click();
  await goToNextWizardStep(page);
  await page.locator('input[name="nombre"]').fill(establishmentName);
  await page.getByTestId("create-establishment-button").click();
  await confirmAndContinue(page, "establishment-form-confirmation");
  await expect(page).toHaveURL(/\/admin\/establishments$/);

  const establishmentRow = filaPorNombre(page, establishmentName);
  // Spec 17 §0 Tranche 0 : "Recurso compartido" est désormais masqué tant que l'établissement ne
  // porte aucun camp/evento (isVisible côté EstablishmentsList) — inexistant à ce stade, avant la
  // création du camp ci-dessous. establishmentId extrait du lien "+ Actividad", toujours visible.
  const addActivityLink = establishmentRow.getByRole("link", { name: "+ Actividad" });
  const addActivityHref = await addActivityLink.getAttribute("href");
  if (!addActivityHref) throw new Error("href introuvable sur le lien + Actividad");
  const establishmentId = new URL(addActivityHref, page.url()).searchParams.get("establishment");
  if (!establishmentId) throw new Error("establishment introuvable dans le href + Actividad");

  // 2. Camp de 5 jours, rattaché à cet établissement ------------------------------------------
  await addActivityLink.click();
  await expect(page).toHaveURL(/\/admin\/products\/new\?establishment=/);
  // Spec 11 — ProductForm est nettement plus lourd à hydrater que l'ancien NewProductForm
  // (galerie/crop, éditeur de créneaux, autocomplete d'adresse) : sans cette attente, la toute
  // première interaction sur la page peut atteindre le DOM avant que React n'ait attaché ses
  // gestionnaires (valeur/submit perdus silencieusement, jamais reçus par le state React).
  await page.waitForLoadState("networkidle");

  const campName = `Campamento E2E ${stamp}`;
  await page.locator('input[name="nombre"]').fill(campName);
  await page.getByTestId("type-select").click();
  await page.getByRole("option", { name: "Campamento" }).click();

  // Assistant par étapes (docs/specs/40) — étape 1 validée, avance vers l'étape 2 "Detalles"
  // (duración + programa pour un campamento).
  await goToNextWizardStep(page);
  await page.getByTestId("duration-days-input").fill("5");

  // Étape 2 validée, avance vers l'étape 3 "Comercialización" (precio simple + cupo + descuento
  // por grupo pour ce type).
  await goToNextWizardStep(page);
  await page.locator('input[name="price"]').fill("500000");
  await page.getByTestId("create-product-button").click();
  await confirmAndContinue(page, "product-form-confirmation");
  await expect(page).toHaveURL(/\/admin\/establishments$/);

  await establishmentRow.getByRole("link", { name: /actividades/ }).click();
  await page.getByRole("link", { name: campName }).click();
  await expect(page).toHaveURL(/\/admin\/products\/.+\/edit$/);
  const productId = page.url().match(/\/admin\/products\/([^/]+)\/edit/)?.[1];
  if (!productId) throw new Error("productId introuvable dans l'URL d'édition");

  // sellable=true dès la création (retour Jérôme, 2026-08-20) : plus besoin de publier
  // explicitement avant que products_select_public l'expose à un visiteur anonyme plus bas.
  await expect(page.getByTestId("product-status-badge")).toHaveText("Vendible");

  // 3. Capacité PROPRE du camp (product_availability, feature 5, inchangée) — départ = jour 1,
  // capacité volontairement > 1 : ne doit jamais être la contrainte limitante de ce test, seule
  // la ressource PARTAGÉE doit l'être.
  await page.goto(`/admin/products/${productId}/availability`);
  await goToNextMonth(page);
  await setCalendarCapacity(page, day1, "3");

  // 4. Ressource PARTAGÉE de l'établissement (nouveau, feature 20) — capacité 1 sur chacun des 5
  // jours de la plage du camp : la première réservation l'épuise entièrement.
  await page.goto(`/admin/establishments/${establishmentId}/resource`);
  await goToNextMonth(page);
  for (const date of [day1, day2, day3, day4, day5]) {
    await setCalendarCapacity(page, date, "1");
  }

  // 5. Réservation réelle depuis le portail client (visiteur anonyme) -------------------------
  const slug = slugify(campName);
  await context.clearCookies();
  await page.goto(webProductUrl(slug));

  await page.locator(`[data-date="${day1}"]`).click();
  await expect(page.getByTestId("add-to-cart-button")).toBeEnabled();
  await page.getByTestId("add-to-cart-button").click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();
  await page.getByTestId("go-to-checkout-link").click();
  await expect(page).toHaveURL(/\/checkout$/);

  await page.locator('input[name="holder-name"]').fill(`Cliente Camp E2E ${stamp}`);
  await page.locator('input[name="holder-phone"]').fill("+57 300 000 0099");
  await page.locator('input[name="holder-email"]').fill(`cliente.camp.${stamp}@example.com`);
  // `redirectUrl` = le motif de l'écran de résultat (cf. `mockMercadoPagoCheckout`).
  const { redirectUrl } = await mockMercadoPagoCheckout(page);
  await page.getByTestId("submit-order-button").click();
  await page.waitForURL(redirectUrl);

  // 6. Seconde tentative sur une ressource désormais épuisée → refus clair -------------------
  // La capacité PROPRE du camp (3, dont 1 seul utilisé) resterait disponible côté calendrier
  // client — c'est bien la ressource PARTAGÉE (capacité 1, déjà épuisée) qui doit refuser la
  // commande, au niveau serveur (create_order), pas un blocage silencieux côté écran.
  await page.goto(webProductUrl(slug));
  await page.locator(`[data-date="${day1}"]`).click();
  await expect(page.getByTestId("add-to-cart-button")).toBeEnabled();
  await page.getByTestId("add-to-cart-button").click();
  await page.getByTestId("go-to-checkout-link").click();
  await expect(page).toHaveURL(/\/checkout$/);

  await page.locator('input[name="holder-name"]').fill(`Cliente Camp E2E Retry ${stamp}`);
  await page.locator('input[name="holder-phone"]').fill("+57 300 000 0098");
  await page.locator('input[name="holder-email"]').fill(`cliente.camp.retry.${stamp}@example.com`);
  await page.getByTestId("submit-order-button").click();

  await expect(page.getByTestId("checkout-error")).toBeVisible();
  await expect(page.getByTestId("checkout-error")).toContainText("disponibilidad compartida");
  // Spec 33 — l'équivalent de l'ancien « pas d'écran de succès » : une commande refusée ne fait
  // PAS quitter le tunnel. Assertion plus forte que la précédente, qui constatait l'absence d'un
  // testid et serait restée verte même si celui-ci disparaissait pour une autre raison — ce qui
  // vient précisément d'arriver.
  await expect(page).toHaveURL(/\/pago(\?|$)/);
});
