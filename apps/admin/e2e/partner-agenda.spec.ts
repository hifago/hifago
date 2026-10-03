import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import {
  createSignedInClient,
  webProductUrl,
  mockMercadoPagoCheckout,
  withDb,
  addDaysIso,
  daysInCurrentMonthInBogota,
  dayOfMonthInBogota,
  todayInBogota,
} from "@hifago/e2e-support";
import { slugify } from "../lib/utils";

// Spec 20 — agenda de réservations socio (remplace la page d'accueil /partner). Établissement/
// partenaire operadorPropuestas déjà utilisé ailleurs dans la suite (capacité operator ACTIVE
// scopée, cf. supabase/seed.sql), mais un produit DÉDIÉ à ce test — même précédent que
// partner-reservations.spec.ts (base locale non remise à zéro entre deux exécutions e2e).
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000004";
const PARTNER_ID = "b0000000-0000-4000-8000-000000000003";

// Date future dans le mois courant, DISPERSÉE selon `stamp` — la vue par défaut de l'agenda
// ("month") doit déjà l'afficher sans navigation. Une date fixe (ex. "demain") accumulerait les
// réservations de chaque exécution e2e successive sur LA MÊME cellule (base locale jamais remise
// à zéro entre deux runs, même précédent que partner-reservations.spec.ts) jusqu'à dépasser le
// nombre d'événements affichés par SVAR dans une cellule mensuelle chargée (repliés derrière un
// bouton "+N more") — constaté en développant ce test. Disperser sur le reste du mois courant
// évite la collision plutôt que de la découvrir en CI.
// Purge des résidus laissés par les runs PRÉCÉDENTS de ce fichier. Sans elle, ce test finit par
// se saboter tout seul — constaté le 2026-08-27, trois exécutions ayant suffi.
//
// La dispersion de `futureDateInCurrentMonth` ci-dessous n'y suffit pas, et la raison est
// arithmétique : elle répartit sur les jours RESTANTS du mois courant, or ce nombre fond à mesure
// qu'on avance. Le 27 août il vaut 4 — trois réservations résiduelles et la collision est quasi
// certaine, la cellule dépasse le nombre d'événements que SVAR affiche, et l'assertion de
// visibilité tombe sur un événement replié derrière « +N more ». Élargir la fenêtre ne ferait que
// reculer l'échéance ; c'est l'accumulation qu'il faut traiter.
//
// Purge par MOTIF de nom (les deux produits de ce fichier portent un timestamp), jamais par id
// figé : deux runs successifs n'ont pas les mêmes. Idempotente, et placée en beforeEach plutôt
// qu'en nettoyage de fin — un run qui échoue en cours de route ne nettoie rien, et c'est
// précisément le cas qui a produit l'accumulation.
const PRODUCT_NAME_PATTERN = "^(Actividad Agenda|Alojamiento Agenda PMS) E2E [0-9]+$";
const HOLDER_NAME_PATTERN = "^Cliente (Agenda|Walk-in|PMS Agenda|cancelled_by_client|expired|superseded) E2E [0-9]+$";

