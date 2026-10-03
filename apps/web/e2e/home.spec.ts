import { test, expect, type Page } from "@playwright/test";
import { seedDate } from "@hifago/e2e-support";

// L'ACCUEIL DE LA VITRINE, QUI EST AUSSI L'ÉCRAN DE RÉSULTATS (spec 28, Tranche 1 — lot D,
// 2026-09-08). Premier spec e2e de cet écran : jusqu'ici il n'était traversé qu'en passant, par
// les six specs qui « entrent par l'accueil » pour atteindre une fiche produit.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QU'IL PROUVE, ET POURQUOI ÇA NE PEUT PAS SE PROUVER PLUS BAS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Le cœur de cet écran n'est pas du rendu : c'est un ALLER-RETOUR. Le visiteur tape, l'URL change,
// le SERVEUR re-rend d'autres sections (spec 28 §0, invariant 10 : « les critères de l'URL sont les
// seuls qui filtrent »). Trois couches doivent s'accorder pour ça — `BuscadorInicio` qui pousse
// l'URL, `leerCriterios` qui la relit, et `search_catalog` qui filtre en SQL. Un test composant en
// voit exactement une ; seul un e2e voit qu'elles parlent de la même chose.
//
// Le reste (formatage du prix, texte alternatif, classes de grille) est couvert par les tests
// composant à côté de chaque fichier — rien n'est re-prouvé ici.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LES SÉLECTEURS, ET D'OÙ ILS VIENNENT
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
//   `seccion-<tipo>`            posé par `page.tsx` sur `SeccionOfertas`
//   `seccion-<tipo>-titulo`     dérivé par `SeccionOfertas` (l'atome `Title`, en <h2>)
//   `seccion-<tipo>-ver-mas`    dérivé par `SeccionOfertas` (le lien de bas de section)
//   `tarjeta-<slug>`            posé par `lib/catalog/buscar.ts` sur CHAQUE carte
//   `tarjeta-<slug>-link`       dérivé par l'atome `Card` sur le lien du TITRE
//   `estado-vacio`              posé par `page.tsx` sur `EstadoVacio`
//   `buscador-bar-input`        `BuscadorInicio` → `SearchPanel` → `SearchBar` (défaut « buscador »)
//
// ⚠️ `tarjeta-<slug>-link` REMPLACE `catalog-link-<slug>`, disparu avec `CatalogBrowser`. Le lien
// est celui du TITRE et non un `<a>` enveloppant toute la carte : c'est le motif « stretched link »
// documenté en tête de `components/atoms/Card.tsx`, dont l'overlay `::after` rend malgré tout
// toute la surface cliquable.
//
// ⚠️ LA BARRE SE SOUMET PAR `Entrée`, JAMAIS PAR SON BOUTON. Contrat de `SearchBar` : `Entrée`
// soumet TOUJOURS le texte tapé tant qu'aucune suggestion n'est ACTIVE — c'est-à-dire tant qu'on
// n'est pas descendu dessus aux flèches. Depuis la Tranche 2 la liste n'est plus vide, mais la
// règle tient : à l'ouverture aucune option n'est présélectionnée, `Entrée` cherche donc toujours
// le texte tapé (c'est le défaut de getyourguide que `SearchBar` corrige, cf. son en-tête). Le
// bouton « Buscar », lui, est `sr-only` sous `md` : le cliquer
// ferait dépendre ce spec de la largeur du viewport, alors que la touche de validation est le seul
// chemin disponible sur mobile. On teste donc le chemin universel.
//
// ⚠️ CE SPEC N'ÉCRIT RIEN EN BASE — aucune commande, aucune disponibilité touchée, donc aucun
// `resetAvailability` et aucun `mode: "serial"` : ses tests sont lisibles en parallèle et ne se
// disputent aucune ressource. C'est aussi pour ça qu'ils n'affirment jamais un NOMBRE de cartes ou
// de sections : la base locale est partagée avec les autres agents et les autres specs, qui y
// créent et suppriment des produits en permanence. On affirme des offres NOMMÉES, présentes ou
// absentes.

