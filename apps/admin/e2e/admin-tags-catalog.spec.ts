import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { filaPorNombre } from "./support/filas";
import { createSignedInClient } from "@hifago/e2e-support";
import { abrirFiltros } from "./support/filtros";

// docs/specs/10-listes-standardisees-admin-socio.md (lot 4) — Eliminar retiré de la liste
// (décision Jérôme), reste uniquement sur la fiche /admin/tags/[id].
// Revue admin étiquettes (Jérôme, 2026-08-20) — "Ver" pointe désormais vers le catalogue filtré
// par le tag (2e test ci-dessous), plus vers la fiche détail : l'action "Detalle" (testid
// tag-detail-link-<id>) est désormais le chemin explicite vers Eliminar (1er essai, corrigé,
// laissait la fiche atteignable uniquement via le lien "furtif" de la ligne — invisible, donc
// Eliminar de facto injoignable). Le filtre "Etiqueta" du catalogue lui-même (utilisable
// indépendamment de /admin/tags) est couvert dans admin-products-list.spec.ts, même famille que le
// filtre "Establecimiento".
test("admin crée une etiqueta, l'assigne à une activité, puis la supprime depuis sa fiche — retirée de l'activité aussi", async ({
  page,
  context,
}) => {
  const suffix = Date.now();
  const slug = `tags-delete-${suffix}`;
  const tagLabel = `Etiqueta E2E ${suffix}`;
  const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000004";
  const PARTNER_ID = "b0000000-0000-4000-8000-000000000003";

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: product, error: productError } = await adminClient
    .from("products")
    .insert({
      partner_id: PARTNER_ID,
      establishment_id: ESTABLISHMENT_ID,
      type: "activity",
      name: { es: `Actividad Etiqueta Eliminada ${suffix}` },
      price_cop: 50000,
      sellable: true,
      slug,
    })
    .select("id")
    .single();
  if (productError || !product) {
    throw new Error(`e2e setup: création du produit a échoué : ${productError?.message}`);
  }

  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/tags");

  await page.getByTestId("new-tag-input").fill(tagLabel);
  await page.getByTestId("create-tag-button").click();

  const row = filaPorNombre(page, tagLabel);
  await expect(row).toBeVisible();
  await expect(row).toContainText("0");
  await expect(row.getByText("Eliminar")).toHaveCount(0);

  const { data: tag } = await adminClient
    .from("catalog_tags")
    .select("id")
    .eq("label->>es", tagLabel)
    .single();
  if (!tag) {
    throw new Error("e2e setup: tag introuvable après création via l'UI");
  }
  const { error: assignError } = await adminClient
    .from("product_tag_assignments")
    .insert({ product_id: product.id, tag_id: tag.id });
  if (assignError) {
    throw new Error(`e2e setup: assignation du tag a échoué : ${assignError.message}`);
  }
  await page.reload();

  await page.getByTestId(`tag-detail-link-${tag.id}`).click();
  await expect(page.getByTestId("tag-detail-label")).toHaveText(tagLabel);

  // ⚠️ L'ATTENTE EST AVANT LE PREMIER CLIC, et elle y a été DÉPLACÉE le 2026-09-08. Elle existait
  // déjà, avec le bon diagnostic écrit à côté — mais placée après le clic qui ouvre le dialogue,
  // donc elle ne protégeait que le second. Le premier passait tant que cette page s'hydratait
  // vite ; la spec 29 Tranche 3 y a ajouté `CategoriaEditorialBlock`, qui tire `MediaGallery` et
  // `ImageCrop`, et le clic s'est mis à atteindre un bouton encore sans gestionnaire — visuellement
  // actionnable, sans effet, aucune erreur. C'est le piège nommé dans `.claude/rules/tests.md`
  // (« écran client-heavy après une navigation client-side »), et il ne se corrige pas en allégeant
  // l'écran : il se corrige en attendant l'hydratation AVANT d'interagir.
  await page.waitForLoadState("networkidle");

  // Avertissement explicite avant suppression (DeleteTagButton.tsx) : preuve que l'admin est
  // informé de l'impact avant de confirmer, pas seulement que la cascade DB fonctionne à l'aveugle.
  await page.getByTestId(`delete-tag-${tag.id}`).click();
  await expect(page.getByRole("dialog")).toContainText("retirada de 1 actividad");

  await page.getByTestId(`confirm-delete-tag-${tag.id}`).click();

  await expect(page).toHaveURL(/\/admin\/tags$/);
  await expect(filaPorNombre(page, tagLabel)).toHaveCount(0);

  // Preuve directe (pas seulement l'absence du tag dans la liste) : la cascade a bien retiré
  // l'assignation product_tag_assignments, pas seulement la ligne catalog_tags elle-même.
  const { data: remainingAssignments } = await adminClient
    .from("product_tag_assignments")
    .select("tag_id")
    .eq("product_id", product.id);
  expect(remainingAssignments).toEqual([]);
});

test("admin ouvre /admin/tags, presse Ver sur un tag, atterrit sur le catálogo filtré avec les activités taggées", async ({
  page,
  context,
}) => {
  const suffix = Date.now();
  const slug = `tags-view-catalog-${suffix}`;
  const tagLabel = `Etiqueta Ver Catalogo ${suffix}`;
  const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000004";
  const PARTNER_ID = "b0000000-0000-4000-8000-000000000003";

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: product, error: productError } = await adminClient
    .from("products")
    .insert({
      partner_id: PARTNER_ID,
      establishment_id: ESTABLISHMENT_ID,
      type: "activity",
      name: { es: `Actividad Ver Catalogo ${suffix}` },
      price_cop: 50000,
      sellable: true,
      slug,
    })
    .select("id")
    .single();
  if (productError || !product) {
    throw new Error(`e2e setup: création du produit a échoué : ${productError?.message}`);
  }

  const { data: tag, error: tagError } = await adminClient
    .from("catalog_tags")
    .insert({ label: { es: tagLabel }, slug: `${slug}-tag` })
    .select("id")
    .single();
  if (tagError || !tag) {
    throw new Error(`e2e setup: création du tag a échoué : ${tagError?.message}`);
  }

  const { error: assignError } = await adminClient
    .from("product_tag_assignments")
    .insert({ product_id: product.id, tag_id: tag.id });
  if (assignError) {
    throw new Error(`e2e setup: assignation du tag a échoué : ${assignError.message}`);
  }

  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/tags");
  // Scopé par un filtre (même précaution que pour établissements/clientes/partenaires) : plusieurs
  // sessions concurrentes créent des tags sur cette instance locale de longue durée, le tag ciblé
  // peut être au-delà de la page 1 sans le filtre.
  // Filtres repliés par défaut (chevron) depuis la refonte responsive mobile — ouvrir avant d'y
  // interagir, sinon les champs sont `hidden` (Disclosure, packages/ui/data-list.tsx).
  await abrirFiltros(page);
  await page.getByTestId("filter-q").fill(tagLabel);
  await page.getByTestId("server-filters-submit").click();

  await page.getByTestId(`tag-catalog-link-${tag.id}`).click();

  await expect(page).toHaveURL(new RegExp(`/admin/products\\?tag_id=${tag.id}`));
  await expect(page.locator('[data-testid^="product-row-"]')).toHaveCount(1);
  // Édition en ligne (2026-10-13) : le nom est la valeur d'un champ, plus un texte de la ligne.
  await expect(page.getByTestId(`edit-name-${product.id}`)).toHaveValue(
    `Actividad Ver Catalogo ${suffix}`,
  );
});
