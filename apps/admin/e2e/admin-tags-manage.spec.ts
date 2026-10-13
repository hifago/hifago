import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createSignedInClient } from "@hifago/e2e-support";

// Produit et étiquettes dédiés à ce test (jamais un produit ou un tag seedé partagé), posés sur le
// premier établissement venu : la base locale ne porte pas toujours le seed (mockData). Les slugs
// portent l'horodatage : le teardown global (packages/e2e-support/src/cleanup.ts) retire ce qui
// resterait.

// Renommer et supprimer une étiquette là où elle se choisit (demande Jérôme, 2026-10-13) : depuis
// le sélecteur d'une fiche, puis depuis la cellule « Etiquetas » du catálogo — sans /admin/tags.
test("admin renomme puis supprime une étiquette depuis le sélecteur d'une fiche et depuis le catálogo", async ({
  page,
  context,
}) => {
  const suffix = Date.now();
  const slug = `tags-manage-${suffix}`;
  const labelA = `Etiqueta Gestion A ${suffix}`;
  const renamedA = `Etiqueta Gestion A2 ${suffix}`;
  const labelB = `Etiqueta Gestion B ${suffix}`;
  const renamedB = `Etiqueta Gestion B2 ${suffix}`;

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: establishment } = await adminClient
    .from("establishments")
    .select("id, partner_id")
    .order("created_at")
    .limit(1)
    .single();
  if (!establishment) throw new Error("e2e setup: aucun établissement en base locale");

  const { data: product, error: insertError } = await adminClient
    .from("products")
    .insert({
      partner_id: establishment.partner_id,
      establishment_id: establishment.id,
      type: "activity",
      name: { es: `Actividad Gestion Tags ${suffix}` },
      price_cop: 50000,
      sellable: false,
      slug,
    })
    .select("id")
    .single();
  if (insertError || !product) {
    throw new Error(`e2e setup: création du produit a échoué : ${insertError?.message}`);
  }

  const { data: tags, error: tagError } = await adminClient
    .from("catalog_tags")
    // `en` : le renommage ne doit toucher que la clé `es`.
    .insert([
      { label: { es: labelA, en: "Managed A" }, slug: `${slug}-a` },
      { label: { es: labelB }, slug: `${slug}-b` },
    ])
    .select("id, slug");
  if (tagError || !tags || tags.length !== 2) {
    throw new Error(`e2e setup: création des tags a échoué : ${tagError?.message}`);
  }
  const tagA = tags.find((tag) => tag.slug.endsWith("-a"))!;
  const tagB = tags.find((tag) => tag.slug.endsWith("-b"))!;
  const { error: assignError } = await adminClient.from("product_tag_assignments").insert([
    { product_id: product.id, tag_id: tagA.id },
    { product_id: product.id, tag_id: tagB.id },
  ]);
  if (assignError) throw new Error(`e2e setup: assignation a échoué : ${assignError.message}`);

  const readTag = async (id: string) =>
    (await adminClient.from("catalog_tags").select("label, slug").eq("id", id).maybeSingle()).data;

  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  // ── 1. Depuis le sélecteur de la fiche ────────────────────────────────────────────────────
  await page.goto(`/admin/products/${product.id}/edit`);
  await page.waitForLoadState("networkidle");
  const chips = page.getByTestId("tags-multiselect-selected");
  await expect(chips.getByText(labelA)).toBeVisible();

  await page.getByTestId("tags-multiselect-manage").click();
  await page.getByTestId("manage-tags-search").fill(String(suffix));
  await page.getByTestId(`manage-tag-rename-${tagA.id}`).click();
  await page.getByTestId(`manage-tag-input-${tagA.id}`).fill(renamedA);
  await page.getByTestId(`manage-tag-save-${tagA.id}`).click();

  await expect(chips.getByText(renamedA)).toBeVisible();
  await expect
    .poll(async () => readTag(tagA.id))
    .toEqual({ label: { es: renamedA, en: "Managed A" }, slug: `etiqueta-gestion-a2-${suffix}` });

  await page.getByTestId(`manage-tag-delete-${tagA.id}`).click();
  await expect(page.getByTestId(`manage-tag-warning-${tagA.id}`)).toHaveText(
    "Se quitará de 1 actividad. Esta acción no se puede deshacer.",
  );
  await page.getByTestId(`manage-tag-confirm-delete-${tagA.id}`).click();

  await expect(chips.getByText(renamedA)).toHaveCount(0);
  await expect(chips.getByText(labelB)).toBeVisible();
  await expect.poll(async () => readTag(tagA.id)).toBeNull();

  // ── 2. Depuis la cellule « Etiquetas » du catálogo ────────────────────────────────────────
  await page.goto(`/admin/products?tag_id=${tagB.id}`);
  await page.waitForLoadState("networkidle");
  const cell = page.getByTestId(`edit-tags-${product.id}`);
  await expect(cell).toContainText(labelB);
  await cell.click();
  await page.getByTestId(`edit-tags-${product.id}-manage`).click();
  await page.getByTestId("manage-tags-search").fill(String(suffix));
  await page.getByTestId(`manage-tag-rename-${tagB.id}`).click();
  await page.getByTestId(`manage-tag-input-${tagB.id}`).fill(renamedB);
  await page.getByTestId(`manage-tag-save-${tagB.id}`).click();

  await expect(cell).toContainText(renamedB);
  await expect.poll(async () => (await readTag(tagB.id))?.label).toEqual({ es: renamedB });

  await adminClient.from("products").delete().eq("id", product.id);
  await adminClient.from("catalog_tags").delete().eq("id", tagB.id);
});