// Les deux activités vendables du seed. « kayak » est le mot qui les sépare : il est dans le nom de
// l'une et dans aucun champ cherché de l'autre (ni son nom, ni son établissement « Casa Kayam
// Guatapé » — « Kayam » n'est pas « kayak » —, ni ses tags).
const ACTIVIDAD_KAYAK = "kayak-embalse-guatape";
const ACTIVIDAD_LANCHA = "tour-lancha-guatape";

// L'établissement à DEUX couchages vendables du seed, donc la carte GROUPÉE (`search_catalog`,
// CTE `conteo_alojamientos`, seuil `n_alojamientos >= 2`). Son second couchage —
// `cama-dormitorio-compartido-demo`, 65 000 COP — a été ajouté au seed par ce même lot : avant lui
// aucun établissement n'en avait deux, et cette carte ne pouvait pas exister.
const ESTABLECIMIENTO_AGRUPADO = "casa-kayam-guatape";
const COUCHAGE_PMS = "alojamiento-pms-backed-demo";
const COUCHAGE_DORTOIR = "cama-dormitorio-compartido-demo";
// Le MINIMUM des deux couchages vendables (65 000 < 100 000) — c'est lui que « Desde » annonce.
const PRECIO_DESDE_ESPERADO = 65000;

// Une requête qui ne peut correspondre à rien : ni un nom d'offre, ni un nom d'établissement, ni un
// libellé de tag. Volontairement improbable plutôt que courte — « xyz » finirait par matcher le
// jour où un produit de test s'appelle ainsi.
const BUSQUEDA_SIN_RESULTADO = "zzz-ninguna-oferta-existe-2026";

/**
 * Va à l'accueil et attend que l'écran soit RÉELLEMENT prêt.
 *
 * ⚠️ `networkidle` n'est pas de la prudence décorative : l'accueil monte un bloc de recherche
 * client (`BuscadorInicio` → `SearchPanel` → un `ComboBox` react-aria). Sans cette attente, la
 * première frappe peut atteindre le DOM avant que React n'ait attaché ses gestionnaires — la
 * valeur est perdue, `Entrée` ne fait rien, et le test échoue sans aucune erreur exploitable
 * (`.claude/rules/tests.md`, « écran client-heavy après une navigation »).
 */
async function irAlInicio(page: Page, query = "") {
  const response = await page.goto(`/es${query}`);
  await page.waitForLoadState("networkidle");
  return response;
}

/**
 * Tape une recherche, la soumet par `Entrée`, puis attend l'URL poussée ET le re-rendu serveur.
 *
 * ⚠️ Une `RegExp` et jamais un motif glob : dans un glob Playwright, `?` est un caractère spécial —
 * `**\/es?q=kayak` ne décrit donc pas l'URL qu'on croit. On échappe les métacaractères du texte
 * cherché pour la même raison : c'est une donnée, pas un motif.
 */
async function buscar(page: Page, texto: string) {
  const campo = page.getByTestId("buscador-bar-input");
  await campo.fill(texto);
  await campo.press("Enter");
  const esperado = encodeURIComponent(texto).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.waitForURL(new RegExp(`/es\\?q=${esperado}$`));
  await page.waitForLoadState("networkidle");
}

