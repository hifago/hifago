import { test, expect, type Page } from "@playwright/test";
import {
  withDb,
  createPmsBackedEstablishmentFixture,
  mockPmsNightAvailability,
  nextMonthIsoDate,
  esperarRetornoTrasAgregar,
} from "@hifago/e2e-support";

// Spec 21 §13 (gap comblé) — GET /api/pms/night-availability alimente le calendrier d'un logement
// PMS-backed (Casa Kayam). Établissement DÉDIÉ créé dans ce test (jamais "Casa Kayam Guatapé" du
// seed, partagé par d'autres specs — AGENTS-PARALLELES.md point 5), via
// createPmsBackedEstablishmentFixture (packages/e2e-support/src/pms.ts). Mock au niveau
// page.route() (jamais le vrai LobbyPMS, même discipline que
// admin-establishment-pms-connector.spec.ts — spec 21 §10 point 1 : aucun test automatisé de ce
// projet ne doit jamais toucher le vrai LobbyPMS).
//
// ⚠️ RÉÉCRIT LE 2026-09-17, APRÈS AVOIR ÉTÉ ROUGE ET INERTE PENDANT NEUF JOURS. Deux défauts
// distincts, tous deux dans le TEST, aucun dans le produit :
//
//   1. Il testait un comportement SUPPRIMÉ le 2026-08-29. Le commit bccd9a8 (« une plage ne peut
//      plus enjamber une nuit pleine ») a rendu les jours au-delà d'une nuit pleine `disabled`
//      (lib/reservas/calendario.ts, phase 2 de `nocheDeshabilitada`). Le test, lui, continuait de
//      CLIQUER un de ces jours et d'attendre `range-unavailable-warning` — c'est-à-dire l'ancien
//      monde, où la plage fautive se formait puis était dénoncée après coup. Playwright attendait
//      donc indéfiniment qu'un bouton `disabled` devienne cliquable : 30 s, puis timeout. Le
//      « comportement attendu » était devenu inatteignable par construction, et personne ne
//      pouvait le voir puisque la suite e2e est en pause depuis le 2026-09-09.
//      ⚠️ Ne pas « réparer » ce fichier dans l'autre sens : l'avertissement n'a plus AUCUN chemin
//      pour s'afficher depuis un clic. C'est le but du correctif, pas une régression.
//
//   2. Il utilisait `isoDate(n)`, des décalages relatifs à aujourd'hui. Le calendrier d'une fiche
//      n'affiche QU'UN mois, et pour un PMS-backed il ouvre sur le mois COURANT de Guatapé : une
//      exécution dans les derniers jours du mois plaçait les dates visées hors de la grille, et le
//      sélecteur `[data-date]` échouait sans rien dire d'utile. Même piège que celui documenté
//      dans `seedDate` (packages/e2e-support/src/date.ts) — la parade est la même : travailler sur
//      un mois ENTIER et TOUJOURS futur, donc le mois suivant, atteint par un clic de navigation.
//
// La règle métier elle-même est désormais tenue au bon palier, en Vitest, où l'on peut l'éprouver
// par mutation : LodgingReservationForm.pms-enjambement.test.tsx (croisement PMS × nuit pleine ×
// plage qui l'enjambe, qui n'existait dans AUCUN test avant ce jour). Ce spec-ci ne prouve plus que
// le branchement écran réel — chargement, dégradation, reprise (CLAUDE.md §6.5, proportionnalité).
const TIMESTAMP = Date.now();
const SLUG = `e2e-reserve-lodging-pms-availability-${TIMESTAMP}`;
const LOBBY_CATEGORY_ID = 555000;

// Toutes les dates du test vivent dans le mois suivant, jamais en décalage relatif (voir défaut 2
// ci-dessus). Jours 5 à 10 : un mois a toujours au moins 28 jours, ils existent donc toujours.
const ARRIVEE = nextMonthIsoDate(5);
const NUIT_PLEINE = nextMonthIsoDate(6);
const APRES_LA_NUIT_PLEINE = nextMonthIsoDate(7);
const PLAGE_LIBRE_DEBUT = nextMonthIsoDate(8);
const PLAGE_LIBRE_FIN = nextMonthIsoDate(10);

const NUITS_MOCKEES = [
  { date: ARRIVEE, capacity: 2, booked: 0 },
  { date: NUIT_PLEINE, capacity: 0, booked: 0 },
  { date: APRES_LA_NUIT_PLEINE, capacity: 2, booked: 0 },
  { date: PLAGE_LIBRE_DEBUT, capacity: 2, booked: 0 },
  { date: nextMonthIsoDate(9), capacity: 2, booked: 0 },
  { date: PLAGE_LIBRE_FIN, capacity: 2, booked: 0 },
];

// Le calendrier ouvre sur le mois courant ; toutes nos dates sont au mois suivant. Cibler la classe
// react-day-picker plutôt que l'aria-label « Go to the Next Month » : le libellé est en anglais en
// dur dans la bibliothèque (cf. components/molecules/Calendar.tsx) et pourrait être traduit un jour,
// la classe vient de DEFAULT_CLASS_NAMES et est mergée telle quelle par packages/ui.
async function irAuMoisSuivant(page: Page) {
  await page.locator(".rdp-button_next").click();
  // Le changement de mois déclenche un nouveau fetch : attendre la donnée, pas juste le DOM.
  await expect(page.locator(`[data-date="${ARRIVEE}"]`)).toBeEnabled();
}

