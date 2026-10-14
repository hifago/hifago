import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import {
  resetAvailability,
  setBooked,
  getPrice,
  countOrderLines,
  getAvailability,
  mockMercadoPagoCheckout,
  seedDate,
  irAPagoTrasAgregar,
  esperarRetornoTrasAgregar,
} from "@hifago/e2e-support";

// Feature 6 : le flux Checkpoint B (bouton unique "Reservar" appelant reserve_order_line
// directement, cf. git history) a été remplacé par catalogue → fiche produit → panier React en
// mémoire (lib/cart/CartContext.tsx, jamais persisté) → /pago → create_order (une seule RPC
// tout-ou-rien, supabase/migrations/20260813243000_create_order_rpc.sql). Ce spec pilote donc
// désormais le parcours complet plutôt qu'un unique clic déclenchant la RPC.
const PRODUCT_ID = "b0000000-0000-4000-8000-000000000001"; // tour-lancha-guatape
const DATE = seedDate(5); // cf. supabase/seed.sql — remis à un état connu avant chaque test.

// Les 2 tests ciblent la même ressource (produit, date) : jamais en parallèle l'un de l'autre,
// sans quoi le reset fait par le second pourrait s'exécuter pendant que le premier est encore en
// train de composer son panier.
test.describe.configure({ mode: "serial" });

test("connexion → catalogue → fiche produit → panier → checkout : commande validée", async ({
  page,
}) => {
  await resetAvailability(PRODUCT_ID, DATE, { capacity: 5, booked: 0 });
  await loginAs(page.context(), SEEDED_ACCOUNTS.referentActif, SEEDED_PASSWORD);

  await page.goto("/es");
  await page.getByTestId("tarjeta-tour-lancha-guatape-link").click();
  await expect(page.getByTestId("product-name")).toBeVisible();

  await page.locator(`[data-date="${DATE}"]`).click();
  await page.getByTestId("add-to-cart-button").click();
  await irAPagoTrasAgregar(page);
  await expect(page.getByTestId(/^cart-line-/)).toHaveCount(1);

  // Jamais un prix COP figé en dur (cette base locale est partagée avec d'autres agents, cf.
  // consignes de la tâche) : le total attendu est recalculé à partir du prix RÉELLEMENT lu en
  // base au moment du test, pas d'une valeur mémorisée à l'avance. On compare seulement les
  // chiffres bruts (regroupements/symbole monétaire ignorés) pour rester robuste à un éventuel
  // écart de rendu Intl entre Node et le navigateur.
  const price = await getPrice(PRODUCT_ID);
  const totalText = await page.getByTestId("cart-total").innerText();
  expect(totalText.replace(/[^0-9]/g, "")).toBe(String(price));

  await page.locator('input[name="holder-name"]').fill("Cliente E2E Reserve");
  await page.locator('input[name="holder-phone"]').fill("+57 300 111 2222");
  await page.locator('input[name="holder-email"]').fill("cliente.reserve@example.com");
  await page.getByTestId("marketing-consent-checkbox").click();

  // Spec 33 : une commande acceptée quitte le tunnel pour son adresse propre — `/reserva/<jeton>`
  // — AVANT tout paiement. `redirectUrl` est donc le motif de cet écran-là, et non plus une URL
  // fabriquée qui pointait sur l'accueil. L'ancien `order-success` a disparu avec l'écran de
  // succès de CheckoutForm : il n'était qu'un état React, perdu au retour de Mercado Pago.
  const { redirectUrl } = await mockMercadoPagoCheckout(page);
  await page.getByTestId("submit-order-button").click();
  await page.waitForURL(redirectUrl);

  const { lines, qty } = await countOrderLines(PRODUCT_ID, DATE);
  expect(lines).toBe(1);
  expect(qty).toBe(1);
});

test("capacité épuisée entre l'ajout au panier et la validation → erreur claire, aucune commande", async ({
  page,
}) => {
  await resetAvailability(PRODUCT_ID, DATE, { capacity: 2, booked: 0 });
  await loginAs(page.context(), SEEDED_ACCOUNTS.operateurActif, SEEDED_PASSWORD);

  await page.goto("/es");
  await page.getByTestId("tarjeta-tour-lancha-guatape-link").click();
  await page.locator(`[data-date="${DATE}"]`).click();
  await page.getByTestId("add-to-cart-button").click();
  await esperarRetornoTrasAgregar(page);

  await page.goto("/es/pago");
  await page.locator('input[name="holder-name"]').fill("Cliente E2E Reserve Full");
  await page.locator('input[name="holder-phone"]').fill("+57 300 111 3333");
  await page.locator('input[name="holder-email"]').fill("cliente.reserve.full@example.com");

  // Simule un autre acheteur qui prend les places restantes pendant que CE client remplit son
  // formulaire de checkout. La vraie barrière anti-survente est exclusivement create_order (au
  // clic "Validar pedido"). Reproduire "tenter de dépasser la capacité restante" en ciblant
  // directement une date déjà pleine dans le calendrier n'est pas possible : le bouton "Añadir al
  // carrito" est désactivé dès que le cupo restant affiché est à 0 (rien à cliquer). Cette
  // manipulation base directe est donc la façon réaliste de reproduire un dépassement de capacité
  // découvert seulement au moment de la validation finale. Elle vient APRÈS l'affichage de /pago :
  // avant, la page signalerait déjà la ligne (cart_lines_availability) et l'envoi serait fermé.
  await setBooked(PRODUCT_ID, DATE, 2);
  await page.getByTestId("submit-order-button").click();

  // Message ciblé sur la VRAIE raison (« esta fecha ya está completa ») — même assertion que
  // cart-multi-establishment.spec.ts.
  await expect(page.getByTestId("checkout-error")).toContainText("completa");
  // Le panier est relu après le refus : la ligne porte la même raison, et l'envoi reste fermé tant
  // qu'elle y est (migration 20261014211217).
  const ligneSignalee = page.locator('[data-testid^="cart-line-"][data-availability="unavailable"]');
  await expect(ligneSignalee).toHaveCount(1);
  await expect(ligneSignalee).toContainText("completa");
  await expect(page.getByTestId("unavailable-lines-notice")).toBeVisible();
  await expect(page.getByTestId("submit-order-button")).toBeDisabled();
  // Spec 33 — l'équivalent de l'ancien « pas d'écran de succès » : une commande refusée ne fait
  // PAS quitter le tunnel. Assertion plus forte que la précédente, qui se contentait de constater
  // l'absence d'un testid (et serait restée verte même si celui-ci disparaissait pour une autre
  // raison — ce qui vient précisément d'arriver).
  await expect(page).toHaveURL(/\/pago(\?|$)/);

  // Tout-ou-rien : la tentative échouée n'a écrit ni ligne ni décrément de cupo en base.
  const { lines } = await countOrderLines(PRODUCT_ID, DATE);
  expect(lines).toBe(0);
  const availability = await getAvailability(PRODUCT_ID, DATE);
  expect(availability?.booked).toBe(2);
});