test("l'accueil rend plusieurs sections, activités d'abord, chacune avec son <h2> et son « Ver más »", async ({
  page,
}) => {
  await irAlInicio(page);

  // ⚠️ INVARIANT DE LA SPEC 28 (§0.3) : un seul <h1> dans toute la page. Masqué visuellement à
  // l'origine, il est VISIBLE depuis la maquette du 2026-10-02 (« Guatapé merece más de un día. ») ;
  // `toHaveCount` + `textContent` restent valables dans les deux cas.
  await expect(page.locator("h1")).toHaveCount(1);
  expect(((await page.locator("h1").textContent()) ?? "").trim().length).toBeGreaterThan(0);

  // L'ORDRE des sections est `ORDEN_SECCIONES` : les activités d'abord (cahier §2a). On lit la
  // position réelle dans le document plutôt qu'un nombre de sections : la base locale est partagée,
  // un produit `transport` créé par une autre spec au même instant ferait apparaître une sixième
  // section — ça ne doit pas rougir ce test, qui porte sur l'ordre, pas sur l'inventaire.
  const idsSecciones = await page
    .locator("main section[data-testid]")
    .evaluateAll((nodos) => nodos.map((n) => n.getAttribute("data-testid")));
  expect(idsSecciones.length).toBeGreaterThanOrEqual(2);
  expect(idsSecciones[0]).toBe("seccion-activity");
  expect(idsSecciones).toContain("seccion-lodging");

  // Chaque section porte un vrai <h2> — c'est ce qui garantit la hiérarchie sans saut sous le <h1>
  // masqué, et c'est une décision de la PAGE (l'atome `Title` exige `as`, il ne le devine jamais).
  for (const tipo of ["activity", "lodging"]) {
    const titulo = page.getByTestId(`seccion-${tipo}-titulo`);
    await expect(titulo).toBeVisible();
    expect(await titulo.evaluate((el) => el.tagName)).toBe("H2");
  }

  // Le « Ver más » emmène vers la page de listing du type, via la table `lib/catalog/segmentos.ts`
  // (URL en espagnol dans les deux locales) et le `Link` de `@/i18n/navigation`, seul à conserver
  // le préfixe de langue. ⚠️ Celui des activités mène à un INDEX DE TAGS (spec 29) et porte donc un
  // autre libellé — la cible, elle, suit la même table.
  //
  // ⚠️ SEULE l'ACTIVITÉ est vérifiée ici, et c'est voulu (2026-09-14, bug signalé par Jérôme) :
  // depuis que `mostrarVerMas` conditionne le lien à `total > tarjetas.length` (une section ne
  // promet plus « Ver más » quand elle montre déjà tout — sinon le lien mène à une page qui
  // affiche EXACTEMENT les mêmes cartes), un type dont le catalogue local ne dépasse pas
  // `POR_SECCION` (8) ne rend simplement PLUS ce lien — ce n'est plus assertable sans contrôler le
  // volume de données. Le « Ver más » des activités reste, lui, INCONDITIONNEL par construction
  // (labelVerMas ci-dessus) : c'est le seul type sûr d'après le seed local (>8 offres). La
  // construction du href pour un autre type ne dépend que de la table testée dans
  // `segmentos.test.ts` (`segmentoDeTipo`) — pas besoin de la reprouver ici pour un type dont le
  // compte fluctue.
  //
  // ⚠️ `-link` : depuis le carrousel de l'accueil (2026-09-14), « Ver más » est une CARTE (`Card`),
  // dont le `href` est porté par le lien interne `${testId}-link` (`atoms/Card.tsx`), jamais par la
  // racine de la carte. Viser la racine faisait rougir ce test sans que le lien soit cassé.
  await expect(page.getByTestId("seccion-activity-ver-mas-link")).toHaveAttribute(
    "href",
    "/es/actividades"
  );
});

test("cliquer une carte mène à la fiche de l'offre correspondante", async ({ page }) => {
  await irAlInicio(page);

  // Le lien du TITRE, pas la carte : c'est lui le vrai `<a href>` (motif « stretched link »,
  // cf. `atoms/Card.tsx`). Cliquer la carte marcherait aussi — son overlay recouvre la surface —
  // mais viser le lien dit ce qu'on teste : une navigation, pas un `onClick`.
  await page.getByTestId(`tarjeta-${ACTIVIDAD_LANCHA}-link`).click();

  await expect(page).toHaveURL(new RegExp(`/es/productos/${ACTIVIDAD_LANCHA}$`));
  await expect(page.getByTestId("product-name")).toBeVisible();
});

