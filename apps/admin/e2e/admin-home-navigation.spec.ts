import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createSignedInClient } from "@hifago/e2e-support";
import { getAdminNavItems } from "../app/admin/nav-items";
import { abrirFiltros } from "./support/filtros";

// Feature 27 (docs/specs/02-admin-accueil-et-navigation.md) — jusqu'ici /admin ne faisait qu'une
// redirection vide et aucune sidebar n'existait : plusieurs écrans étaient injoignables sans
// connaître leur URL. Invariant §8 de la spec : un item de sidebar ne pointe jamais vers une
// route inexistante — testé ici par navigation directe (pas .click()) sur chaque href, un flake
// de clic déjà documenté ailleurs dans ce repo (hifago/CLAUDE.md §11) ne doit pas polluer ce test
// précis, dont le seul objet est l'existence de la route.
// Dérivé de getAdminNavItems (source unique, cf. admin-mobile-nav.spec.ts) plutôt que recopié en
// dur — sinon un renommage/ajout de lien passe ce test sans jamais le faire échouer.
const SIDEBAR_ROUTES = getAdminNavItems(0).map((item) => item.href);

test("cada route de la sidebar resuelve sin 404", async ({ page, context }) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  for (const route of SIDEBAR_ROUTES) {
    const response = await page.goto(route);
    expect(response?.status(), `${route} debería responder 200`).toBe(200);
    await expect(page.getByTestId("admin-sidebar"), `${route} debería mostrar la sidebar`).toBeVisible();
  }
});

test("la sidebar surligne el enlace activo y un clic navega de verdad", async ({ page, context }) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin");

  await expect(page.getByTestId("sidebar-link--admin")).toHaveAttribute("aria-current", "page");

  await page.getByTestId("sidebar-link--admin-clients").click();
  await expect(page).toHaveURL(/\/admin\/clients$/);
  await expect(page.getByTestId("sidebar-link--admin-clients")).toHaveAttribute("aria-current", "page");
});

// Revue admin (Jérôme, 2026-08-20) — pastille "à faire" sur "Propuestas", même total que le
// bandeau AdminAlerts (product_proposals + establishment_proposals, status='pending'). Lu en base
// plutôt que fixturé (RPC-only en écriture, cf. layout.tsx — pas de moyen simple de forcer un
// total précis sans passer par le vrai flux socio de proposition) : robuste à l'état réel de
// l'instance locale partagée, jamais un nombre en dur.
test("la sidebar affiche une pastille avec le total de propuestas pendientes", async ({
  page,
  context,
}) => {
  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const [{ count: productPending }, { count: establishmentPending }] = await Promise.all([
    adminClient.from("product_proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    adminClient
      .from("establishment_proposals")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);
  const expectedCount = (productPending ?? 0) + (establishmentPending ?? 0);

  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin");

  if (expectedCount === 0) {
    await expect(page.getByTestId("sidebar-proposals-badge")).toHaveCount(0);
    return;
  }

  const badge = page.getByTestId("sidebar-proposals-badge");
  await expect(badge).toHaveText(String(expectedCount));
  // Depuis /admin (lien "Propuestas" inactif) : couleurs normales (NavBadge, inverted=false).
  await expect(badge).toHaveClass(/bg-danger/);

  // Retour Jérôme — sur la page portée par ce lien (/admin/proposals ou une fiche /admin/proposals/
  // [id]), la pastille inverse ses couleurs (fond blanc/texte rouge) : testé sur les deux formes de
  // route, isActive() (AdminSidebar.tsx) doit matcher l'une comme l'autre.
  await page.goto("/admin/proposals");
  await expect(page.getByTestId("sidebar-proposals-badge")).toHaveClass(/bg-white/);
  await expect(page.getByTestId("sidebar-proposals-badge")).not.toHaveClass(/bg-danger\b/);
});

test("inicio muestra los KPIs, las alertas y los 4 gráficos", async ({ page, context }) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin");

  await expect(page.getByTestId("kpi-revenue")).toBeVisible();
  await expect(page.getByTestId("kpi-commissions")).toBeVisible();
  await expect(page.getByTestId("kpi-establishments")).toBeVisible();
  await expect(page.getByTestId("kpi-pending-orders")).toBeVisible();

  await expect(page.getByTestId("chart-sales")).toBeVisible();
  await expect(page.getByTestId("chart-commissions")).toBeVisible();
  await expect(page.getByTestId("chart-top-partners")).toBeVisible();
  await expect(page.getByTestId("chart-catalog-health")).toBeVisible();

  // Comisiones toujours qualifiées "generadas" (constat 1 de la spec, jamais "a pagar" tant que
  // le ledger n'existe pas côté hifago) — invariant explicite §8, vérifié dans le libellé réel.
  await expect(page.getByTestId("kpi-commissions")).toContainText("Comisiones generadas");

  // Bloc « Procesos », PERMANENT : la RPC admin_jobs_status répond (jamais « no disponible » pour
  // un admin) et chaque job attendu a sa ligne. Agnostique de l'état : en local, les Edge Functions
  // ne tournent pas, les jobs sont donc « sin latido » ou « con retraso » selon l'âge de la base.
  await expect(page.getByTestId("jobs-status")).toBeVisible();
  await expect(page.getByTestId("jobs-status-summary")).toBeVisible();
  await expect(page.getByTestId("jobs-status-unavailable")).toHaveCount(0);
  await expect(page.getByTestId("job-row-payments-reconcile")).toBeVisible();
});

test("ventana de 90 días cambia la URL y sigue renderizando los gráficos", async ({ page, context }) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin");

  await page.getByTestId("window-90").click();
  await expect(page).toHaveURL(/\/admin\?window=90$/);
  await expect(page.getByTestId("chart-sales")).toBeVisible();
});

