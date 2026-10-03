import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import {
  resetAvailability,
  clearCartItems,
  setBooked,
  getAvailability,
  getEstablishmentName,
  countOrdersByPhone,
  getOrderLinesForPhone,
  mockMercadoPagoCheckout,
  seedDate,
  irAPagoTrasAgregar,
  esperarRetornoTrasAgregar,
} from "@hifago/e2e-support";

// Feature 6 : "Client : composer un panier à plusieurs lignes sur une même commande
// (multi-établissement)". Le panier vit en base (`cart_items`, spec 32) rattaché à l'identité du
// visiteur — pas un état React en mémoire : il survit à N'IMPORTE QUELLE navigation, `page.goto()`
// compris. ⚠️ Ce commentaire disait le contraire jusqu'au 2026-09-13 (« un état React en
// mémoire... se réinitialise sur toute navigation dure ») — vrai avant la spec 32, faux depuis.
// Chaque ajout au panier redirige désormais automatiquement vers l'accueil (spec 28 Tranche 3,
// cahier §2b.5) : ce test enchaîne directement vers la fiche produit suivante par `page.goto()`,
// sans plus avoir besoin de cliquer un lien de retour au catalogue.
const TOUR_ID = "b0000000-0000-4000-8000-000000000001"; // tour-lancha-guatape (établissement A)
const TOUR_SLUG = "tour-lancha-guatape";
const TOUR_DATE = seedDate(7);

const KAYAK_ID = "b0000000-0000-4000-8000-000000000006"; // kayak-embalse-guatape (établissement B)
const KAYAK_SLUG = "kayak-embalse-guatape";
const KAYAK_DATE = seedDate(5);

// Les 2 tests ciblent kayak-embalse-guatape/2026-09-05 (la seule date seedée pour ce produit,
// cf. supabase/seed.sql) : jamais en parallèle l'un de l'autre.
test.describe.configure({ mode: "serial" });

test("panier avec une ligne par établissement → une seule commande, 2 lignes", async ({
  page,
}) => {
  await resetAvailability(TOUR_ID, TOUR_DATE, { capacity: 3, booked: 0 });
  await resetAvailability(KAYAK_ID, KAYAK_DATE, { capacity: 3, booked: 0 });
  await loginAs(page.context(), SEEDED_ACCOUNTS.referentActif, SEEDED_PASSWORD);

  // Lien profond, pas la carte d'accueil : la section « actividades » plafonne à 8 offres en
  // created_at desc (dette connue, cf. payment-return.spec.ts) — tour-lancha-guatape en est sorti
  // depuis l'ajout de mockData du 2026-09-14, sans rapport avec ce que ce test vérifie.
  await page.goto(`/es/productos/${TOUR_SLUG}`);
  await page.locator(`[data-date="${TOUR_DATE}"]`).click();
  await page.locator("#qty").fill("2");
  await page.getByTestId("add-to-cart-button").click();
  await esperarRetornoTrasAgregar(page);

  await page.goto(`/es/productos/${KAYAK_SLUG}`);
  await page.locator(`[data-date="${KAYAK_DATE}"]`).click();
  await page.getByTestId("add-to-cart-button").click();
  await irAPagoTrasAgregar(page);
  await expect(page.getByTestId(/^cart-line-/)).toHaveCount(2);

  const tourLine = page.locator('[data-testid^="cart-line-"]', { hasText: TOUR_DATE });
  const kayakLine = page.locator('[data-testid^="cart-line-"]', { hasText: KAYAK_DATE });

  const [tourEstablishment, kayakEstablishment] = await Promise.all([
    getEstablishmentName(TOUR_ID),
    getEstablishmentName(KAYAK_ID),
  ]);
  // Les 2 lignes doivent afficher chacune son propre établissement, sa propre date et sa propre
  // quantité — la preuve la plus directe qu'il s'agit bien d'un panier multi-établissement.
  await expect(tourLine).toContainText(tourEstablishment!);
  await expect(tourLine).toContainText("Cantidad: 2");
  await expect(kayakLine).toContainText(kayakEstablishment!);
  await expect(kayakLine).toContainText("Cantidad: 1");
  expect(tourEstablishment).not.toBe(kayakEstablishment);

  // Sans espaces : `PhoneField` (2026-09-10) normalise en E.164 avant `create_order`, et
  // `countOrdersByPhone`/`getOrderLinesForPhone` (packages/e2e-support) comparent par égalité
  // stricte — un littéral avec espaces ne matchait plus rien depuis ce changement.
  const phone = "+573004445555";
  await page.locator('input[name="holder-name"]').fill("Cliente E2E Multi Establecimiento");
  await page.locator('input[name="holder-phone"]').fill(phone);
  await page.locator('input[name="holder-email"]').fill("cliente.multi.establecimiento@example.com");
  // `redirectUrl` = le motif de l'écran de résultat (cf. `mockMercadoPagoCheckout`).
  const { redirectUrl } = await mockMercadoPagoCheckout(page);
  await page.getByTestId("submit-order-button").click();

  await page.waitForURL(redirectUrl);

  // Une seule commande, avec exactement les 2 lignes attendues (même order_id) — pas 2 commandes
  // séparées.
  expect(await countOrdersByPhone(phone)).toBe(1);
  const orderLines = await getOrderLinesForPhone(phone);
  expect(orderLines).toHaveLength(2);
  expect(new Set(orderLines.map((line) => line.order_id)).size).toBe(1);
  const tourWritten = orderLines.find((line) => line.product_id === TOUR_ID);
  const kayakWritten = orderLines.find((line) => line.product_id === KAYAK_ID);
  expect(tourWritten).toMatchObject({ date: TOUR_DATE, qty: 2 });
  expect(kayakWritten).toMatchObject({ date: KAYAK_DATE, qty: 1 });
});

