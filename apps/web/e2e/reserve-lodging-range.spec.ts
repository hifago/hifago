import { test, expect } from "@playwright/test";
import {
  withDb,
  mockMercadoPagoCheckout,
  isoDate,
  deleteOrdersByHolderName,
  irAPagoTrasAgregar,
} from "@hifago/e2e-support";

// Spec 17 §0 Tranche 2 (docs/specs/17-calendrier-disponibilite-refonte.md) — alojamiento (maison
// entière) réservé par plage de nuits, branche create_order end_date. La logique de create_order
// elle-même (arithmétique de capacité, re-résolution de prix, tout-ou-rien) est déjà entièrement
// couverte par pgTAP (supabase/tests/database/date_range_booking.test.sql) — pas re-prouvée ici,
// seul le parcours écran (plage → panier → checkout → confirmation) l'est.
const TIMESTAMP = Date.now();
const PRODUCT_ID = "88950000-0000-4000-8000-000000000001";
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000002"; // établissement seedé existant
const SLUG = `e2e-reserve-lodging-range-${TIMESTAMP}`;

// Fixture et purge partagées par les deux scénarios de ce fichier : ils ne diffèrent QUE par la
// capacité, la grille de paliers et l'identité du produit. Elles vivaient recopiées d'un test à
// l'autre — tout ajout de colonne NOT NULL sur `products` aurait alors cassé deux endroits, et un
// oubli de purge laisse des données qui polluent les autres specs (dette connue, cf.
// `docs/dette-technique.md`).
async function crearAlojamientoDePrueba({
  id,
  slug,
  nombre,
  capacity,
  priceTiers,
}: {
  id: string;
  slug: string;
  nombre: string;
  capacity: number;
  priceTiers?: { min_qty: number; max_qty: number; price_cop: number }[];
}) {
  await withDb(async (client) => {
    const { rows } = await client.query("select partner_id from establishments where id = $1", [
      ESTABLISHMENT_ID,
    ]);
    const partnerId = rows[0].partner_id as string;
    await client.query(
      `insert into products (id, partner_id, establishment_id, type, name, sellable, slug, price_cop, min_qty, max_qty, price_tiers)
       values ($1, $2, $3, 'lodging', $4, true, $5, 200000, 1, 4, $6::jsonb)`,
      [
        id,
        partnerId,
        ESTABLISHMENT_ID,
        JSON.stringify({ es: nombre }),
        slug,
        priceTiers ? JSON.stringify(priceTiers) : null,
      ]
    );
    await client.query(
      `insert into product_availability (product_id, date, capacity, booked)
       select $1, $2::date + n, $3, 0 from generate_series(0, 6) as n`,
      [id, isoDate(1), capacity]
    );
    await client.query(
      `insert into product_calendar (product_id, date, open)
       select $1, $2::date + n, true from generate_series(0, 6) as n`,
      [id, isoDate(1)]
    );
  });
}

async function limpiarAlojamientoDePrueba(id: string, holderName: string) {
  await withDb(async (client) => {
    await client.query(
      "delete from order_lines where order_id in (select id from orders where holder_name = $1)",
      [holderName]
    );
  });
  // create_payment_intent n'est jamais mocké (seul l'appel SDK Mercado Pago externe l'est) — un
  // payments réel référence cette commande, purgé avant les orders eux-mêmes (FK
  // payments_order_id_fkey), même helper partagé que resetAvailability.
  await deleteOrdersByHolderName(holderName);
  await withDb(async (client) => {
    // `cart_items` d'abord : elle référence products sans cascade, et un run interrompu après
    // l'ajout au panier en laisse une ligne qui bloquerait `delete from products`.
    await client.query("delete from cart_items where product_id = $1", [id]);
    await client.query("delete from product_availability where product_id = $1", [id]);
    await client.query("delete from product_calendar where product_id = $1", [id]);
    await client.query("delete from products where id = $1", [id]);
  });
}

