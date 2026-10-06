import type { Page } from "@playwright/test";
import type pg from "pg";
import { randomUUID } from "node:crypto";

// Spec 21 §13 (gap comblé) — intercepte au niveau navigateur (page.route) UNIQUEMENT l'appel vers
// /api/pms/night-availability déclenché par LodgingReservationForm.tsx, jamais le vrai LobbyPMS.
// `nights` couvre le contrat réel de la route
// ({ ok: true, nights: [...] } ou { ok: false, reason }) — un test qui veut prouver le comportement
// du Route Handler lui-même (lecture service_role, parsing V2) utilise plutôt LOBBY_API_BASE_URL +
// pmsFixtureServer, jamais ce mock navigateur.
export async function mockPmsNightAvailability(
  page: Page,
  result: { ok: true; nights: { date: string; capacity: number; booked: number }[] } | { ok: false; reason: string }
): Promise<void> {
  await page.route("**/api/pms/night-availability**", async (route) => {
    await route.fulfill({
      status: result.ok ? 200 : 502,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
}

/**
 * Établissement PMS-backed dédié (jamais "Casa Kayam Guatapé" du seed, partagé — cf.
 * AGENTS-PARALLELES.md point 5 : une fixture e2e ne réutilise jamais un enregistrement seedé
 * partagé) : établissement + produit lodging avec lobby_category_id, connecteur actif, jeton
 * factice. Retourne les ids générés — jamais des UUID littéraux figés, pour qu'un run parallèle ne
 * collisionne jamais (même discipline que les autres fixtures de packages/e2e-support/src/db.ts).
 */
export async function createPmsBackedEstablishmentFixture(
  client: pg.Client,
  {
    partnerId,
    establishmentName,
    productName,
    slug,
    priceCop,
    lobbyCategoryId,
  }: {
    partnerId: string;
    establishmentName: string;
    productName: string;
    slug: string;
    priceCop: number;
    lobbyCategoryId: number;
  }
): Promise<{ establishmentId: string; productId: string }> {
  const establishmentId = randomUUID();
  const productId = randomUUID();

  await client.query(
    `insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token)
     values ($1, $2, $3, true, 'e2e-fake-token')`,
    [establishmentId, partnerId, JSON.stringify({ es: establishmentName })]
  );
  await client.query(
    `insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id)
     values ($1, $2, $3, 'lodging', $4, $5, true, $6, $7)`,
    [productId, partnerId, establishmentId, JSON.stringify({ es: productName }), priceCop, slug, lobbyCategoryId]
  );

  return { establishmentId, productId };
}