test("une ligne dépasse la capacité restante de sa ressource → message d'erreur exact, aucune commande créée (tout-ou-rien)", async ({
  page,
}) => {
  // Un seul cupo ouvert pour tour-lancha-guatape : juste assez pour que l'ajout au panier
  // réussisse (le bouton "Añadir al carrito" exige remaining >= 1 pour être cliquable), avant
  // d'être pré-saturé directement en base — cf. commentaire plus bas.
  await resetAvailability(TOUR_ID, TOUR_DATE, { capacity: 1, booked: 0 });
  await resetAvailability(KAYAK_ID, KAYAK_DATE, { capacity: 3, booked: 0 });
  // Ce test déclenche volontairement un create_order en échec, qui laisse cart_items INTACT par
  // conception (spec 32 §0) — sans ce nettoyage, la 2ᵉ exécution de ce test trouve le compte
  // operateurActif déjà "plein" de son propre panier laissé par l'exécution précédente.
  await clearCartItems(TOUR_ID, TOUR_DATE);
  await clearCartItems(KAYAK_ID, KAYAK_DATE);
  await loginAs(page.context(), SEEDED_ACCOUNTS.operateurActif, SEEDED_PASSWORD);

  // Lien profond, pas la carte d'accueil : la section « actividades » plafonne à 8 offres en
  // created_at desc (dette connue, cf. payment-return.spec.ts) — tour-lancha-guatape en est sorti
  // depuis l'ajout de mockData du 2026-09-14, sans rapport avec ce que ce test vérifie.
  await page.goto(`/es/productos/${TOUR_SLUG}`);
  await page.locator(`[data-date="${TOUR_DATE}"]`).click();
  await page.getByTestId("add-to-cart-button").click();
  await esperarRetornoTrasAgregar(page);

  await page.goto(`/es/productos/${KAYAK_SLUG}`);
  await page.locator(`[data-date="${KAYAK_DATE}"]`).click();
  await page.getByTestId("add-to-cart-button").click();
  await esperarRetornoTrasAgregar(page);

  // Pré-sature directement la disponibilité de la ressource visée par la ligne tour-lancha, entre
  // l'ajout au panier (purement local) et la validation du panier — simule un autre acheteur qui
  // prend la dernière place pendant que ce client compose son panier. La ligne kayak, elle, reste
  // valide : le test doit prouver que TOUT le panier échoue quand même (tout-ou-rien), pas
  // seulement la ligne fautive.
  await setBooked(TOUR_ID, TOUR_DATE, 1);

  await page.goto("/es/pago");
  await expect(page.getByTestId(/^cart-line-/)).toHaveCount(2);

  const phone = "+57 300 666 7777";
  await page.locator('input[name="holder-name"]').fill("Cliente E2E Multi Full");
  await page.locator('input[name="holder-phone"]').fill(phone);
  await page.locator('input[name="holder-email"]').fill("cliente.multi.full@example.com");
  await page.getByTestId("submit-order-button").click();

  // Message ciblé sur la VRAIE raison (« esta fecha ya está completa »), pas seulement « une
  // erreur est apparue » — CheckoutPage.json errors.full, résolu par resolveKnownReason("full").
  await expect(page.getByTestId("checkout-error")).toContainText("completa");
  // Spec 33 — l'équivalent de l'ancien « pas d'écran de succès » : une commande refusée ne fait
  // PAS quitter le tunnel. Assertion plus forte que la précédente, qui constatait l'absence d'un
  // testid et serait restée verte même si celui-ci disparaissait pour une autre raison — ce qui
  // vient précisément d'arriver.
  await expect(page).toHaveURL(/\/pago(\?|$)/);

  // ⚠️ RÉGRESSION CONNUE, non corrigée ici (arbitrage Jérôme, 2026-09-15, docs/dette-technique.md) :
  // ce test vérifiait autrefois que la ligne fautive (tour-lancha, désormais complète) portait
  // `data-failed="true"` et la ligne valide (kayak) `data-failed="false"` — attribut disparu avec
  // la refonte du panier (spec 32) : `create_order` renvoie toujours `line.product_id`/`date`, mais
  // CheckoutForm.tsx ne s'en sert pas pour marquer une ligne, et CartSummary (qui affiche les
  // lignes) est un composant client séparé, alimenté par les lignes lues côté serveur
  // (getCartLines), sans lien avec le résultat du formulaire. Le client voit le message générique ci-dessus, mais ne sait plus repérer LAQUELLE
  // de plusieurs lignes en est la cause. L'invariant tout-ou-rien, lui, reste garanti par
  // `create_order` elle-même (vérifié juste en dessous), indépendamment de cette perte d'affichage.

  // Tout-ou-rien vérifiable directement en base : aucune commande créée du tout, et la ligne
  // kayak (individuellement valide) n'a pas non plus consommé son cupo.
  expect(await countOrdersByPhone(phone)).toBe(0);
  const tourAvailability = await getAvailability(TOUR_ID, TOUR_DATE);
  const kayakAvailability = await getAvailability(KAYAK_ID, KAYAK_DATE);
  expect(tourAvailability?.booked).toBe(1);
  expect(kayakAvailability?.booked).toBe(0);
});