test("le calendrier d'un logement PMS-backed reflète la disponibilité Lobby, et se dégrade proprement si Lobby est injoignable", async ({
  page,
}) => {
  const partnerId = await withDb(async (client) => {
    const { rows } = await client.query("select partner_id from establishments where id = $1", [
      "b0000000-0000-4000-8000-000000000002",
    ]);
    return rows[0].partner_id as string;
  });

  const { establishmentId, productId } = await withDb((client) =>
    createPmsBackedEstablishmentFixture(client, {
      partnerId,
      establishmentName: `E2E PMS Availability ${TIMESTAMP}`,
      productName: "E2E Alojamiento PMS",
      slug: SLUG,
      priceCop: 200000,
      lobbyCategoryId: LOBBY_CATEGORY_ID,
    })
  );

  await mockPmsNightAvailability(page, { ok: true, nights: NUITS_MOCKEES });

  await page.goto(`/es/productos/${SLUG}`);
  await page.waitForLoadState("networkidle");
  await irAuMoisSuivant(page);

  // Nuit pleine chez Lobby → visuellement barrée (modifier "unavailable" appliqué à la cellule
  // <td>, cf. packages/ui/src/components/legacy-calendar.tsx — pas au <button> lui-même).
  await expect(page.locator(`td:has([data-date="${NUIT_PLEINE}"])`)).toHaveClass(/line-through/);

  // Une plage qui ENJAMBE la nuit pleine est désormais EMPÊCHÉE, plus dénoncée après coup
  // (2026-08-29). Une fois l'arrivée posée, tout ce qui est au-delà de la nuit pleine cesse d'être
  // cliquable — c'est ce que ce test affirme maintenant, et c'est ce que le produit fait.
  await page.locator(`[data-date="${ARRIVEE}"]`).click();
  await expect(page.locator(`[data-date="${APRES_LA_NUIT_PLEINE}"]`)).toBeDisabled();
  // Mais la nuit pleine elle-même reste une SORTIE valable : on dort jusqu'à la veille. C'est la
  // subtilité que les deux bibliothèques de calendrier ne savent pas exprimer (bornes hautes
  // inclusives), et la seule raison pour laquelle ce jour n'est pas simplement désactivé.
  await expect(page.locator(`[data-date="${NUIT_PLEINE}"]`)).toBeEnabled();
  // L'avertissement n'a plus aucun chemin pour s'afficher depuis un clic : le refus arrive AVANT
  // le choix. `toHaveCount(0)` et non `not.toBeVisible()` — il n'est pas caché, il n'existe pas.
  await expect(page.getByTestId("range-unavailable-warning")).toHaveCount(0);
  await expect(page.getByTestId("add-to-cart-button")).toBeDisabled();

  // Plage entièrement disponible (page rechargée = état frais) → ajout au panier fonctionne.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await irAuMoisSuivant(page);
  await page.locator(`[data-date="${PLAGE_LIBRE_DEBUT}"]`).click();
  await page.locator(`[data-date="${PLAGE_LIBRE_FIN}"]`).click();
  await expect(page.getByTestId("range-unavailable-warning")).toHaveCount(0);
  await expect(page.getByTestId("lodging-estimated-price")).toBeVisible();
  await page.getByTestId("add-to-cart-button").click();
  // Spec 28 Tranche 3 : l'ajout redirige désormais vers l'accueil (cahier §2b.5) — ce test
  // continue de tester LA MÊME fiche produit ensuite (scénario Lobby injoignable), il y revient
  // explicitement plutôt que d'enchaîner sur l'écran où le redirect vient de le déposer.
  await esperarRetornoTrasAgregar(page);
  await page.goto(`/es/productos/${SLUG}`);

  // Lobby injoignable → bandeau dégradé, bouton « réessayer », et surtout : aucune nuit n'est
  // SÉLECTIONNABLE. C'est le correctif du 2026-08-28 — auparavant le calendrier se laissait
  // cliquer normalement et n'annonçait le refus qu'après le choix des dates (défaut d'asymétrie
  // affichage/verdict), ce qui donnait l'impression d'un produit complet plutôt que d'une panne.
  await page.unroute("**/api/pms/night-availability**");
  await mockPmsNightAvailability(page, { ok: false, reason: "pms_unreachable" });
  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("pms-availability-error")).toBeVisible();
  await expect(page.getByTestId("pms-availability-retry")).toBeVisible();
  await expect(page.getByTestId("add-to-cart-button")).toBeDisabled();

  // Et la reprise fonctionne : redemander suffit à repeupler le calendrier, sans recharger la page.
  // Les échecs mesurés en préprod étaient transitoires — c'est exactement ce parcours-là.
  await page.unroute("**/api/pms/night-availability**");
  await mockPmsNightAvailability(page, { ok: true, nights: NUITS_MOCKEES });
  await page.getByTestId("pms-availability-retry").click();
  await expect(page.getByTestId("pms-availability-error")).not.toBeVisible();
  await irAuMoisSuivant(page);

  // Nettoyage — fixture dédiée, jamais partagée. La ligne ajoutée en phase 2 n'a jamais été
  // commandée (aucun checkout ici), donc rien côté `order_lines` — mais elle est bien dans
  // `cart_items` depuis que le panier vit en base (spec 32, 2026-09-10), et cette FK est en
  // NO ACTION : sans cette purge, le `delete from products` échoue en 23503. Mesuré le 2026-09-17,
  // cause de l'échec de ce fichier une fois ses assertions réparées.
  await withDb(async (client) => {
    await client.query("delete from cart_items where product_id = $1", [productId]);
    await client.query("delete from products where id = $1", [productId]);
    await client.query("delete from establishments where id = $1", [establishmentId]);
  });
});