test("clientes: filtro unifié nom/email, pagination, clic vers la fiche détail", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/clients");

  await expect(page.getByTestId("pagination")).toBeVisible();

  // Revue admin clientes (Jérôme, 2026-08-19) — migré du Table brut fait main vers DataList/
  // ServerFilters (comme établissements) : plus de champ "email" séparé, un seul champ q cherche
  // déjà nom ET email côté RPC (list_clients).
  // Filtres repliés par défaut (chevron) depuis la refonte responsive mobile — ouvrir avant d'y
  // interagir, sinon les champs sont `hidden` (Disclosure, packages/ui/data-list.tsx).
  await abrirFiltros(page);
  await page.getByTestId("filter-q").fill("Cliente Referido");
  await page.getByTestId("server-filters-submit").click();
  await expect(page).toHaveURL(/\?q=Cliente\+Referido/);
  const rows = page.locator('[data-testid^="client-row-"]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Cliente Referido Seed");

  // Un clic depuis la liste amène sur UNE page qui consolide infos personnelles + infos de
  // paiement + activités rattachées — jamais construit avant ce lot (objectif central de la
  // refonte, ni en V1 ni en V2 il n'existait de fiche détail client).
  await page.getByTestId(/^client-detail-link-/).click();
  await expect(page).toHaveURL(/\/admin\/clients\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Cliente Referido Seed" })).toBeVisible();
  await expect(page.locator('[data-testid^="client-order-"]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="payment-status-"]').first()).toBeVisible();

  // Revue admin clientes (Jérôme, 2026-08-20) — présent en V1 (le clic sur un client y ouvrait
  // directement un fil WhatsApp), manquait sur cette fiche V2. ContactClientButton.tsx est déjà
  // testé/utilisé côté socio (ReservationActions.tsx) — ici on vérifie seulement le branchement
  // (bon téléphone/email seedés, cf. seed.sql "Cliente Referido Seed"), pas sa logique interne.
  await expect(page.getByTestId("contact-client-whatsapp")).toHaveAttribute(
    "href",
    /^https:\/\/wa\.me\/573000000002\?text=/,
  );
  await expect(page.getByTestId("contact-client-email")).toHaveAttribute(
    "href",
    "mailto:cliente.referido.seed@test.local",
  );

  // Filtre "sin resultados" avec un texte sans correspondance → état vide explicite, pas un
  // tableau resté sur l'ancien résultat (cas limite §9 de la spec, comportement conservé).
  await page.goto("/admin/clients?q=no-existe-en-absoluto-1787199999999");
  await expect(page.getByText("Ningún cliente todavía.")).toBeVisible();
});

test("las listas paginadas ya existentes tienen los controles de paginación", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  for (const route of ["/admin/partners", "/admin/establishments", "/admin/orders", "/admin/products", "/admin/clients"]) {
    await page.goto(route);
    await expect(page.getByTestId("pagination"), `${route} debería paginar`).toBeVisible();
  }
});
