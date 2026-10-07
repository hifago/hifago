import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import {
  confirmAndContinue,
  createActiveOperatorEstablishment,
  createSignedInClient,
  goToNextWizardStep,
  selectValue,
  switchInput,
  toggleSwitch,
} from "@hifago/e2e-support";
import { abrirFiltros } from "./support/filtros";

test("admin gère le registre d'un partenaire : capacité, statut, transfert, code", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  // Établissement dédié à ce test — nom unique par run, jamais un établissement déjà partagé par
  // d'autres tests e2e. Rattaché à "Opérateur Actif Org" au départ (peu importe qui), transféré
  // plus bas.
  const establishmentName = `Establecimiento Transfer Test ${Date.now()}`;
  await page.goto("/admin/establishments/new");
  // Assistant par étapes (docs/specs/40) — étape 1 "Propietario y gestión" (partner), étape 2
  // "Detalles" (nombre).
  await page.getByTestId("partner-search").click();
  await page.getByRole("option", { name: /Opérateur Actif/ }).click();
  await goToNextWizardStep(page);
  await page.locator('input[name="nombre"]').fill(establishmentName);
  await page.getByTestId("create-establishment-button").click();
  await confirmAndContinue(page, "establishment-form-confirmation");
  await expect(page).toHaveURL(/\/admin\/establishments$/);

  // Ouvre la fiche de "Référent Actif Org" — capacité referrer seule au départ (seedée). Filtré
  // par nom (pas une simple recherche dans la 1re page) : 33 partenaires accumulés localement sans
  // reset entre runs poussent ce partenaire seedé ancien hors de la 1re page (20 par défaut),
  // aléa déjà documenté ailleurs dans ce projet pour d'autres listes (accumulation de données).
  await page.goto("/admin/partners");
  // Filtres repliés par défaut (chevron) depuis la refonte responsive mobile — ouvrir avant d'y
  // interagir, sinon les champs sont `hidden` (Disclosure, packages/ui/data-list.tsx).
  await abrirFiltros(page);
  await page.getByTestId("filter-q").fill("Référent Actif Org");
  await page.getByTestId("server-filters-submit").click();
  const partnerRow = page.locator("tr", { hasText: "Référent Actif Org" });
  await partnerRow.getByRole("link", { name: "Ver" }).click();
  await expect(page).toHaveURL(/\/admin\/partners\/.+/);

  // Accorder une capacité operator "en attente" (establishment_id null, choix par défaut du
  // sélecteur d'établissement), que le transfert ci-dessous rattache à l'établissement transféré
  // (transfer_establishment, 20261006182227) : un run complet ne laisse donc jamais de ligne en
  // attente. L'index partiel n'en admet qu'une par partenaire (correctif Tranche 1) : si un run
  // interrompu entre les deux gestes en a laissé une, l'octroi est sauté et c'est elle que ce run
  // rattache.
  const capabilitiesTable = page.getByTestId("capabilities-table");
  await expect(capabilitiesTable).toBeVisible();
  const pendingOperatorRow = capabilitiesTable
    .locator("tr", { hasText: "operator" })
    .filter({ has: page.locator('[data-label="Establecimiento"]', { hasText: /^—$/ }) });
  if ((await pendingOperatorRow.count()) === 0) {
    await page.getByTestId("grant-role-select").click();
    await page.getByRole("option", { name: "operator" }).click();
    await page.getByTestId("grant-capability-button").click();
  }
  await expect(pendingOperatorRow).toHaveCount(1);

  // Transférer l'établissement fraîchement créé vers ce partenaire — jamais en un clic : la
  // confirmation nomme le propriétaire actuel (cahier admin §3d).
  await page.getByTestId("transfer-establishment-search").click();
  await page.getByRole("option", { name: new RegExp(establishmentName) }).click();
  await page.getByTestId("transfer-establishment-button").click();
  await expect(page.getByTestId("transfer-establishment-confirmation")).toContainText("Opérateur Actif");
  await page.getByTestId("confirm-transfer-establishment-button").click();
  await expect(
    page.getByTestId("own-establishments-table").getByText(establishmentName)
  ).toBeVisible();

  // La ligne en attente est désormais scopée à CET établissement (nom unique par run — après
  // plusieurs runs sans reset, plusieurs lignes operator coexistent légitimement, une par
  // établissement) ; la ligne referrer (déjà existante) reste visible à côté.
  const operatorRow = capabilitiesTable.locator("tr", { hasText: establishmentName });
  await expect(operatorRow).toBeVisible();
  await expect(operatorRow).toContainText("operator");
  await expect(pendingOperatorRow).toHaveCount(0);
  await expect(capabilitiesTable.getByText("referrer")).toBeVisible();
  // Trigger HeroUI Select : role="button" + aria-haspopup="listbox" (pattern React Aria), pas
  // role="combobox" (pattern de l'ancien socle base-ui/shadcn) — vérifié sur le DOM réel. Ciblé
  // par le testid déjà posé par CapabilitiesSection.tsx (scopé à la ligne, id inconnu ici), pas
  // par rôle+libellé traduit — les deux casseraient au moindre changement de wording/rôle.
  await operatorRow.getByTestId(/^capability-status-select-/).click();
  await page.getByRole("option", { name: "suspended" }).click();
  await expect(selectValue(operatorRow)).toContainText("suspended");

  // Désactiver puis réactiver un code d'attribution du partenaire — bascule vers l'état opposé au
  // départ, jamais une valeur fixe attendue (la base locale n'est pas remise à zéro entre deux
  // exécutions e2e, cf. la même précaution déjà prise pour le prix en feature 3), PUIS retour à
  // l'état de départ : SEED-REFACTIVE est un code du seed dont d'autres parcours dépendent, un run
  // ne doit jamais le laisser désactivé (et les deux sens de la bascule sont ainsi prouvés).
  const codeSwitchRoot = page.getByTestId("code-active-switch-SEED-REFACTIVE");
  const codeSwitch = switchInput(codeSwitchRoot);
  const wasChecked = await codeSwitch.isChecked();
  // isSelected est piloté par le prop serveur (code.active), pas d'état local optimiste — le
  // changement visible attend le aller-retour RPC + router.refresh(), plus lent qu'un simple
  // clic client ; délai plus généreux que le défaut pour ne pas confondre lenteur et régression.
  await toggleSwitch(codeSwitchRoot);
  await expect(codeSwitch).toBeChecked({ checked: !wasChecked, timeout: 10000 });
  await toggleSwitch(codeSwitchRoot);
  await expect(codeSwitch).toBeChecked({ checked: wasChecked, timeout: 10000 });
});