test("un client réserve un alojamiento par plage de nuits, depuis la fiche produit jusqu'à la confirmation", async ({
  page,
}) => {
  await crearAlojamientoDePrueba({
    id: PRODUCT_ID,
    slug: SLUG,
    nombre: "E2E Alojamiento Reserve",
    capacity: 1,
  });

  await page.goto(`/es/productos/${SLUG}`);
  await page.waitForLoadState("networkidle");

  const checkIn = isoDate(2);
  const checkOut = isoDate(4); // 2 nuits
  await page.locator(`[data-date="${checkIn}"]`).click();
  await page.locator(`[data-date="${checkOut}"]`).click();

  await expect(page.getByTestId("lodging-estimated-price")).toContainText("400.000"); // 2 nuits × 200000 × qty 1

  await page.getByTestId("add-to-cart-button").click();
  await irAPagoTrasAgregar(page);
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("cart-total")).toContainText("400.000");

  await page.getByLabel("Nombre completo").fill("Cliente E2E Alojamiento");
  await page.getByRole("textbox", { name: "WhatsApp" }).fill("+573009998877");
  await page.getByLabel("Correo electrónico").fill(`cliente.e2e.alojamiento.${TIMESTAMP}@test.local`);
  // `redirectUrl` = le motif de l'écran de résultat (cf. `mockMercadoPagoCheckout`).
  const { redirectUrl } = await mockMercadoPagoCheckout(page);
  await page.getByTestId("submit-order-button").click();

  await page.waitForURL(redirectUrl, { timeout: 10000 });

  // Confirmation en base, au-delà de l'écran : ligne correcte + capacité réellement décrémentée
  // sur les nuits de la plage, checkout exclu.
  const state = await withDb(async (client) => {
    const { rows: lines } = await client.query(
      `select to_char(ol.date, 'YYYY-MM-DD') as date, to_char(ol.end_date, 'YYYY-MM-DD') as end_date,
              ol.qty, ol.total_cop
         from order_lines ol join orders o on o.id = ol.order_id
        where o.holder_name = 'Cliente E2E Alojamiento'`
    );
    const { rows: avail } = await client.query(
      `select to_char(date, 'YYYY-MM-DD') as date, booked from product_availability
        where product_id = $1 order by date`,
      [PRODUCT_ID]
    );
    return { lines, avail };
  });

  expect(state.lines).toHaveLength(1);
  expect(state.lines[0].date).toBe(checkIn);
  expect(state.lines[0].end_date).toBe(checkOut);
  expect(state.lines[0].qty).toBe(1);
  expect(String(state.lines[0].total_cop)).toBe("400000");
  const checkInRow = state.avail.find((r: { date: string }) => r.date === checkIn);
  const checkOutRow = state.avail.find((r: { date: string }) => r.date === checkOut);
  expect(checkInRow.booked).toBe(1);
  expect(checkOutRow.booked).toBe(0); // checkout exclusif, jamais consommé

  // Nettoyage — fixture dédiée, jamais partagée.
  await limpiarAlojamientoDePrueba(PRODUCT_ID, "Cliente E2E Alojamiento");
});

// Régression du 2026-09-16 (migration 20260916120000_fix_lodging_price_missing_qty) : qty désigne
// des unités facturables (lits/chambres selon lodgingKind), jamais des occupants — le total doit
// être multiplié par qty comme pour tout autre type de produit. Le test ci-dessus, à qty=1, ne peut
// structurellement pas distinguer cette formule d'un calcul qui ignorerait qty : les deux donnent le
// même résultat. Produit et dates dédiés (jamais partagés avec le scénario ci-dessus).
const PRODUCT_ID_QTY = "88950000-0000-4000-8000-000000000003";
const SLUG_QTY = `e2e-reserve-lodging-range-qty-${TIMESTAMP}`;

test("un client réserve un alojamiento par plage de nuits avec qty > 1 : le prix est multiplié par qty", async ({
  page,
}) => {
  await crearAlojamientoDePrueba({
    id: PRODUCT_ID_QTY,
    slug: SLUG_QTY,
    nombre: "E2E Alojamiento Reserve Qty",
    // capacité 2 (jamais 1 comme le scénario qty=1 ci-dessus) : nécessaire pour une ligne qty=2.
    capacity: 2,
    priceTiers: [
      { min_qty: 1, max_qty: 1, price_cop: 200000 },
      { min_qty: 2, max_qty: 4, price_cop: 150000 },
    ],
  });

  await page.goto(`/es/productos/${SLUG_QTY}`);
  await page.waitForLoadState("networkidle");

  // qty AVANT les dates (le champ est saisissable en premier, cf. LodgingReservationForm.tsx).
  await page.getByTestId("lodging-qty-input").fill("2");

  const checkIn = isoDate(2);
  const checkOut = isoDate(5); // 3 nuits
  await page.locator(`[data-date="${checkIn}"]`).click();
  await page.locator(`[data-date="${checkOut}"]`).click();

  // 3 nuits × 150 000 (palier qty=2) × qty 2 = 900 000 — jamais 450 000 (sans le facteur qty).
  await expect(page.getByTestId("lodging-estimated-price")).toContainText("900.000");

  await page.getByTestId("add-to-cart-button").click();
  await irAPagoTrasAgregar(page);
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("cart-total")).toContainText("900.000");

  await page.getByLabel("Nombre completo").fill("Cliente E2E Alojamiento Qty");
  await page.getByRole("textbox", { name: "WhatsApp" }).fill("+573009998877");
  await page.getByLabel("Correo electrónico").fill(`cliente.e2e.alojamiento.qty.${TIMESTAMP}@test.local`);
  const { redirectUrl } = await mockMercadoPagoCheckout(page);
  await page.getByTestId("submit-order-button").click();

  await page.waitForURL(redirectUrl, { timeout: 10000 });

  // Le prix réellement affiché (fiche + panier) doit coïncider avec celui réellement débité — la
  // preuve que ce test existe pour apporter, au-delà de la seule assertion pgTAP côté SQL.
  const state = await withDb(async (client) => {
    const { rows: lines } = await client.query(
      `select ol.qty, ol.price_cop, ol.total_cop
         from order_lines ol join orders o on o.id = ol.order_id
        where o.holder_name = 'Cliente E2E Alojamiento Qty'`
    );
    return { lines };
  });

  expect(state.lines).toHaveLength(1);
  expect(state.lines[0].qty).toBe(2);
  expect(String(state.lines[0].total_cop)).toBe("900000");
  expect(String(state.lines[0].price_cop)).toBe("450000"); // total_cop / qty, prix par unité

  await limpiarAlojamientoDePrueba(PRODUCT_ID_QTY, "Cliente E2E Alojamiento Qty");
});