test.beforeEach(async () => {
  await withDb(async (client) => {
    const { rows } = await client.query(
      "select id from products where name->>'es' ~ $1",
      [PRODUCT_NAME_PATTERN]
    );
    const productIds = rows.map((row) => row.id as string);
    if (productIds.length === 0) return;

    // Les lignes d'abord : c'est elles qui retiennent tout le reste (ledger_entries les référence,
    // et une commande n'est purgeable qu'une fois orpheline).
    const { rows: lineRows } = await client.query(
      "select id, order_id from order_lines where product_id = any($1::uuid[])",
      [productIds]
    );
    const lineIds = lineRows.map((row) => row.id as string);
    const orderIds = [...new Set(lineRows.map((row) => row.order_id as string))];

    if (lineIds.length > 0) {
      await client.query("delete from ledger_entries where order_line_id = any($1::uuid[])", [lineIds]);
      await client.query("delete from order_lines where id = any($1::uuid[])", [lineIds]);
    }
    if (orderIds.length > 0) {
      // payments_order_id_fkey retient les commandes payées : même ordre que purgePaymentsThenOrders
      // (packages/e2e-support/src/db.ts). Les commandes encore référencées par une ligne survivante
      // (jamais le cas ici, mais la garde coûte une clause) sont laissées telles quelles.
      await client.query("delete from payments where order_id = any($1::uuid[])", [orderIds]);
      await client.query(
        `delete from orders o where o.id = any($1::uuid[])
           and not exists (select 1 from order_lines ol where ol.order_id = o.id)`,
        [orderIds]
      );
    }

    // Puis les tables filles du produit, avant le produit lui-même. `cart_items` compris : elle
    // référence products sans cascade, et ce parcours ajoute au panier avant le checkout — un run
    // interrompu en laisse une ligne, qui bloquait ensuite `delete from products` (FK
    // cart_items_product_id_fkey). Même liste que packages/e2e-support/src/cleanup.ts.
    for (const table of [
      "cart_items",
      "product_availability",
      "product_calendar",
      "product_date_rates",
      "product_media",
      "product_slot_availability",
      "product_slot_rules",
      "product_tag_assignments",
    ]) {
      await client.query(`delete from ${table} where product_id = any($1::uuid[])`, [productIds]);
    }
    await client.query("update product_proposals set product_id = null where product_id = any($1::uuid[])", [productIds]);
    await client.query("delete from products where id = any($1::uuid[])", [productIds]);

    // Enfin les commandes créées par le parcours checkout dont les lignes viennent d'être purgées
    // — rattrapage par titulaire, au cas où un run aurait laissé une commande sans ligne.
    const { rows: strayOrders } = await client.query(
      `select id from orders o where o.holder_name ~ $1
         and not exists (select 1 from order_lines ol where ol.order_id = o.id)`,
      [HOLDER_NAME_PATTERN]
    );
    const strayIds = strayOrders.map((row) => row.id as string);
    if (strayIds.length > 0) {
      await client.query("delete from payments where order_id = any($1::uuid[])", [strayIds]);
      await client.query("delete from orders where id = any($1::uuid[])", [strayIds]);
    }
  });
});

// Jour civil de GUATAPÉ depuis le lot fuseau (2026-08-28) : la version précédente lisait le jour du
// PROCESSUS (getDate/getMonth), donc celui d'UTC en CI — le 31 au soir, `offset` était calculé sur
// un mois déjà tourné et la date visée sortait du mois affiché par FullCalendar.
function futureDateInCurrentMonth(stamp: number): string {
  const remainingDays = Math.max(daysInCurrentMonthInBogota() - dayOfMonthInBogota(), 1);
  const offset = 1 + (stamp % remainingDays);
  return addDaysIso(todayInBogota(), offset);
}