// Refonte responsive mobile (SimpleTable, packages/ui) — test dédié plutôt qu'un ajout en fin du
// test ci-dessus : celui-ci dépend du sélecteur "transfer-establishment-search"
// (SearchableCombobox), déjà flaky indépendamment de ce lot ("element was detached from the DOM",
// reproduit 3/3 tentatives, jamais touché par cette refonte — apps/admin/components/
// searchable-combobox.tsx intact). Fixture via createActiveOperatorEstablishment (RPC, même
// chemin que partner-establishment-proposals.spec.ts) plutôt que le flux UI de transfert — isole
// la seule chose à vérifier ici : le reflow carte de capabilities-table à 390×844
// (.claude/skills/hifago-ui/SKILL.md) et l'opérabilité réelle du <Select> de statut dans une
// cellule repliée (pas seulement visible, un changement réel de valeur).
test("à 390×844, capabilities-table reflow en cartes et le Select de statut reste opérable", async ({
  page,
  context,
}) => {
  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const establishmentName = `Establecimiento Mobile Reflow Test ${Date.now()}`;
  // "b0000000-0000-4000-8000-000000000003" : même partenaire seedé déjà utilisé pour ce besoin par
  // partner-establishment-proposals.spec.ts (fixture dédiée, jamais partagée avec un autre test).
  const establishmentId = await createActiveOperatorEstablishment(
    adminClient,
    "b0000000-0000-4000-8000-000000000003",
    establishmentName
  );
  const { data: capability } = await adminClient
    .from("partner_capabilities")
    .select("id, partner_id")
    .eq("establishment_id", establishmentId)
    .eq("role", "operator")
    .single();

  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/partners/${capability!.partner_id}`);

  const capabilitiesTable = page.getByTestId("capabilities-table");
  await expect(capabilitiesTable.locator('[data-slot="table-header"]')).not.toBeVisible();
  const operatorRow = capabilitiesTable.locator("tr", { hasText: establishmentName });
  await expect(operatorRow).toBeVisible();
  await expect(operatorRow).toContainText("operator");

  await operatorRow.getByTestId(/^capability-status-select-/).click();
  await page.getByRole("option", { name: "suspended" }).click();
  await expect(selectValue(operatorRow)).toContainText("suspended");
});
