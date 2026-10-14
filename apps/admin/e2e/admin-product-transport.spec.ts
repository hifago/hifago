import path from "node:path";
import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { filaPorNombre } from "./support/filas";
import { confirmAndContinue, createSignedInClient, goToNextWizardStep, webProductUrl } from "@hifago/e2e-support";
import { slugify } from "../lib/utils";

// Spec 14 — active type='transport' dans le même ProductForm que l'activité/l'alojamiento/l'hôtel
// (specs 11/12/13) : nom/lieu/tags/photos/prix-tramos réutilisent le mécanisme existant (couvert
// par admin-product-create.spec.ts/admin-product-lodging.spec.ts), ce test se concentre sur ce qui
// diverge — un trajet de transport n'a ni check-in/check-out ni capacité produit (contrairement à
// l'alojamiento/l'hôtel), le prix par tramos couvrant seul les paliers de capacité de véhicule
// (« hasta 4/7 pers. » de la V1) — tout en exerçant le chemin complet création → édition, cf.
// CLAUDE.md §6.5.
//
// Étendu le 2026-09-16 (migration 20260916150000, demande Jérôme) : un transport porte désormais
// une fenêtre de départs, des places annoncées par départ et DEUX lieux dédiés, tous INFORMATIFS.
// Ce test porte aussi le seul garde-fou mécanique du retrait du trio générique `address`/`lat`/`lon`
// pour ce type — l'assertion `address-input` à 0, exactement comme `check-in-input` juste à côté.
// Sans elle, rien n'empêcherait de le réexposer un jour et de recréer la double source de vérité
// (CLAUDE.md §11.20).
const FIXTURE_PHOTO = path.join(__dirname, "fixtures/test-photo.jpg");