test("un socio voit une réservation réelle dans son agenda, clique dessus pour ouvrir la fiche, marque une ausencia, puis ajoute une réservation manuelle", async ({
  page,
  context,
}) => {
  const stamp = Date.now();
  const productName = `Actividad Agenda E2E ${stamp}`;
  const holderName = `Cliente Agenda E2E ${stamp}`;
  const date = futureDateInCurrentMonth(stamp);

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: product, error: insertError } = await adminClient
    .from("products")
    .insert({
      partner_id: PARTNER_ID,
      establishment_id: ESTABLISHMENT_ID,
      type: "activity",
      name: { es: productName },
      price_cop: 45000,
      sellable: true,
      slug: slugify(productName),
    })
    .select("id")
    .single();
  if (insertError || !product) {
    throw new Error(`e2e setup: création du produit a échoué : ${insertError?.message}`);
  }
  const { data: availabilityResult, error: availabilityError } = await adminClient.rpc(
    "set_product_availability",
    { p_product_id: product.id, p_date: date, p_capacity: 5, p_open: true }
  );
  if (availabilityError || !(availabilityResult as { ok: boolean } | null)?.ok) {
    throw new Error(
      `e2e setup: ouverture de la disponibilité a échoué : ${availabilityError?.message ?? JSON.stringify(availabilityResult)}`
    );
  }

  // --- Client anonyme : réservation réelle, jamais via l'UI socio/admin (create_order) ---------
  await context.clearCookies();
  await page.goto(webProductUrl(slugify(productName)));
  await page.locator(`[data-date="${date}"]`).click();
  await expect(page.getByTestId("add-to-cart-button")).toBeEnabled();
  await page.getByTestId("add-to-cart-button").click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();
  await page.getByTestId("go-to-checkout-link").click();
  await expect(page).toHaveURL(/\/checkout$/);
  await page.locator('input[name="holder-name"]').fill(holderName);
  await page.locator('input[name="holder-phone"]').fill("+57 300 222 3344");
  await page.locator('input[name="holder-email"]').fill(`cliente.agenda.${stamp}@example.com`);
  // `redirectUrl` = le motif de l'écran de résultat (cf. `mockMercadoPagoCheckout`).
  const { redirectUrl } = await mockMercadoPagoCheckout(page);
  await page.getByTestId("submit-order-button").click();
  await page.waitForURL(redirectUrl);

  // --- Socio operator : voit la réservation dans son agenda (/partner, ex-page d'accueil) -------
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto("/partner");
  await page.waitForLoadState("networkidle");

  const eventLocator = page.getByText(`${productName} - ${holderName} - 1 pers.`, { exact: false });
  await expect(eventLocator).toBeVisible();
  await eventLocator.click();

  await expect(page).toHaveURL(/\/partner\/reservations\/.+/);
  await expect(page.getByTestId("reservation-detail-card")).toContainText(productName);
  await expect(page.getByTestId("reservation-detail-card")).toContainText(holderName);
  await expect(page.getByTestId("reservation-detail-status")).toContainText("Reservada");

  await page.getByTestId("detail-no-show-button").click();
  await page.waitForSelector('[data-testid="status-reason-input"]');
  await page.getByTestId("status-reason-input").fill("Cliente no llegó al punto de encuentro (e2e).");
  await page.getByTestId("confirm-status-button").click();
  await expect(page.getByTestId("reservation-detail-status")).toContainText("Ausencia");
  await expect(page.getByTestId("detail-no-show-button")).toHaveCount(0);

  // Spec 20 §10 point 9 (masqué/atténué par statut, jamais câblé jusqu'ici — bug trouvé en testant
  // manuellement, 2026-08-24) : no_show reste visible dans l'agenda (le créneau a réellement eu
  // lieu)...
  await page.goto("/partner");
  await page.waitForLoadState("networkidle");
  await expect(eventLocator).toBeVisible();

  // ...alors que cancelled_by_client/expired/superseded en sont masqués. Aucune action UI ne permet
  // d'atteindre ces 3 statuts sur une ligne de test à ce stade (cancelled_by_client/expired/
  // superseded proviennent tous d'un déclencheur qu'on ne peut pas simuler simplement ici : action
  // cliente, job cron, ou modify_order_line) — lignes créées proprement via create_manual_order_line
  // (comme le walk-in ci-dessous) puis statut posé directement en base via withDb (connexion
  // postgres directe, contourne RLS pour la SEULE préparation du fixture, même patron que
  // resetAvailability/deleteOrdersByHolderName dans packages/e2e-support/src/db.ts).
  const hiddenStatuses = ["cancelled_by_client", "expired", "superseded"] as const;
  const hiddenHolderNames: string[] = [];
  const operatorClient = await createSignedInClient(SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  for (const [index, status] of hiddenStatuses.entries()) {
    const hiddenHolderName = `Cliente ${status} E2E ${stamp}`;
    hiddenHolderNames.push(hiddenHolderName);
    const hiddenDate = futureDateInCurrentMonth(stamp + index + 1);
    const { data: hiddenAvailabilityResult, error: hiddenAvailabilityError } = await adminClient.rpc(
      "set_product_availability",
      { p_product_id: product.id, p_date: hiddenDate, p_capacity: 5, p_open: true }
    );
    if (hiddenAvailabilityError || !(hiddenAvailabilityResult as { ok: boolean } | null)?.ok) {
      throw new Error(
        `e2e setup: ouverture de la disponibilité a échoué (${status}) : ${hiddenAvailabilityError?.message ?? JSON.stringify(hiddenAvailabilityResult)}`
      );
    }
    const { data: manualResult, error: manualError } = await operatorClient.rpc(
      "create_manual_order_line",
      { p_product_id: product.id, p_date: hiddenDate, p_qty: 1, p_holder_name: hiddenHolderName }
    );
    if (manualError || !(manualResult as { ok: boolean } | null)?.ok) {
      throw new Error(
        `e2e setup: création manuelle a échoué (${status}) : ${manualError?.message ?? JSON.stringify(manualResult)}`
      );
    }
    const orderLineId = (manualResult as { order_line_id: string }).order_line_id;
    await withDb((client) =>
      client.query("update order_lines set status = $1 where id = $2", [status, orderLineId])
    );
  }

  await page.goto("/partner");
  await page.waitForLoadState("networkidle");
  for (const hiddenHolderName of hiddenHolderNames) {
    await expect(page.getByText(hiddenHolderName, { exact: false })).toHaveCount(0);
  }

  // --- Ajout manuel (walk-in) depuis l'agenda : bouton "Nueva reserva", create_manual_order_line -
  const manualHolderName = `Cliente Walk-in E2E ${stamp}`;
  await page.goto("/partner");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("new-reservation-button").click();
  await page.waitForSelector('[data-testid="manual-product-select"]');
  await page.getByTestId("manual-date-input").fill(date);
  await page.getByTestId("manual-product-select").click();
  await page.getByRole("option", { name: productName }).click();
  await page.getByTestId("manual-holder-name-input").fill(manualHolderName);
  await page.getByTestId("manual-qty-input").fill("2");
  await page.getByTestId("confirm-manual-reservation-button").click();

  // Pas une nouvelle recherche de l'événement dans la grille mensuelle (repose sur "Reserva
  // creada.", le toast de succès) : la journée de test accumule les réservations d'exécutions e2e
  // précédentes (base locale jamais remise à zéro, même précédent que partner-reservations.spec.ts)
  // — SVAR replie les événements en trop derrière un bouton "+N more" dans une cellule mensuelle
  // chargée, ce que positionOrderLines.test.ts couvre déjà unitairement (placement correct), pas
  // besoin de le reprouver ici au prix d'un test fragile au volume de données accumulé.
  await expect(page.getByRole("alertdialog").filter({ hasText: "Reserva creada." })).toBeVisible();
});

