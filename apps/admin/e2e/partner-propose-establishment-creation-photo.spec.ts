import path from "node:path";
import { test, expect } from "@playwright/test";
import { createSignedInClient } from "@hifago/e2e-support";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

const FIXTURE_PHOTO = path.join(__dirname, "fixtures/test-photo.jpg");

// Retour Jérôme (2026-08-19, refonte vue prestataire) : "Proponer un nuevo establecimiento" n'avait
// jusqu'ici aucun champ photo, contrairement à "Proponer una nueva ficha" (produit,
// partner-propose-product-creation.spec.ts) — incohérence entre les deux formulaires établissement
// (création vs édition, cette dernière ayant déjà PhotosSocioBlock). Comblé par la migration
// 20260819200000_establishment_creation_proposal_photos.sql, même patron que côté produit.
//
// Identité DÉDIÉE fraîchement invitée (pas operadorPropuestas, seedé et déjà utilisé par
// partner-establishment-proposals.spec.ts pour SES PROPRES propositions kind='create' pending —
// le plafond "1 proposition de création pending par partenaire" collisionnerait sinon si ce fichier
// tourne en parallèle de celui-là, cf. AGENTS-PARALLELES.md §5) : même chemin que
// admin-invitations.spec.ts ("Prestador consumido sin establecimiento"), un partenaire tout juste
// invité n'a par construction aucune proposition en attente.
test("un socio propone la creación de un establecimiento avec foto, rattachée après approbation", async ({
  page,
  context,
}) => {
  const stamp = Date.now();
  const code = `E2E-ESTAB-PHOTO-${stamp}`;
  const proposedName = `Hostal Con Foto E2E ${stamp}`;

  // --- Admin : crée l'invitation Prestador ---
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/invitations/new");
  await page.locator('input[name="code"]').fill(code);
  await page.getByTestId("onboarding-path-select").click();
  await page.getByRole("option", { name: "Prestador" }).click();
  await page.getByTestId("create-invitation-button").click();
  const link = await page.getByTestId("invitation-link").inputValue();
  const token = new URL(link).searchParams.get("token");
  expect(token).toBeTruthy();

  // --- Visiteur : rejoint via le jeton, identité fraîche sans établissement ni proposition ---
  await context.clearCookies();
  await page.goto(`/partner/join?token=${token}`);
  await page.locator('input[name="name"]').fill(`Prestador Foto E2E ${stamp}`);
  await page.locator('input[name="email"]').fill(`estab-photo-e2e-${stamp}@test.local`);
  await page.locator('input[name="password"]').fill("EstabPhoto1234!");
  await page.getByTestId("consent-checkbox").click();
  await page.getByTestId("join-submit-button").click();
  await page.waitForURL("**/partner");
  // Vérifie au passage le nouveau message d'état vide simplifié (refonte vue prestataire) — un seul
  // CTA, plus l'ancienne double carte "Tus roles"/"Crear producto".
  await expect(page.getByTestId("partner-establishment-pending")).toBeVisible();

  // --- Socio : propone la création avec une photo ---
  await page.goto("/partner/establishment/new");
  await page.locator("#proposal-nombre").fill(proposedName);

  const gallery = page.getByTestId("media-gallery");
  await gallery.getByTestId("media-gallery-add").locator("input[type=file]").setInputFiles(FIXTURE_PHOTO);
  await expect(page.getByTestId("image-crop-stage")).toBeVisible();
  await page.getByTestId("image-crop-confirm").click();
  await expect(gallery.getByTestId("media-gallery-item")).toHaveCount(1, { timeout: 10000 });

  await page.getByTestId("submit-establishment-proposal-button").click();
  // Écran de confirmation plein écran (docs/specs/40 §4) — remplace le formulaire, son bouton
  // d'action déclenche la redirection auparavant immédiate.
  // Action secondaire : l'action principale enchaîne désormais sur « Añadir una actividad »
  // (20261019120000) ; ce parcours-ci revient à la liste.
  await page.getByTestId("establishment-proposal-confirmation-secondary-action").click();
  await expect(page).toHaveURL(/\/partner\/establishment$/);

  const pendingCard = page.getByTestId("pending-creation-banner");
  await expect(pendingCard).toBeVisible();
  await expect(pendingCard).toContainText(proposedName);
  // "Sin fotos" est le texte affiché par CatalogCard quand photos.length === 0 (catalog-card.tsx) —
  // son absence prouve que la photo proposée est bien rendue dans le carrousel de la carte.
  await expect(pendingCard).not.toContainText("Sin fotos");

  // --- Admin : la proposition apparaît avec un aperçu lecture seule de la photo ---
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/proposals");

  const row = page.locator('[data-testid^="proposal-row-"]', { hasText: proposedName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Creación");
  await row.getByRole("link", { name: "Revisar" }).click();

  await expect(page).toHaveURL(/\/admin\/proposals\/.+\?entity=establishment/);
  const proposalId = new URL(page.url()).pathname.split("/").pop();
  await expect(page.locator('input[name="nombre"]')).toHaveValue(proposedName);
  await expect(page.getByTestId("proposed-photos")).toBeVisible();
  await expect(page.getByTestId("proposed-photo-0")).toBeVisible();

  await page.getByTestId("approve-button").click();
  await expect(
    page.getByRole("alertdialog").filter({ hasText: "Propuesta aprobada — establecimiento creado." }),
  ).toBeVisible();

  // --- La fiche existe désormais réellement, avec sa photo rattachée en base — vérification
  // directe en base plutôt que via /admin/establishments (autre session active dessus en ce
  // moment, cf. curseur CLAUDE.md) : même style de vérification que
  // partner-propose-product-creation.spec.ts (product_media). establishment_id backfillé par
  // moderate_establishment_proposal à l'approbation, lu ici depuis la proposition elle-même
  // (id connu via l'URL de la fiche de modération) plutôt qu'une requête sur name (jsonb).
  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: approvedProposal } = await adminClient
    .from("establishment_proposals")
    .select("establishment_id")
    .eq("id", proposalId!)
    .single();
  const establishmentId = approvedProposal?.establishment_id;
  expect(establishmentId).toBeTruthy();

  const { data: media, error: mediaError } = await adminClient
    .from("establishment_media")
    .select("storage_path")
    .eq("establishment_id", establishmentId!);
  if (mediaError) throw new Error(`e2e verify: lecture establishment_media a échoué : ${mediaError.message}`);
  expect(media).toHaveLength(1);

  // --- Le socio voit désormais son établissement publié, photo visible (plus "Sin fotos") ---
  await loginAs(context, `estab-photo-e2e-${stamp}@test.local`, "EstabPhoto1234!");
  await page.goto("/partner/establishment");
  await expect(page.getByTestId("establishment-list")).toContainText(proposedName);
  const publishedCard = page.getByTestId(`establishment-row-${establishmentId}`);
  await expect(publishedCard).not.toContainText("Sin fotos");
});
