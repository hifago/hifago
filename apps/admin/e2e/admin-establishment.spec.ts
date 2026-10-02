import path from "node:path";
import { test, expect } from "@playwright/test";
import { confirmAndContinue, goToNextWizardStep, toggleCheckbox } from "@hifago/e2e-support";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { abrirFiltros } from "./support/filtros";

const FIXTURE_PHOTO = path.join(__dirname, "fixtures/test-photo.jpg");

// Authentification programmatique (cf. support/login.ts) : ni ce test ni la garde qu'il prouve ne
// portent sur le formulaire de connexion lui-même (déjà couvert par login.spec.ts).

test("un compte non-admin est renvoyé de /admin vers sa propre page (garde du layout)", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.referentActif, SEEDED_PASSWORD);

  await page.goto("/admin/establishments");

  // Jamais /login (2026-10-01) : un compte déjà connecté y était renvoyé vers /admin, en boucle.
  // La garde passe par l'aiguillage `/`, qui envoie ce référent pur sur ses commissions.
  await expect(page).toHaveURL(/\/partner\/commissions$/);
});

test("un compte admin crée un établissement (identité, partner, présentation) et le voit dans la liste", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  // Nom unique par run : la base locale n'est pas remise à zéro entre deux exécutions de ce test
  // — un nom fixe casserait getByText en mode strict dès la deuxième exécution locale.
  const establishmentName = `Hostal E2E ${Date.now()}`;

  await page.goto("/admin/establishments/new");

  // Assistant par étapes (docs/specs/40) — étape 1 "Propietario y gestión" (partner + case
  // "Operado directamente"), étape 2 "Detalles" (nombre, descripción, dirección, fotos).
  await toggleCheckbox(page.getByTestId("operated-directly-checkbox"));

  // SearchableCombobox : champ de recherche réel (pas un Select à bouton) — taper une requête
  // avant de sélectionner (comme le ferait un admin réel), pas un clic à l'aveugle sur le premier
  // résultat d'une liste non filtrée.
  const partnerSearch = page.getByTestId("partner-search");
  await partnerSearch.click();
  await partnerSearch.fill("Opérateur Actif");
  await page.getByRole("option", { name: /Opérateur Actif/ }).click();
  await expect(partnerSearch).toHaveValue(/Opérateur Actif/);

  await goToNextWizardStep(page);
  await page.locator('input[name="nombre"]').fill(establishmentName);

  // Description bilingue — switcher ES/EN au-dessus d'un seul champ visible à la fois.
  await page.getByTestId("description-textarea").fill("Descripción en español.");
  await page.getByTestId("description-lang-en").click();
  await expect(page.getByTestId("description-textarea")).toHaveValue("");
  await page.getByTestId("description-textarea").fill("Description in English.");
  await page.getByTestId("description-lang-es").click();
  await expect(page.getByTestId("description-textarea")).toHaveValue("Descripción en español.");

  // Adresse : champ texte direct, pas le widget Google (no-op en local sans clé API — même
  // précédent que admin-partner-create.spec.ts).
  await page.getByTestId("address-input").fill("Calle Falsa 123, Guatapé");

  // Photo — pipeline crop + Route Handler (spec 04 §7) : sélectionner une photo ouvre le recadrage,
  // confirmer l'upload avant que la miniature apparaisse (plus un upload direct sans recadrage).
  await page.getByTestId("photos-input").setInputFiles(FIXTURE_PHOTO);
  await expect(page.getByTestId("image-crop-stage")).toBeVisible();
  await page.getByTestId("image-crop-confirm").click();
  await expect(page.getByTestId("photos-list").locator("li")).toHaveCount(1, { timeout: 10000 });

  await page.getByTestId("create-establishment-button").click();
  await confirmAndContinue(page, "establishment-form-confirmation");

  await expect(page).toHaveURL(/\/admin\/establishments$/);
  await expect(page.getByText(establishmentName)).toBeVisible();
});

test("la recherche partenaire filtre réellement le registre", async ({ page, context }) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  await page.goto("/admin/establishments/new");

  const search = page.getByTestId("partner-search");
  await search.click();
  await search.fill("Opérateur Actif");

  await expect(page.getByRole("option", { name: /Opérateur Actif/ })).toBeVisible();
  // "Prestador Propuestas Org" (autre partenaire seedé) ne doit pas apparaître pour cette requête.
  await expect(page.getByRole("option", { name: /Prestador Propuestas/ })).toHaveCount(0);

  await page.getByRole("option", { name: /Opérateur Actif/ }).click();
  await expect(search).toHaveValue(/Opérateur Actif/);
});

test("la recherche unifiée de la liste établissements trouve un établissement par le nom de son partenaire", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  await page.goto("/admin/establishments");

  // L'établissement de "Prestador Propuestas Org" (seed.sql, id b0000000-…-000000000004) est
  // aussi la cible fixe de admin-establishment-edit.spec.ts, qui renomme son nom affiché
  // (`Hostal Editado ${Date.now()}`) — jamais sélectionner un enregistrement seedé PARTAGÉ par son
  // nom affiché (AGENTS-PARALLELES.md §5, déjà arrivé). On cherche donc par le nom du PARTENAIRE
  // (jamais touché par cet autre spec) et on vérifie la ligne par testid stable (l'id, pas le nom) :
  // preuve que list_establishments_admin cherche bien sur les deux colonnes (un .or() PostgREST ne
  // le permettait pas, cf. migration 20260819190000), sans dépendre d'un nom mutable par ailleurs.
  // Filtres repliés par défaut (chevron) depuis la refonte responsive mobile — ouvrir avant d'y
  // interagir, sinon les champs sont `hidden` (Disclosure, packages/ui/data-list.tsx).
  await abrirFiltros(page);
  await page.getByTestId("filter-q").fill("Prestador Propuestas");
  await page.getByTestId("server-filters-submit").click();

  const row = page.getByTestId("establishment-row-b0000000-0000-4000-8000-000000000004");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Prestador Propuestas Org");
});