// Bug Jérôme du 2026-09-16 : revenir au catalogue depuis une fiche effaçait la recherche en cours.
// `FichaProducto.tsx` ne peut PAS lire cette recherche depuis son URL (la fiche ne porte jamais les
// critères — spec 28 §4) : elle passe par la mémoire `sessionStorage` que `BuscadorInicio` tient à
// jour à chaque visite (`lib/catalog/ultimosCriterios.ts`), relue au montage du lien de retour.
test("revenir au catalogue depuis une fiche conserve la recherche en cours", async ({ page }) => {
  await irAlInicio(page);
  await buscar(page, "kayak");

  await page.getByTestId(`tarjeta-${ACTIVIDAD_KAYAK}-link`).click();
  await expect(page).toHaveURL(new RegExp(`/es/productos/${ACTIVIDAD_KAYAK}$`));

  await page.getByTestId("volver-al-catalogo").click();
  await page.waitForURL(/\/es\?q=kayak$/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId(`tarjeta-${ACTIVIDAD_KAYAK}`)).toBeVisible();
});

test("une recherche par texte pousse les critères dans l'URL et le serveur re-rend des résultats filtrés", async ({
  page,
}) => {
  await irAlInicio(page);

  // Avant : les deux activités sont là. C'est la moitié du test qui manque le plus souvent — sans
  // elle, un filtre qui ne renverrait JAMAIS rien passerait pour un filtre qui marche.
  await expect(page.getByTestId(`tarjeta-${ACTIVIDAD_KAYAK}`)).toBeVisible();
  await expect(page.getByTestId(`tarjeta-${ACTIVIDAD_LANCHA}`)).toBeVisible();

  await buscar(page, "kayak");

  // L'offre attendue est là, celle d'un autre nom n'y est plus. `toHaveCount(0)` et non
  // `not.toBeVisible()` : la spec dit que la carte n'est pas RENDUE, pas qu'elle est cachée.
  await expect(page.getByTestId(`tarjeta-${ACTIVIDAD_KAYAK}`)).toBeVisible();
  await expect(page.getByTestId(`tarjeta-${ACTIVIDAD_LANCHA}`)).toHaveCount(0);

  // ⚠️ Et la SECTION entière disparaît, parce qu'aucun logement ne porte le mot « kayak » : c'est
  // l'invariant 4 de la spec 28 (« une section sans résultat n'est pas rendue ») prouvé par une
  // recherche plutôt que par l'absence de données seedées — donc insensible à ce qu'une autre
  // session créerait dans la base au même moment.
  await expect(page.getByTestId("seccion-lodging")).toHaveCount(0);
  await expect(page.getByTestId("seccion-activity")).toBeVisible();

  // Le champ garde le texte cherché : un visiteur qui revient d'un résultat doit relire sa
  // recherche, pas un champ vide.
  await expect(page.getByTestId("buscador-bar-input")).toHaveValue("kayak");
});

// Bug Jérôme du 2026-09-16 : naviguer après une recherche effaçait les critères actifs, à deux
// endroits successifs du MÊME parcours — l'onglet de type (`tiposDeBarra.ts` construisait un `href`
// nu, sans `sufijoCriterios`, contrairement aux liens « Ver más » testés plus haut), puis « Inicio »
// du fil d'Ariane (`migas`, la liste servant aussi le JSON-LD `BreadcrumbList`, ne portait jamais
// les critères ; `migasConCriterios` en dérive maintenant une copie affichée qui les porte, sans
// jamais toucher `migas` lui-même, JSON-LD inchangé).
//
// UN SEUL parcours, deux étapes : le second cas se joue de toute façon après le premier — deux
// tests en faisaient deux fois le trajet navigateur complet, le plus lent de la suite.
test("les critères de recherche survivent à la navigation (onglet de type, puis « Inicio »)", async ({
  page,
}) => {
  await irAlInicio(page);
  await buscar(page, "kayak");

  await page.getByTestId("selector-tipos-activity").click();
  await page.waitForURL(/\/es\/actividades\?q=kayak$/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId(`tarjeta-${ACTIVIDAD_KAYAK}`)).toBeVisible();

  await page.getByTestId("migas").getByRole("link", { name: "Inicio" }).click();
  await page.waitForURL(/\/es\?q=kayak$/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId(`tarjeta-${ACTIVIDAD_KAYAK}`)).toBeVisible();
});