// C2 (spec 25) + agenda — ajouté le 2026-08-27 sur demande de Jérôme, après le test live du
// connecteur. Le test ci-dessus couvre une ACTIVITÉ ; celui-ci couvre le cas qui manquait, un
// LOGEMENT PMS-backed, et surtout le lien entre les deux mécanismes : une annulation doit à la fois
// retirer la réservation de l'agenda ET enfiler l'annulation chez LobbyPMS.
//
// C'est précisément l'angle qui aurait attrapé, depuis l'écran, le défaut trouvé en préprod le même
// jour : le trigger enfilait sur tout statut ≠ `reserved`, donc aussi sur `fulfilled` — hifago
// aurait demandé à Lobby d'annuler un séjour déjà effectué.
//
// La réservation est posée en base plutôt que par le parcours client : celui-ci est déjà couvert
// (test ci-dessus pour l'agenda, reserve-lodging-range/reserve-lodging-pms-availability pour le
// logement), et `pms_booking_id` est simulé — ce que ce test prouve, c'est la chaîne
// agenda ↔ statut ↔ file d'annulation, pas l'appel réseau à Lobby.
test("un logement PMS-backed apparaît dans l'agenda socio, et son annulation l'en retire ET enfile l'annulation LobbyPMS", async ({
  page,
  context,
}) => {
  const stamp = Date.now();
  const productName = `Alojamiento Agenda PMS E2E ${stamp}`;
  const holderName = `Cliente PMS Agenda ${stamp}`;
  const bookingId = `9${String(stamp).slice(-7)}`;
  const date = futureDateInCurrentMonth(stamp);
  const endDateIso = addDaysIso(date, 1);

  // Le trigger d'enfilement exige un établissement CONNECTÉ. Celui du socio de test ne l'est pas :
  // on l'active pour la durée du test, avec un jeton factice (aucun appel réseau n'est fait ici),
  // et on restaure à la fin — l'état d'un établissement partagé ne doit pas fuir vers les autres
  // specs.
  await withDb((client) =>
    client.query(
      "update establishments set lobby_connector_active = true, lobby_api_token = coalesce(lobby_api_token, 'e2e-fake-token') where id = $1",
      [ESTABLISHMENT_ID]
    )
  );

  try {
    const orderLineId = await withDb(async (client) => {
      const product = await client.query(
        `insert into products (partner_id, establishment_id, type, name, slug, sellable, price_cop,
                               capacity, unit_count, lodging_kind, lobby_category_id)
         values ($1, $2, 'lodging', $3::jsonb, $4, true, 120000, 2, 3, 'private', 29376)
         returning id`,
        [PARTNER_ID, ESTABLISHMENT_ID, JSON.stringify({ es: productName }), slugify(productName)]
      );
      const order = await client.query(
        `insert into orders (holder_name, holder_email, status) values ($1, $2, 'reserved') returning id`,
        [holderName, `cliente.pms.agenda.${stamp}@example.com`]
      );
      const line = await client.query(
        `insert into order_lines (order_id, product_id, status, qty, date, end_date, price_cop, total_cop,
                                  commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop,
                                  referrer_commission_cop, app_commission_cop, holder_name, pms_booking_id)
         values ($1, $2, 'reserved', 1, $3, $4, 120000, 120000, 'direct', 0.15, 0, 0.10, 18000, 0, 12000, $5, $6)
         returning id`,
        [order.rows[0].id, product.rows[0].id, date, endDateIso, holderName, bookingId]
      );
      return line.rows[0].id as string;
    });

    // --- L'agenda montre la réservation ---------------------------------------------------------
    await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
    await page.goto("/partner");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(holderName, { exact: false })).toBeVisible();

    // --- Un séjour TERMINÉ reste à l'agenda et n'enfile RIEN ------------------------------------
    // Le cas qui a été cassé en préprod : `fulfilled` n'est pas une annulation. La réservation doit
    // rester visible (le séjour a eu lieu) et LobbyPMS ne doit surtout pas être sollicité.
    await withDb((client) =>
      client.query("update order_lines set status = 'fulfilled' where id = $1", [orderLineId])
    );
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(holderName, { exact: false })).toBeVisible();
    expect(await pendingCancellations(bookingId)).toBe(0);

    // --- L'annulation la retire de l'agenda ET enfile l'annulation Lobby -----------------------
    await withDb((client) =>
      client.query("update order_lines set status = 'cancelled_by_client' where id = $1", [orderLineId])
    );
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(holderName, { exact: false })).toHaveCount(0);
    expect(await pendingCancellations(bookingId)).toBe(1);

    // Le statut hifago est conservé : il détermine le CODE de motif envoyé à Lobby (liste fermée
    // NS/RC/RE/TTC/CC/OTH — `cancelled_by_client` donne TTC).
    const queued = await withDb((client) =>
      client.query("select hifago_status from pms_cancellation_queue where pms_booking_id = $1", [bookingId])
    );
    expect(queued.rows[0].hifago_status).toBe("cancelled_by_client");
  } finally {
    await withDb((client) =>
      client.query("update establishments set lobby_connector_active = false where id = $1", [ESTABLISHMENT_ID])
    );
    await withDb((client) =>
      client.query("delete from pms_cancellation_queue where pms_booking_id = $1", [bookingId])
    );
  }
});

async function pendingCancellations(bookingId: string): Promise<number> {
  const result = await withDb((client) =>
    client.query("select count(*)::int as n from pms_cancellation_queue where pms_booking_id = $1", [bookingId])
  );
  return result.rows[0].n as number;
}
