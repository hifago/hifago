import { test, expect } from "@playwright/test";
import { seedDate, withDb } from "@hifago/e2e-support";

// Spec 42 — un evento NON réservable en ligne se note dans Mi viaje, sans réservation. Le chemin
// heureux, bout en bout, contre la vraie base : session anonyme créée au premier ajout, insert sous
// la RLS de `trip_events`, lecture jointe de `/mi-viaje`, retrait. Les variantes (doublon, date
// passée, date qui n'est plus une occurrence, ordre mêlé aux réservations) sont en Vitest et pgTAP.
//
// Fixture créée ici, slug horodaté : le nettoyage de fin de suite la reconnaît, et `trip_events`
// part avec le produit (`on delete cascade`). Rattachée à l'établissement d'un produit déjà publié,
// quel qu'il soit : la base locale vient du seed OU de mockData, aucun identifiant fixe n'est sûr.
const FECHA = seedDate(12);
const SLUG = `evento-sin-reserva-${Date.now()}`;
const NOMBRE = `Concierto e2e ${SLUG}`;

test.beforeAll(async () => {
  await withDb((db) =>
    db.query(
      `insert into public.products
         (partner_id, establishment_id, type, name, sellable, slug, occurrence_type, occurrence_date)
       select partner_id, establishment_id, 'evento', jsonb_build_object('es', $1::text), true, $2, 'once', $3::date
         from public.products where sellable order by created_at limit 1`,
      [NOMBRE, SLUG, FECHA]
    )
  );
});

test("un evento non réservable s'ajoute à Mi viaje sans réservation, puis se retire", async ({ page }) => {
  await page.goto(`/es/productos/${SLUG}`);
  await page.waitForLoadState("networkidle");

  await page.locator(`[data-date="${FECHA}"]`).click();
  await page.getByTestId("add-trip-event-button").click();
  // Même retour que l'evento réservable : les hébergements de cette nuit.
  await page.waitForURL(/\/alojamientos/);

  await page.goto("/es/mi-viaje");
  const fila = page.locator('li[data-testid^="trip-event-"]');
  await expect(fila).toHaveCount(1);
  await expect(fila).toContainText(NOMBRE);
  await expect(fila.locator('[data-testid^="trip-event-badge-"]')).toHaveText("Sin reserva");
  // Rien à payer : ni total ni « Reservar ».
  await expect(page.getByTestId("cart-total")).toHaveCount(0);
  await expect(page.getByTestId("go-to-checkout")).toHaveCount(0);

  await fila.locator('[data-testid^="remove-trip-event-"]').click();
  await expect(page.getByTestId("empty-cart")).toBeVisible();
});