test("une recherche sans résultat rend l'état vide, et la barre reste utilisable", async ({
  page,
}) => {
  await irAlInicio(page);
  await buscar(page, BUSQUEDA_SIN_RESULTADO);

  // Un SEUL état vide global, jamais un « Aucune activité » répété cinq fois (spec 28 §8).
  await expect(page.getByTestId("estado-vacio")).toBeVisible();
  await expect(page.getByTestId("estado-vacio-titulo")).toBeVisible();
  await expect(page.getByTestId("seccion-activity")).toHaveCount(0);
  await expect(page.getByTestId("seccion-lodging")).toHaveCount(0);

  // ⚠️ « La barre reste utilisable » n'est pas une assertion de présence : c'est un second
  // aller-retour complet depuis l'écran vide. C'est le seul moyen de prouver qu'on n'est pas dans
  // un cul-de-sac — un état vide qui remplacerait la barre au lieu de la surmonter passerait
  // n'importe quel test de visibilité.
  await expect(page.getByTestId("buscador-bar-input")).toBeVisible();
  await buscar(page, "kayak");

  await expect(page.getByTestId("estado-vacio")).toHaveCount(0);
  await expect(page.getByTestId(`tarjeta-${ACTIVIDAD_KAYAK}`)).toBeVisible();
});

test("un paramètre invalide rend l'accueil normale, jamais une erreur", async ({ page }) => {
  // Les quatre familles de paramètres, toutes invalides d'un coup : entier non numérique, date mal
  // formée, type inconnu, TAG inconnu. `leerCriterios` les ignore un par un — une URL mal recopiée
  // ou tronquée par un client mail doit rendre l'accueil, pas une 400 (spec 28 §9).
  //
  // ⚠️ `tag` est le seul des quatre qui n'était PAS ignoré jusqu'au 2026-09-08 : il ne passe pas
  // par une validation TypeScript (aucune liste fermée à comparer — les slugs vivent en base), il
  // part tel quel en `p_tag_slug`. Le prédicat SQL n'avait qu'une échappatoire (`is null`), donc un
  // slug absent de `catalog_tags` filtrait TOUT — et comme le panneau de recherche reporte ses
  // critères à chaque soumission, la page ne se déverrouillait plus jamais. Corrigé en base
  // (spec 29 §6c, migration `20260908120000`) ; ce test est ce qui empêche la régression de
  // revenir par le haut, là où les assertions pgTAP la tiennent par le bas.
  const response = await irAlInicio(
    page,
    "?personas=abc&desde=no-es-una-fecha&tipo=inexistante&tag=zzz-inexistant"
  );
  expect(response?.status()).toBe(200);

  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByTestId("seccion-activity")).toBeVisible();
  await expect(page.getByTestId(`tarjeta-${ACTIVIDAD_LANCHA}`)).toBeVisible();
  // Le critère invalide est IGNORÉ, pas appliqué à vide : l'écran n'est jamais l'état « aucun
  // résultat », qui serait la façon la plus discrète de casser cette règle.
  await expect(page.getByTestId("estado-vacio")).toHaveCount(0);

  // Le pendant du même mécanisme : des dates VALIDES sont acceptées et ne vident pas la page.
  // ⚠️ Jamais une date en dur — `seedDate` rend le jour du MOIS SUIVANT que pose `supabase/seed.sql`
  // (les littéraux ont tué trois specs le 2026-09-07, cf. `packages/e2e-support/src/date.ts`).
  const desde = seedDate(5);
  const hasta = seedDate(12);
  const conFechas = await irAlInicio(page, `?desde=${desde}&hasta=${hasta}`);
  expect(conFechas?.status()).toBe(200);
  await expect(page.getByTestId(`tarjeta-${ACTIVIDAD_LANCHA}`)).toBeVisible();
});

