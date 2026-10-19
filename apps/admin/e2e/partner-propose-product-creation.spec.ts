import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  confirmAndContinue,
  createSignedInClient,
  createActiveOperatorEstablishment,
  goToNextWizardStep,
} from "@hifago/e2e-support";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

const FIXTURE_PHOTO = path.join(__dirname, "fixtures/test-photo.jpg");

// docs/specs/15-socio-creation-produit.md — un socio (capacité operator active) propose la
// création d'une nouvelle fiche produit, jamais une écriture directe (même invariant que
// establishment_proposals, cf. partner-establishment-proposals.spec.ts). Chemin heureux pour un
// seul type (activity, celui explicitement demandé) : la matrice des 6 types est couverte par
// pgTAP (product_creation_proposal.test.sql), pas ici — CLAUDE.md §6, "1 e2e chemin heureux, pas
// une matrice de cas". Photo incluse dès la proposition (révision Jérôme, 2026-08-17) : le socio
// uploade via le même Route Handler que l'admin-direct (StagedProductPhotos), storage_path
// transporté dans le payload, rattaché à product_media à l'approbation — vérifié ici de bout en
// bout (aperçu lecture seule côté modération admin, puis réellement en base après approbation).
// operador.propuestas (seed.sql) est le seul profil seedé avec une capacité operator ACTIVE —
// mais JAMAIS son établissement seedé partagé "Establecimiento Propuestas E2E" (b0000000-...-0004)
// sélectionné par NOM affiché : une autre session/spec le renomme en testant sa propre édition
// (constaté en écrivant ce test — déjà "Hostal Editado <ts>" au moment d'écrire ceci, cf.
// AGENTS-PARALLELES.md point 5 / CLAUDE.md §11.7). Établissement DÉDIÉ créé ici, même chemin que
// partner-establishment-proposals.spec.ts (2e test) : create_establishment + set_capability_status
// plutôt qu'un insert brut, pour rester fidèle au parcours réel.
test("un socio propone la creación de una actividad con foto, publicada y vendible tras aprobación admin", async ({
  page,
  context,
}) => {
  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const establishmentName = `Establecimiento Dedicado Producto ${Date.now()}`;
  const establishmentId = await createActiveOperatorEstablishment(
    adminClient,
    "b0000000-0000-4000-8000-000000000003",
    establishmentName,
  );

  const proposedName = `Actividad Propuesta E2E ${Date.now()}`;

  // --- Socio : propone, foto incluida, jamás publicado directamente ---
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto("/partner/products/new");
  // Même piège d'hydratation que ProductForm côté admin (CLAUDE.md §11.8) — composant partagé,
  // même risque.
  await page.waitForLoadState("networkidle");

  await page.getByTestId("establishment-select").click();
  await page.getByRole("option", { name: establishmentName }).click();

  await page.locator('input[name="nombre"]').fill(proposedName);

  // Assistant par étapes (docs/specs/40) — étape 1 validée, avance vers l'étape 2 "Detalles"
  // (fotos pour una actividad).
  await goToNextWizardStep(page);

  const gallery = page.getByTestId("media-gallery");
  await gallery.getByTestId("media-gallery-add").locator("input[type=file]").setInputFiles(FIXTURE_PHOTO);
  await expect(page.getByTestId("image-crop-stage")).toBeVisible();
  await page.getByTestId("image-crop-confirm").click();
  await expect(gallery.getByTestId("media-gallery-item")).toHaveCount(1, { timeout: 10000 });

  // Étape 2 validée, avance vers l'étape 3 "Comercialización" (precio).
  await goToNextWizardStep(page);
  await page.getByTestId("price-input").fill("50000");

  await page.getByTestId("submit-product-proposal-button").click();
  await confirmAndContinue(page, "product-form-confirmation");

  // Refonte vue prestataire (2026-08-19) : "Mis actividades" fusionnée dans
  // "/partner/establishment" (product-form.tsx pousse désormais directement vers cette URL) ;
  // PendingProductCreationsList disparaît en tant que section séparée — la proposition apparaît
  // comme une carte normale (testid pending-product-creation-<id>, id inconnu ici) dans la grille
  // d'activités de l'établissement, avec le tag "Pendiente de revisión" (demande explicite de
  // Jérôme : jamais une liste séparée, juste un tag bien évident sur la carte).
  await expect(page).toHaveURL(/\/partner\/establishment$/);
  const pendingCard = page.locator('[data-testid^="pending-product-creation-"]', { hasText: proposedName });
  await expect(pendingCard).toBeVisible();
  await expect(pendingCard).toContainText("Pendiente de revisión");
  await expect(pendingCard).toContainText("Actividad");

  // --- Admin : la proposition apparaît marquée "Creación", formulaire pré-rempli, foto visible en aperçu ---
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/proposals");

  const row = page.locator('[data-testid^="proposal-row-"]', { hasText: proposedName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Creación");
  await row.getByRole("link", { name: "Revisar" }).click();

  await expect(page).toHaveURL(/\/admin\/proposals\/[0-9a-f-]{36}$/);
  await expect(page.locator('input[name="nombre"]')).toHaveValue(proposedName);
  await expect(page.getByTestId("price-input")).toHaveValue("50000");
  // Aperçu lecture seule — jamais de bloc d'édition/upload dans cet écran (le formulaire de
  // modération n'édite jamais les photos, cf. migration 20260817140000).
  await expect(page.getByTestId("proposed-photos")).toBeVisible();
  await expect(page.getByTestId("proposed-photo-0")).toBeVisible();

  await page.getByTestId("approve-button").click();
  // Le succès n'est plus un texte inline mais un toast (docs/specs/16-notifications-toast.md) —
  // HeroUI rend chaque toast avec role="alertdialog", le message passé à toast.success(...)
  // devient son titre visible.
  await expect(page.getByRole("alertdialog").filter({ hasText: "Propuesta aprobada y publicada." })).toBeVisible();

  // --- La fiche existe désormais réellement, vendable (revirement 2026-08-20, publication
  // immédiate à l'approbation), avec sa photo rattachée en base ---
  await page.goto(`/admin/establishments/${establishmentId}`);
  await expect(page.getByText(proposedName)).toBeVisible();

  const { data: createdProduct } = await adminClient
    .from("products")
    .select("id")
    .eq("establishment_id", establishmentId)
    .single();
  const { data: media, error: mediaError } = await adminClient
    .from("product_media")
    .select("storage_path")
    .eq("product_id", createdProduct!.id);
  if (mediaError) throw new Error(`e2e verify: lecture product_media a échoué : ${mediaError.message}`);
  expect(media).toHaveLength(1);

  // --- Le socio ne voit plus CETTE proposition en attente, la fiche apparaît "Publicada" ---
  // Assertion scopée au nom précis de cette proposition, jamais un simple toHaveCount(0) global :
  // la base locale n'est pas remise à zéro entre deux exécutions e2e (même remarque que
  // partner-establishment-proposals.spec.ts, 3e test) — une proposition non liée, encore pending
  // d'un run antérieur (ex. interrompu), ne doit pas faire échouer CE test.
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto("/partner/establishment");
  // Scopé au texte plutôt qu'un .not.toContainText() sur un conteneur dédié (EstablishmentActivities
  // ne rend plus de conteneur séparé pour les propositions en attente, fusionnées dans la grille
  // normale, cf. commentaire plus haut) : la carte "pending-product-creation-*" portant ce nom
  // précis ne doit simplement plus exister une fois approuvée.
  await expect(
    page.locator('[data-testid^="pending-product-creation-"]', { hasText: proposedName }),
  ).toHaveCount(0);
  const publishedRow = page.locator('[data-testid^="product-row-"]', { hasText: proposedName });
  await expect(publishedRow).toBeVisible();
  await expect(publishedRow).toContainText("Publicada");
});
