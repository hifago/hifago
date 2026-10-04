import { test, expect } from "@playwright/test";
import { createSignedInClient, SEEDED_ACCOUNTS, SEEDED_PASSWORD, withDb } from "@hifago/e2e-support";

// Spec 26 — référencement Google et moteurs de réponse IA.
//
// PREMIER test du dépôt qui interroge le HTTP brut (`request.get`) et le contenu du `<head>` :
// jusqu'ici toutes les specs naviguaient avec `page.goto`. C'est nécessaire ici parce que les deux
// surfaces principales de ce lot — /robots.txt et /sitemap.xml — ne sont pas des pages.
//
// Produit DÉDIÉ créé par ce test, jamais un enregistrement seedé partagé désigné par son nom : une
// autre session peut le renommer en testant sa propre spec au même moment (contamination déjà
// survenue entre admin-product-price-tiers et admin-establishment-edit). La base locale n'est pas
// remise à zéro entre deux exécutions e2e, d'où le nettoyage en `finally`.
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000004";

test("robots.txt bloque tout hors production et n'annonce aucun sitemap", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);

  const body = await response.text();
  expect(body).toContain("User-Agent: *");
  expect(body).toContain("Disallow: /");
  // On n'indique pas un plan de site qu'on refuse par ailleurs de faire crawler.
  expect(body).not.toContain("Sitemap:");
});

test("le sitemap est servi, non vide, et porte x-default sur chaque entrée", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("xml");

  const body = await response.text();
  // Le catalogue seedé garantit au moins l'accueil dans les deux locales et quelques produits.
  // ⚠️ Ce test ne protège PAS du sitemap vide livré par un build sans base (ici la base répond) :
  // ce garde-fou-là est le smoke test de bascule, cf. spec 26 §5.2.
  const locs = body.match(/<loc>/g) ?? [];
  expect(locs.length).toBeGreaterThan(2);

  expect(body).toContain('hreflang="x-default"');
  expect(body).toContain("/es</loc>");
  // Spec 29 §8.3 : les listings entrent au sitemap dans les deux locales (libellés d'interface).
  expect(body).toContain("/es/actividades</loc>");
  expect(body).toContain("/en/actividades</loc>");
  // localePrefix vaut "always" : aucune URL sans préfixe de locale ne doit apparaître.
  expect(body).not.toMatch(/<loc>https?:\/\/[^/]+\/?<\/loc>/);
});

test("une fiche produit porte un canonical absolu et un JSON-LD valide, sans notation inventée", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const productName = `Producto SEO E2E ${stamp}`;
  const productSlug = `producto-seo-e2e-${stamp}`;

  const admin = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: establishment } = await admin
    .from("establishments")
    .select("id, partner_id")
    .eq("id", ESTABLISHMENT_ID)
    .maybeSingle();
  if (!establishment) throw new Error("e2e setup : établissement seedé introuvable");

  // Nom saisi UNIQUEMENT en espagnol : c'est ce qui rend la version /en servie par repli, donc
  // noindex — le cas que vérifie la dernière assertion.
  const { error: insertError } = await admin.from("products").insert({
    partner_id: establishment.partner_id,
    establishment_id: ESTABLISHMENT_ID,
    type: "activity",
    name: { es: productName },
    description: { es: "Descripción de prueba." },
    slug: productSlug,
    sellable: true,
    price_cop: 90000,
  });
  if (insertError) throw new Error(`e2e setup : création du produit a échoué — ${insertError.message}`);

  try {
    await page.goto(`/es/productos/${productSlug}`);

    // --- Canonical ABSOLU : c'est ce que metadataBase rend possible ------------------------------
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toMatch(/^https?:\/\/.+\/es\/productos\//);

    // --- Une seule source de hreflang -----------------------------------------------------------
    // next-intl posait les siens en en-tête HTTP `Link` (alternateLinks, actif par défaut) : ils
    // sont désormais coupés, et seules les métadonnées les portent.
    const headResponse = await request.get(`/es/productos/${productSlug}`);
    expect(headResponse.headers()["link"] ?? "").not.toContain("hreflang");
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1);

    // --- JSON-LD : présent, parsable, honnête ---------------------------------------------------
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks.length).toBeGreaterThanOrEqual(2);

    const parsed = blocks.map((block) => JSON.parse(block));
    const product = parsed.find((node) => node["@type"] === "Product");
    expect(product).toBeTruthy();
    expect(product.offers).toMatchObject({ price: 90000, priceCurrency: "COP" });
    expect(parsed.some((node) => node["@type"] === "BreadcrumbList")).toBe(true);

    // Aucune table d'avis n'existe : émettre une note serait une donnée inventée.
    expect(JSON.stringify(parsed)).not.toMatch(/aggregateRating|ratingValue|reviewCount/);

    // --- La version non traduite reste noindex --------------------------------------------------
    await page.goto(`/en/productos/${productSlug}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    // ...et elle n'est pas au sitemap, qui ne liste que des URL indexables.
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain(`/es/productos/${productSlug}`);
    expect(sitemap).not.toContain(`/en/productos/${productSlug}`);
  } finally {
    await withDb((client) => client.query("delete from products where slug = $1", [productSlug]));
  }
});