test("un établissement à deux couchages apparaît comme UNE carte groupée, qui mène à sa page", async ({
  page,
}) => {
  await irAlInicio(page);

  const agrupada = page.getByTestId(`tarjeta-${ESTABLECIMIENTO_AGRUPADO}`);
  await expect(agrupada).toBeVisible();

  // ⚠️ LE CŒUR DE LA RÈGLE : les deux couchages ne sont PAS listés à côté. Sans ces deux
  // assertions, une carte d'établissement qui s'ajouterait aux chambres au lieu de les remplacer
  // passerait le test — et c'est exactement l'erreur que le regroupement en SQL évite.
  await expect(page.getByTestId(`tarjeta-${COUCHAGE_PMS}`)).toHaveCount(0);
  await expect(page.getByTestId(`tarjeta-${COUCHAGE_DORTOIR}`)).toHaveCount(0);

  // Le prix « desde » vaut le MINIMUM des couchages vendables, jamais le premier venu. Comparaison
  // sur les chiffres bruts seulement (séparateurs et symbole monétaire ignorés) : le rendu d'`Intl`
  // n'est pas identique d'un environnement à l'autre, et ce n'est pas lui qu'on teste ici.
  const precio = page.getByTestId(`tarjeta-${ESTABLECIMIENTO_AGRUPADO}-precio`);
  await expect(precio).toBeVisible();
  expect((await precio.innerText()).replace(/[^0-9]/g, "")).toBe(String(PRECIO_DESDE_ESPERADO));

  await page.getByTestId(`tarjeta-${ESTABLECIMIENTO_AGRUPADO}-link`).click();
  await expect(page).toHaveURL(
    new RegExp(`/es/establecimientos/${ESTABLECIMIENTO_AGRUPADO}$`)
  );
  await expect(page.getByTestId("establishment-name")).toBeVisible();
});


// ─────────────────────────────────────────────────────────────────────────────────────────────
// Tranche 2 — les suggestions (2026-09-08)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Elles traversent une couche de plus que la recherche : le champ est CLIENT, `lib/catalog` est
// `server-only`, et `/api/catalogo/sugerencias` est le seul pont entre les deux. Un test composant
// bouchonne ce pont ; seul un e2e prouve qu'il existe et qu'il rend la bonne forme.
test("la barre propose des raccourcis avant la frappe, puis des offres du catalogue", async ({
  page,
}) => {
  await irAlInicio(page);

  // Avant toute frappe : `menuTrigger="focus"` ouvre la liste, qui doit proposer les types
  // présents à l'écran plutôt qu'un vide. Ils sortent des sections déjà rendues — aucune requête.
  await page.getByTestId("buscador-bar-input").click();
  await expect(page.getByRole("option", { name: /Actividades/ })).toBeVisible();

  // Dès deux caractères, la liste vient du catalogue. Le seuil et l'anti-rebond sont côté client :
  // on attend l'option, jamais une durée.
  await page.getByTestId("buscador-bar-input").fill("kayak");
  const sugerencia = page.getByRole("option", { name: /Kayak en el Embalse/ });
  await expect(sugerencia).toBeVisible();

  // La ligne secondaire est composée côté client à partir de DONNÉES (type + établissement) :
  // `lib/catalog` ne traduit rien. Voir spec 28 §6, même règle que le texte alternatif des photos.
  await expect(sugerencia).toContainText("Actividad");

  // ⚠️ L'option est un vrai `<a href>` NATIF (`ListBox.Item href=`), pas le `Link` localisé : son
  // préfixe de langue est posé à la main par `BuscadorInicio`. Sans lui, ce clic partirait sur une
  // URL sans langue que le proxy devrait rattraper par une redirection.
  await sugerencia.click();
  await expect(page).toHaveURL(new RegExp(`/es/productos/${ACTIVIDAD_KAYAK}$`));
});
