import path from "node:path";
import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { filaPorNombre } from "./support/filas";
import {
  checkboxInput,
  confirmAndContinue,
  createSignedInClient,
  goToNextWizardStep,
  toggleCheckbox,
  webProductUrl,
} from "@hifago/e2e-support";
import { slugify } from "../lib/utils";

// Spec 12 — active type='lodging' dans le même ProductForm que l'activité (spec 11) : nom/lieu/
// tramos/tags réutilisent le mécanisme existant (couvert par admin-product-create.spec.ts), ce
// test se concentre sur ce qui diverge (check-in/check-out/capacité, extras stay_rates) tout en
// exerçant le chemin complet création → édition, cf. CLAUDE.md §6.5.
const FIXTURE_PHOTO = path.join(__dirname, "fixtures/test-photo.jpg");

test("admin crée un alojamiento (check-in/check-out, capacidad, temporada/fin de semana), l'édite et vérifie la persistance", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  const establishmentName = `Establecimiento E2E Alojamiento ${Date.now()}`;
  await page.goto("/admin/establishments/new");
  // Assistant par étapes (docs/specs/40) — étape 1 "Propietario y gestión" (partner), étape 2
  // "Detalles" (nombre).
  const partnerSearch = page.getByTestId("partner-search");
  await partnerSearch.click();
  await partnerSearch.fill("Opérateur Actif");
  await page.getByRole("option", { name: /Opérateur Actif/ }).click();
  await goToNextWizardStep(page);
  await page.locator('input[name="nombre"]').fill(establishmentName);
  // WhatsApp du prestataire, obligatoire depuis 20261019170000.
  await page.getByTestId("establishment-whatsapp-input").fill("3001234567");
  await page.getByTestId("create-establishment-button").click();
  await confirmAndContinue(page, "establishment-form-confirmation");
  await expect(page).toHaveURL(/\/admin\/establishments$/);

  const row = filaPorNombre(page, establishmentName);
  await row.getByRole("link", { name: "+ Actividad" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/new\?establishment=/);
  // Même piège d'hydratation que ProductForm pour une activité (CLAUDE.md §11.8) — le composant
  // est partagé, le risque est identique.
  await page.waitForLoadState("networkidle");

  await page.getByTestId("type-select").click();
  await page.getByRole("option", { name: "Alojamiento" }).click();

  const suffix = Date.now();
  const nameEs = `Casa Guatapé ES ${suffix}`;
  await page.locator('input[name="nombre"]').fill(nameEs);

  // Assistant par étapes (docs/specs/40) — étape 1 validée, avance vers l'étape 2 "Detalles"
  // (lieu, foto, datos del alojamiento).
  await goToNextWizardStep(page);

  // Lieu (réutilisation du parcours activité, gating étendu par cette spec) — opcional.
  await page.getByTestId("address-input").fill("Vía Guatapé - El Peñol, Guatapé");
  await page.getByTestId("lat-input").fill("6.2280");
  await page.getByTestId("lon-input").fill("-75.1590");

  // Foto (opcional, même staging que l'activité).
  const gallery = page.getByTestId("media-gallery");
  await gallery.getByTestId("media-gallery-add").locator("input[type=file]").setInputFiles(FIXTURE_PHOTO);
  await expect(page.getByTestId("image-crop-stage")).toBeVisible();
  await page.getByTestId("image-crop-confirm").click();
  await expect(gallery.getByTestId("media-gallery-item")).toHaveCount(1, { timeout: 10000 });

  // Check-in/check-out + capacidad (nouveau, spec 12) — "Datos del alojamiento", étape 2.
  await page.getByTestId("check-in-input").fill("15:00");
  await page.getByTestId("check-out-input").fill("11:00");
  await page.getByTestId("capacity-input").fill("8");

  // Étape 2 validée, avance vers l'étape 3 "Comercialización".
  await goToNextWizardStep(page);

  // Precio por tramos de huéspedes + bornes (mécanisme réutilisé tel quel, spec 12 §3).
  await page.getByTestId("price-mode-toggle").click();
  await page.getByTestId("price-tier-min-0").fill("1");
  await page.getByTestId("price-tier-max-0").fill("6");
  await page.getByTestId("price-tier-price-0").fill("350000");
  await page.getByTestId("min-qty-input").fill("2");
  await page.getByTestId("max-qty-input").fill("6");

  // Extras stay_rates (spec 12) — temporada alta + recargo fin de semana + depósito. `includes`
  // (« Incluye ») retiré le 2026-09-17, supersedé par les équipements structurés (cf. stayRates.ts).
  await toggleCheckbox(page.getByTestId("stay-rates-month-12"));
  await page.getByTestId("stay-rates-season-surcharge-input").fill("20");
  await page.getByTestId("stay-rates-weekend-surcharge-input").fill("10");
  await page.getByTestId("stay-rates-deposit-input").fill("200000");

  await page.getByTestId("create-product-button").click();
  await confirmAndContinue(page, "product-form-confirmation");
  await expect(page).toHaveURL(/\/admin\/establishments$/);
  await expect(row).toContainText("1 actividades");

  // sellable=true à la création (retour Jérôme, 2026-08-20) — même garde-fou que pour une activité.
  await context.clearCookies();
  const slug = slugify(nameEs);
  const publicResponse = await page.goto(webProductUrl(slug));
  expect(publicResponse?.status()).toBe(200);

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: created } = await adminClient.from("products").select("id").eq("slug", slug).single();
  if (!created) throw new Error("e2e: alojamiento introuvable après création");
  const productId = created.id as string;

  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/products/${productId}/edit`);
  await expect(page.getByRole("heading", { name: "Editar alojamiento" })).toBeVisible();

  // Contrairement aux créneaux d'activité (table enfant, bloc édition séparé), check-in/check-out/
  // capacidad/stay_rates sont de simples colonnes products : préremplies directement dans
  // ProductForm, aucun bloc séparé à ouvrir.
  await expect(page.locator('input[name="nombre"]')).toHaveValue(nameEs);
  await expect(page.getByTestId("address-input")).toHaveValue("Vía Guatapé - El Peñol, Guatapé");
  await expect(page.getByTestId("price-tiers-editor")).toBeVisible();
  await expect(page.getByTestId("price-tier-price-0")).toHaveValue("350000");
  await expect(page.getByTestId("min-qty-input")).toHaveValue("2");
  await expect(page.getByTestId("check-in-input")).toHaveValue("15:00");
  await expect(page.getByTestId("check-out-input")).toHaveValue("11:00");
  await expect(page.getByTestId("capacity-input")).toHaveValue("8");
  await expect(checkboxInput(page.getByTestId("stay-rates-month-12"))).toBeChecked();
  await expect(page.getByTestId("stay-rates-season-surcharge-input")).toHaveValue("20");
  await expect(page.getByTestId("stay-rates-weekend-surcharge-input")).toHaveValue("10");
  await expect(page.getByTestId("stay-rates-deposit-input")).toHaveValue("200000");

  // Édite directement dans le même submit (pas de bouton de sauvegarde séparé pour ces champs).
  await page.getByTestId("capacity-input").fill("10");
  await page.getByTestId("stay-rates-weekend-surcharge-input").fill("15");
  await page.getByTestId("save-product-button").click();
  await confirmAndContinue(page, "product-form-confirmation");
  await expect(page).toHaveURL(/\/admin\/establishments\/[0-9a-f-]{36}$/);

  await page.goto(`/admin/products/${productId}/edit`);
  await expect(page.getByTestId("capacity-input")).toHaveValue("10");
  await expect(page.getByTestId("stay-rates-weekend-surcharge-input")).toHaveValue("15");
});
