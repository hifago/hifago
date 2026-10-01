import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { resetAvailability, getOrderLineStatuses, createSignedInClient, seedDate, withDb } from "@hifago/e2e-support";

// Spec 34 — pilote réellement `/cuenta/reservas` avec une commande à DEUX prestations.
//
// REMPLACE `cancel-order.spec.ts`, qui prouvait l'annulation de la COMMANDE ENTIÈRE — la règle que
// la décision ⑤ renverse. ⚠️ Il était de toute façon CASSÉ depuis le 2026-09-10 : il passait
// `p_lines` à `create_order`, paramètre supprimé par la spec 32 (le panier vit en base et la RPC lit
// ses propres lignes). Invisible parce que la suite e2e est en pause depuis le 2026-09-09 — cinq
// autres fichiers portent la même rupture, portés au backlog.
//
// CE QUE CE SPEC TIENT, et rien d'autre : le parcours d'écran. Les refus (`line_not_found`,
// `line_not_active`, session anonyme), l'isolement entre comptes, le regroupement et l'ordre sont
// prouvés en base par `cancel_order_line.test.sql` et `list_my_orders.test.sql` — plus fortement et
// cent fois moins cher qu'un navigateur.
const PRODUCT_ID = "b0000000-0000-4000-8000-000000000001"; // tour-lancha-guatape
const DATE_1 = seedDate(14); // dates dédiées à ce spec (cf. supabase/seed.sql)
const DATE_2 = seedDate(20);

test("un client voit ses prestations dépliées, en annule une, et l'autre reste active", async ({
  page,
}) => {
  await resetAvailability(PRODUCT_ID, DATE_1, { capacity: 5, booked: 0 });
  await resetAvailability(PRODUCT_ID, DATE_2, { capacity: 5, booked: 0 });

  // Setup — le panier puis `create_order` (dogfooding, jamais un insert brut dans `orders`).
  // Depuis la spec 32 la RPC ne reçoit plus ses lignes : elle lit `cart_items`, qu'on remplit ici.
  const setupClient = await createSignedInClient(SEEDED_ACCOUNTS.referentActif, SEEDED_PASSWORD);
  const {
    data: { user },
  } = await setupClient.auth.getUser();
  if (!user) throw new Error("e2e setup: aucune session après createSignedInClient");

  const { error: cartError } = await setupClient.from("cart_items").insert([
    { account_id: user.id, product_id: PRODUCT_ID, date: DATE_1, qty: 1 },
    { account_id: user.id, product_id: PRODUCT_ID, date: DATE_2, qty: 2 },
  ]);
  if (cartError) throw new Error(`e2e setup: remplissage du panier échoué : ${cartError.message}`);

  const { data: result, error: rpcError } = await setupClient.rpc("create_order", {
    p_holder_name: "Cliente E2E Mis Reservas",
    p_holder_email: "cliente.e2e.mis-reservas@example.com",
  });
  const created = result as { ok: boolean; order_id?: string } | null;
  if (rpcError || !created?.ok || !created.order_id) {
    throw new Error(`e2e setup: create_order a échoué : ${rpcError?.message ?? JSON.stringify(created)}`);
  }
  const orderId = created.order_id;

  // Connexion directe (withDb), jamais le client de session : depuis le revoke du 2026-09-22
  // (20260922210000), une session ne lit plus `order_lines`. `date::text` parce que `pg` rend une
  // colonne `date` en objet Date, et la comparaison porte sur la chaîne.
  const lines = await withDb(async (client) => {
    const { rows } = await client.query<{ id: string; date: string }>(
      "select id, date::text as date from order_lines where order_id = $1 order by date",
      [orderId]
    );
    return rows;
  });
  const ligne1 = lines.find((l) => l.date === DATE_1);
  const ligne2 = lines.find((l) => l.date === DATE_2);
  if (!ligne1 || !ligne2) throw new Error("e2e setup: les deux lignes attendues sont absentes");

  await loginAs(page.context(), SEEDED_ACCOUNTS.referentActif, SEEDED_PASSWORD);
  await page.goto("/es/cuenta/reservas");

  // ① La commande est une carte, et ses DEUX prestations y sont dépliées.
  await expect(page.getByTestId(`order-card-${orderId}`)).toBeVisible();
  await expect(page.getByTestId(`order-line-${ligne1.id}`)).toBeVisible();
  await expect(page.getByTestId(`order-line-${ligne2.id}`)).toBeVisible();

  // ② Chaque prestation porte SES DEUX montants (décision ④) : payé en ligne, et prix total.
  await expect(page.getByTestId(`line-paid-${ligne1.id}`)).toBeVisible();
  await expect(page.getByTestId(`line-total-${ligne1.id}`)).toBeVisible();

  // ③ Elle est dans « Próximas » — le groupe vient de la base, l'écran ne fait que le lire.
  await expect(page.getByTestId("grupo-proximas")).toContainText("HFG-");

  // ④ Annuler la première : la confirmation apparaît, sans montant, et SANS la phrase « dernière
  // prestation » puisqu'une autre reste active.
  await page.getByTestId(`cancel-line-${ligne1.id}`).click();
  const confirmation = page.getByTestId(`cancel-line-${ligne1.id}-confirm`);
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("no se devuelve");
  await expect(page.getByTestId(`cancel-line-${ligne1.id}-last-line`)).toHaveCount(0);

  await page.getByTestId(`cancel-line-${ligne1.id}-yes`).click();

  // ⑤ LE point du lot : la prestation visée est annulée, sa SŒUR reste active.
  await expect(page.getByTestId(`order-line-${ligne1.id}`)).toHaveAttribute(
    "data-status",
    "cancelled_by_client"
  );
  await expect(page.getByTestId(`order-line-${ligne2.id}`)).toHaveAttribute("data-status", "reserved");
  await expect(page.getByTestId(`cancel-line-${ligne2.id}`)).toBeVisible();

  // ⑥ Rechargement : la persistance est réelle, pas un état client optimiste — l'écran relit
  // `list_my_orders`, donc la base.
  await page.reload();
  await expect(page.getByTestId(`order-line-${ligne1.id}`)).toHaveAttribute(
    "data-status",
    "cancelled_by_client"
  );
  await expect(page.getByTestId(`order-line-${ligne2.id}`)).toHaveAttribute("data-status", "reserved");

  // ⑦ Sur la prestation restante, la confirmation prévient maintenant que TOUTE la réservation
  // tombera — c'est la seule règle d'écran que ce parcours ajoute aux tests en base.
  await page.getByTestId(`cancel-line-${ligne2.id}`).click();
  await expect(page.getByTestId(`cancel-line-${ligne2.id}-last-line`)).toBeVisible();

  // ⑧ Confirmation en base, au-delà de l'écran. Trié côté test : `getOrderLineStatuses` ne
  // garantit pas d'ordre, et `packages/e2e-support` n'est pas dans le périmètre de ce lot.
  const statuses = (await getOrderLineStatuses(orderId)).slice().sort();
  expect(statuses).toEqual(["cancelled_by_client", "reserved"]);
});
