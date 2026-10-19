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
import { formatCop } from "@hifago/domain";
import { slugify } from "../lib/utils";

// Spec 11 — fusionne l'ancien admin-product-create.spec.ts (chemin heureux de création) et
// admin-product-edit.spec.ts (édition, supprimé) : le parcours de création et d'édition partage
// maintenant le même composant (ProductForm), un seul test bout-en-bout couvre les deux — cf.
// CLAUDE.md §6.5 (un seul E2E chemin heureux pour un CRUD, pas une matrice par variante).
const FIXTURE_PHOTO = path.join(__dirname, "fixtures/test-photo.jpg");

test("admin crée une actividad avec tous les champs (i18n, lieu, foto, tramos, horarios), l'édite et vérifie la persistance", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  // Établissement dédié à ce test (garantit un départ à 0 activité) — un établissement partagé
  // avec un autre test pourrait déjà en avoir. Réutilise le flux feature 1, déjà prouvé.
  const establishmentName = `Establecimiento E2E Producto ${Date.now()}`;
  await page.goto("/admin/establishments/new");
  // Assistant par étapes (docs/specs/40) — étape 1 "Propietario y gestión" (partner), étape 2
  // "Detalles" (nombre) : l'ordre s'inverse par rapport à l'ancien formulaire plat.
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
  await expect(row).toContainText("0 actividades");

  await row.getByRole("link", { name: "+ Actividad" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/new\?establishment=/);
  // ProductForm est nettement plus lourd à hydrater que l'ancien NewProductForm (galerie/crop,
  // éditeur de créneaux, autocomplete d'adresse) — sans cette attente, la toute première frappe
  // sur la page peut atteindre le DOM avant que React n'ait attaché ses gestionnaires, et se perd
  // silencieusement (valeur visible dans le DOM brut, jamais reçue par le state React).
  await page.waitForLoadState("networkidle");

  const suffix = Date.now();
  const nameEs = `Actividad Jetski ES ${suffix}`;
  const nameEn = `Jetski Activity EN ${suffix}`;

  // Nom i18n (spec 11) — ES actif par défaut, bascule vers EN sans perdre la valeur ES déjà
  // saisie (stockée en state, pas seulement affichée). Chaque assertion intermédiaire attend que
  // React ait bien commité l'état avant l'action suivante (le composant est contrôlé — un simple
  // enchaînement d'actions sans vérification peut dépasser une frappe avant son rendu).
  const nombreInput = page.locator('input[name="nombre"]');
  await nombreInput.fill(nameEs);
  await expect(nombreInput).toHaveValue(nameEs);
  await page.getByTestId("name-lang-en").click();
  await expect(nombreInput).toHaveValue("");
  await nombreInput.fill(nameEn);
  await expect(nombreInput).toHaveValue(nameEn);

  // Descripción i18n (spec 11) — même bascule, optionnelle.
  const descriptionTextarea = page.getByTestId("description-textarea");
  await page.getByTestId("description-lang-es").click();
  await descriptionTextarea.fill("Descripción en español.");
  await expect(descriptionTextarea).toHaveValue("Descripción en español.");
  await page.getByTestId("description-lang-en").click();
  await expect(descriptionTextarea).toHaveValue("");
  await descriptionTextarea.fill("English description.");
  await expect(descriptionTextarea).toHaveValue("English description.");

  // Assistant par étapes (docs/specs/40) — étape 1 "Establecimiento y tipo" validée, avance vers
  // l'étape 2 "Detalles".
  await goToNextWizardStep(page);

  // Lieu (spec 11) — opcional, saisie manuelle (pas de clé Google Maps en environnement de test).
  await page.getByTestId("address-input").fill("Muelle Turístico, Guatapé");
  await page.getByTestId("lat-input").fill("6.2318");
  await page.getByTestId("lon-input").fill("-75.1614");

  // Foto (spec 11) — opcional, disponible dès la création (upload immédiat, rattachement différé
  // au submit).
  const gallery = page.getByTestId("media-gallery");
  await gallery.getByTestId("media-gallery-add").locator("input[type=file]").setInputFiles(FIXTURE_PHOTO);
  await expect(page.getByTestId("image-crop-stage")).toBeVisible();
  await page.getByTestId("image-crop-confirm").click();
  await expect(gallery.getByTestId("media-gallery-item")).toHaveCount(1, { timeout: 10000 });

  // Étape 2 validée, avance vers l'étape 3 "Comercialización".
  await goToNextWizardStep(page);

  // Precio por tramos + bornes de cantidad (flujo existente, spec 08 — non modifié par spec 11).
  await page.getByTestId("price-mode-toggle").click();
  await page.getByTestId("price-tier-min-0").fill("1");
  await page.getByTestId("price-tier-max-0").fill("4");
  await page.getByTestId("price-tier-price-0").fill("40000");
  await page.getByTestId("min-qty-input").fill("1");
  await page.getByTestId("max-qty-input").fill("4");

  // Horarios (spec 11) — créneaux de 1h, 10h-21h, lundi à samedi (exemple jetski de Jérôme).
  await page.getByTestId("add-slot-rule-button").click();
  for (const weekday of [1, 2, 3, 4, 5, 6]) {
    await toggleCheckbox(page.getByTestId(`slot-rule-weekday-${weekday}-0`));
  }
  await page.getByTestId("slot-rule-start-0").fill("10:00");
  await page.getByTestId("slot-rule-end-0").fill("21:00");
  await page.getByTestId("slot-rule-duration-0").fill("60");
  await page.getByTestId("slot-rule-capacity-0").fill("4");
  await expect(page.getByTestId("slot-rule-preview-0")).toContainText("10:00–11:00");

  await page.getByTestId("create-product-button").click();
  await confirmAndContinue(page, "product-form-confirmation");
  await expect(page).toHaveURL(/\/admin\/establishments$/);
  await expect(row).toContainText("1 actividades");

  // sellable=true à la création (retour Jérôme, 2026-08-20 : product-form.tsx n'écrase plus le
  // défaut colonne — même principe que create_establishment) : la fiche publique doit l'exposer
  // tout de suite, sans geste de publication séparé. Session admin effacée avant cette vérification
  // (RLS products_select_public autorise aussi is_admin(), sinon faux positif).
  await context.clearCookies();
  const slug = slugify(nameEs);
  const publicResponse = await page.goto(webProductUrl(slug));
  expect(publicResponse?.status()).toBe(200);

  // Récupère l'id créé pour naviguer directement vers l'édition — plus robuste qu'un clic-through
  // par la liste établissement.
  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: created } = await adminClient.from("products").select("id").eq("slug", slug).single();
  if (!created) throw new Error("e2e: produit introuvable après création");
  const productId = created.id as string;

  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/products/${productId}/edit`);

  // Le même composant ProductForm (spec 11) pré-remplit tout ce qui a été saisi à la création.
  await expect(page.locator('input[name="nombre"]')).toHaveValue(nameEs);
  await page.getByTestId("name-lang-en").click();
  await expect(page.locator('input[name="nombre"]')).toHaveValue(nameEn);

  await expect(page.getByTestId("description-textarea")).toHaveValue("Descripción en español.");
  await page.getByTestId("description-lang-en").click();
  await expect(page.getByTestId("description-textarea")).toHaveValue("English description.");

  await expect(page.getByTestId("address-input")).toHaveValue("Muelle Turístico, Guatapé");
  await expect(page.getByTestId("lat-input")).toHaveValue("6.2318");

  await expect(page.getByTestId("media-gallery").getByTestId("media-gallery-item")).toHaveCount(1);

  await expect(page.getByTestId("price-tiers-editor")).toBeVisible();
  await expect(page.getByTestId("price-tier-price-0")).toHaveValue("40000");
  await expect(page.getByTestId("min-qty-input")).toHaveValue("1");

  await expect(checkboxInput(page.getByTestId("slot-rule-weekday-1-0"))).toBeChecked();
  await expect(page.getByTestId("slot-rule-start-0")).toHaveValue("10:00");
  await expect(page.getByTestId("slot-rule-preview-0")).toContainText("10:00–11:00");

  // Modifie le prix — retour au prix simple (hors tramos) pour prouver que ce chemin d'édition
  // fonctionne aussi — puis vérifie l'affichage formaté sur la fiche établissement (reprend
  // l'assertion utile de l'ancien admin-product-edit.spec.ts, supprimé).
  await page.getByTestId("price-mode-toggle").click();
  const newPrice = 90000 + (Date.now() % 1000);
  await page.locator('input[name="price"]').fill(String(newPrice));
  await page.getByTestId("save-product-button").click();
  await confirmAndContinue(page, "product-form-confirmation");
  await expect(page).toHaveURL(/\/admin\/establishments\/[0-9a-f-]{36}$/);

  // Le format de l'écran (formatCop), jamais recopié ici.
  const formattedPrice = formatCop(newPrice);
  await expect(page.getByText(formattedPrice)).toBeVisible();

  // Modifie une règle de créneau depuis le bloc édition dédié (spec 11, ProductSlotRulesBlock) —
  // sauvegarde immédiate, indépendante du submit principal de ProductForm.
  await page.goto(`/admin/products/${productId}/edit`);
  await page.getByTestId("slot-rule-capacity-0").fill("6");
  await page.getByTestId("save-slot-rules-button").click();
  await expect(page.getByRole("alertdialog").filter({ hasText: "Horarios guardados." })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("slot-rule-capacity-0")).toHaveValue("6");
});