test("admin crée un transport (prix par tramos de capacidad de vehículo), l'édite et vérifie la persistance", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  const establishmentName = `Establecimiento E2E Transporte ${Date.now()}`;
  await page.goto("/admin/establishments/new");
  // Assistant par étapes (docs/specs/40) — étape 1 "Propietario y gestión" (partner), étape 2
  // "Detalles" (nombre).
  const partnerSearch = page.getByTestId("partner-search");
  await partnerSearch.click();
  await partnerSearch.fill("Opérateur Actif");
  await page.getByRole("option", { name: /Opérateur Actif/ }).click();
  await goToNextWizardStep(page);
  await page.locator('input[name="nombre"]').fill(establishmentName);
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
  await page.getByRole("option", { name: "Transporte" }).click();

  const suffix = Date.now();
  const nameEs = `Privado aeropuerto Guatapé ES ${suffix}`;
  await page.locator('input[name="nombre"]').fill(nameEs);

  // Assistant par étapes (docs/specs/40) — étape 1 validée, avance vers l'étape 2 "Detalles"
  // (rutas, contacto, horarios informativos, foto).
  await goToNextWizardStep(page);

  // Les DEUX lieux du trajet, dans leurs colonnes dédiées — le trio générique `address`/`lat`/`lon`
  // n'existe plus pour ce type (assertion plus bas).
  await page.getByTestId("departure-address-input").fill("Aeropuerto José María Córdova, Rionegro");
  await page.getByTestId("departure-lat-input").fill("6.1645");
  await page.getByTestId("departure-lon-input").fill("-75.4231");
  await page.getByTestId("arrival-address-input").fill("Parque Principal, Guatapé");
  await page.getByTestId("arrival-lat-input").fill("6.2326");
  await page.getByTestId("arrival-lon-input").fill("-75.1592");

  // Le contact du transporteur (2026-09-17). OPTIONNEL en soi, mais renseigné ici pour pouvoir
  // asserter plus bas que c'est bien SON numéro qui atterrit sur le bouton de la fiche publique,
  // et pas le repli Hifago.
  await page.getByTestId("transport-contact-phone-input").fill("+573001112233");

  // Fenêtre de départs + places annoncées — informatif, jamais un créneau réservable : le mode de
  // réservation du transport reste par DATE (aucun `product_slot_rules` n'est créé ici).
  await page.getByTestId("transport-first-departure-input").fill("07:00");
  await page.getByTestId("transport-last-departure-input").fill("07:45");
  await page.getByTestId("transport-seats-input").fill("40");

  // Foto (opcional, même staging que les autres types).
  const gallery = page.getByTestId("media-gallery");
  await gallery.getByTestId("media-gallery-add").locator("input[type=file]").setInputFiles(FIXTURE_PHOTO);
  await expect(page.getByTestId("image-crop-stage")).toBeVisible();
  await page.getByTestId("image-crop-confirm").click();
  await expect(gallery.getByTestId("media-gallery-item")).toHaveCount(1, { timeout: 10000 });

  // Pas de check-in/check-out ni de capacité produit pour un transport (schedule='date' en V1, le
  // transporteur dispatche son propre parc — même absence que pour une activité, spec 14 §gating).
  // Vérifié sur cette étape ("Detalles") : c'est là que ces champs apparaîtraient pour un
  // alojamiento/une actividad si le gating par type ne les excluait pas.
  await expect(page.getByTestId("check-in-input")).toHaveCount(0);
  await expect(page.getByTestId("capacity-input")).toHaveCount(0);
  // Le trio générique a quitté ce type le 2026-09-16 : deux champs d'adresse sur le même écran
  // auraient été deux sources de vérité pour un seul lieu.
  await expect(page.getByTestId("address-input")).toHaveCount(0);
  await expect(page.getByTestId("lat-input")).toHaveCount(0);

  // Étape 2 validée, avance vers l'étape 3 "Comercialización".
  await goToNextWizardStep(page);

  // Precio por tramos de capacidad de vehículo (spec 14 §3 — un producto con tramos en lugar de las
  // fichas separadas "hasta 4 pers."/"hasta 7 pers." de la V1) + bornes de cantidad.
  await page.getByTestId("price-mode-toggle").click();
  await page.getByTestId("price-tier-min-0").fill("1");
  await page.getByTestId("price-tier-max-0").fill("4");
  await page.getByTestId("price-tier-price-0").fill("210000");
  await page.getByTestId("add-price-tier-button").click();
  await page.getByTestId("price-tier-min-1").fill("5");
  await page.getByTestId("price-tier-max-1").fill("7");
  await page.getByTestId("price-tier-price-1").fill("362000");
  await page.getByTestId("min-qty-input").fill("1");
  await page.getByTestId("max-qty-input").fill("7");

  // Le cupo a quitté ce type le 2026-09-17 : sans calendrier, il ne serait jamais lu, et afficher
  // « 40 » ferait croire à un plafond réel (docs/specs/14 §0 le disait depuis le début). Vérifié
  // sur cette étape ("Comercialización") : c'est là que le champ apparaîtrait pour une
  // actividad/un camp/un alojamiento si le gating par type ne l'excluait pas.
  await expect(page.getByTestId("default-capacity-input")).toHaveCount(0);

  await page.getByTestId("create-product-button").click();
  await confirmAndContinue(page, "product-form-confirmation");
  await expect(page).toHaveURL(/\/admin\/establishments$/);
  await expect(row).toContainText("1 actividades");

  // sellable=true à la création (retour Jérôme, 2026-08-20) — même garde-fou que pour les autres
  // types.
  await context.clearCookies();
  const slug = slugify(nameEs);
  const publicResponse = await page.goto(webProductUrl(slug));
  expect(publicResponse?.status()).toBe(200);

  // Le but même du lot : ces informations sont VISIBLES par le voyageur, pas seulement en base
  // (« ces infos doivent être dans la fiche du produit », Jérôme, 2026-09-16).
  await expect(page.getByTestId("transport-schedule")).toContainText("07:00");
  await expect(page.getByTestId("transport-schedule")).toContainText("07:45");
  await expect(page.getByTestId("transport-schedule")).toContainText("40");
  await expect(page.getByTestId("transport-route")).toContainText("Guatapé");
  // Lien d'itinéraire : une simple URL Maps, jamais un appel à la Google Routes API.
  const mapsHref = await page.getByTestId("transport-maps-link").getAttribute("href");
  expect(mapsHref).toContain("google.com/maps/dir/");
  expect(mapsHref).toContain("origin=6.1645%2C-75.4231");

  // ⚠️ LE POINT DU 2026-09-17 : un transport se CONTACTE, il ne se réserve pas en ligne. Le
  // calendrier et le bouton « Añadir a Mi viaje » ont laissé la place au bouton WhatsApp — et
  // c'est bien le numéro du transporteur, pas le repli Hifago.
  const contactHref = await page.getByTestId("vitrina-contact-link").getAttribute("href");
  expect(contactHref).toBe("https://wa.me/573001112233");
  await expect(page.getByTestId("add-to-cart-button")).toHaveCount(0);
  // Le prix reste affiché malgré le mode vitrine.
  // ⚠️ PAS d'assertion sur le suffixe « por persona » ici, et ce n'est pas un oubli : `products.unit`
  // n'est PAS saisissable pour un transport (le champ est lodging-only dans product-type-fields),
  // donc un transport créé depuis l'admin n'a jamais d'unité de prix — mesuré ici le 2026-09-17.
  // Les mocks, eux, la renseignent à la main. Le rétablissement du suffixe en mode vitrine est
  // couvert par FichaProducto.transporte.test.tsx, qui peut, lui, poser l'unité.
  await expect(page.getByTestId("product-price")).toContainText("COP");

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: created } = await adminClient
    .from("products")
    .select("id, type")
    .eq("slug", slug)
    .single();
  if (!created) throw new Error("e2e: transport introuvable après création");
  expect(created.type).toBe("transport");
  const productId = created.id as string;

  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/products/${productId}/edit`);
  await expect(page.getByRole("heading", { name: "Editar transporte" })).toBeVisible();

  // Contrairement aux chambres d'hôtel (table enfant, bloc édition séparé), le prix par tramos est
  // une simple colonne products : préremplie directement dans ProductForm, aucun bloc séparé.
  await expect(page.locator('input[name="nombre"]')).toHaveValue(nameEs);
  await expect(page.getByTestId("departure-address-input")).toHaveValue("Aeropuerto José María Córdova, Rionegro");
  await expect(page.getByTestId("arrival-address-input")).toHaveValue("Parque Principal, Guatapé");
  await expect(page.getByTestId("transport-first-departure-input")).toHaveValue("07:00");
  await expect(page.getByTestId("transport-last-departure-input")).toHaveValue("07:45");
  await expect(page.getByTestId("transport-seats-input")).toHaveValue("40");
  await expect(page.getByTestId("transport-contact-phone-input")).toHaveValue("+573001112233");
  await expect(page.getByTestId("price-tiers-editor")).toBeVisible();
  await expect(page.getByTestId("price-tier-price-0")).toHaveValue("210000");
  await expect(page.getByTestId("price-tier-price-1")).toHaveValue("362000");
  await expect(page.getByTestId("min-qty-input")).toHaveValue("1");
  await expect(page.getByTestId("max-qty-input")).toHaveValue("7");
  await expect(page.getByTestId("check-in-input")).toHaveCount(0);
  await expect(page.getByTestId("capacity-input")).toHaveCount(0);
  await expect(page.getByTestId("address-input")).toHaveCount(0);

  // Édite directement dans le même submit (pas de bouton de sauvegarde séparé pour ces champs).
  await page.getByTestId("price-tier-price-1").fill("380000");
  // Une seule salida (primera = última) : c'est le cas NORMAL d'un transfert à heure fixe, et c'est
  // ce que le `>=` du CHECK products_transport_departure_order autorise — le formulaire doit
  // l'accepter sans message d'erreur.
  await page.getByTestId("transport-last-departure-input").fill("07:00");
  await page.getByTestId("save-product-button").click();
  await confirmAndContinue(page, "product-form-confirmation");
  await expect(page).toHaveURL(/\/admin\/establishments\/[0-9a-f-]{36}$/);

  await page.goto(`/admin/products/${productId}/edit`);
  await expect(page.getByTestId("price-tier-price-1")).toHaveValue("380000");
  await expect(page.getByTestId("transport-first-departure-input")).toHaveValue("07:00");
  await expect(page.getByTestId("transport-last-departure-input")).toHaveValue("07:00");
});
