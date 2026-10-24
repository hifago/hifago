import { asNonNegativeInt, asRecord } from "./parseHelpers.ts";

// Parseur de GET /api/v2/available-rooms sur le CHEMIN DE RÉSERVATION, dans sa forme « catalogue »
// (appel SANS `category_id`). Remplace l'usage que le calendrier faisait de
// parseLobbyNightAvailability, qui ne savait lire qu'UNE catégorie d'UNE nuit.
//
// ⚠️⚠️ LE PIÈGE QUE CE FICHIER EXISTE POUR FERMER. Le parseur précédent commençait par
// `Array.isArray(body.data) ? body.data[0] : body` — il ne lisait QUE le premier enregistrement, et
// l'appelant étiquetait la ligne obtenue avec la date qu'il avait DEMANDÉE. Tant qu'on demandait
// une seule nuit par appel, c'était juste. Le jour où l'on élargit `end_date` pour couvrir un mois
// en un appel, ce code ne casse RIEN DE VISIBLE : il lit `data[0]`, l'étiquette avec la date de
// début, et l'on écrit la disponibilité du 1er jour sur les 30 nuits du mois. Un calendrier
// d'apparence parfaitement normale, faux du 2e au 30e jour.
//
// D'où la règle, non négociable et vérifiée par test : **la date d'une ligne vient de la RÉPONSE,
// jamais de l'index ni de la requête.** Ce module ne connaît pas les dates demandées — il ne peut
// donc pas les recopier. Le rapprochement demandé ↔ obtenu est fait ailleurs, explicitement
// (alignLobbyCatalogEntries.ts), et échoue bruyamment quand il ne tombe pas juste.
//
// Une seule exception, étroite et matérialisée là-bas : une réponse à UNE nuit demandée qui ne
// porte aucune date. Il n'y a alors ni index ni ambiguïté possible, et c'est la forme sur laquelle
// la production tourne depuis toujours.
/**
 * `restrictions{min_stay, max_stay, lead_days}` d'une catégorie pour une nuit — RELEVÉ, jamais
 * APPLIQUÉ, et la distinction est le tout du sujet.
 *
 * Pourquoi le relever. Ces trois champs existaient dans les réponses de Lobby sans qu'aucun parseur
 * du chemin de réservation ne les regarde. Ils valent {0,0,0} sur les six catégories de Casa Kayam
 * (observé le 2026-08-27, reconfirmé le 2026-08-28), donc aujourd'hui ils ne changent rien — et
 * c'est précisément pour ça qu'il faut les lire MAINTENANT : le jour où un établissement en pose
 * un, le calendrier laisserait choisir une nuit que `POST /bookings` refusera en 422, sans que rien
 * ne relie la cause à l'effet.
 *
 * Pourquoi ne pas l'appliquer. Un `min_stay` filtre des séjours, pas des nuits : le traduire en
 * disponibilité serait un arbitrage produit (refuser la sélection ? l'autoriser et échouer au
 * paiement ? afficher une contrainte ?), et ce module n'arbitre pas. Il rend visible ce que Lobby
 * dit, l'appelant décide.
 */
export interface LobbyNightRestrictions {
  minStay: number | null;
  maxStay: number | null;
  leadDays: number | null;
}

/** Vrai si Lobby pose une contrainte NON NULLE — le seul cas qui mérite d'être signalé. */
export function hasActiveRestriction(restrictions: LobbyNightRestrictions): boolean {
  return (restrictions.minStay ?? 0) > 0 || (restrictions.maxStay ?? 0) > 0 || (restrictions.leadDays ?? 0) > 0;
}

/**
 * people → prix COP d'UNE unité pour UNE nuit, à ce niveau d'occupation, tel que Lobby le cote.
 *
 * ⚠️ RETOURNEMENT DU 2026-10-23 (constat de Gabriel en production, décision de l'orchestrateur) :
 * le prix public d'un logement Lobby EST le prix Lobby, sans marge — retour au cahier client §5 et à
 * la v1 (`priceForPeople`, src/services/portalService.js, qui lisait `value`). La commission reste une
 * PART du total (§3b), jamais une majoration. Jusqu'ici ce parseur ne lisait aucun prix (spec 24 §0,
 * révisée dans la même branche).
 *
 * Une occupation ABSENTE de l'objet n'est pas cotée : jamais un prix fabriqué ni pris à un autre
 * niveau (la v1 retombait sur `list[0]`, c'est précisément ce qui n'est plus fait).
 */
export type LobbyNightPrices = Readonly<Record<number, number>>;

export interface LobbyCatalogEntry {
  /** yyyy-MM-dd TEL QUE LOBBY LE REND. `null` = la réponse ne porte pas de date. */
  date: string | null;
  /**
   * categoryId → nombre d'UNITÉS libres (chambres/tentes/lits-unités — jamais des cupos, la
   * conversion appartient à l'appelant). Une catégorie ABSENTE de cette map n'est pas cotée par
   * Lobby, ce qui est très différent d'une catégorie cotée à 0 (« complet », une réponse pleine et
   * entière).
   */
  availableByCategory: Map<number, number>;
  /**
   * categoryId → `restrictions` de cette catégorie cette nuit-là. Une catégorie absente de cette
   * carte n'en porte simplement pas — ce qui est le cas de TOUTES aujourd'hui sur les comptes
   * observés. Jamais une contrainte inventée.
   */
  restrictionsByCategory: Map<number, LobbyNightRestrictions>;
  /**
   * categoryId → prix par occupation (`LobbyNightPrices`) du plan retenu. Une catégorie absente de
   * cette carte n'a AUCUN prix lisible cette nuit-là : elle n'est pas vendable au prix Lobby.
   */
  pricesByCategory: Map<number, LobbyNightPrices>;
}

export type LobbyNightCatalogResult =
  | { ok: true; entries: LobbyCatalogEntry[] }
  | { ok: false };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

// `date` est le champ OBSERVÉ le 2026-08-27 sur le compte Casa Kayam (forme mono-nuit). `start_date`
// est un repli DÉFENSIF, pas une observation : c'est le nom du paramètre de requête, que beaucoup
// d'API réémettent dans leur réponse. Il ne peut rien rendre silencieusement faux — au pire il ne
// trouve rien, et l'absence de date fait échouer l'alignement au lieu de fabriquer une valeur.
// On tolère un horodatage complet (`2026-12-23 00:00:00`) en n'en gardant que le jour.
function readEntryDate(record: Record<string, unknown>): string | null {
  for (const field of ["date", "start_date"] as const) {
    const raw = record[field];
    if (typeof raw === "string" && ISO_DAY.test(raw)) return raw.slice(0, 10);
  }
  return null;
}

interface NightCategories {
  availableByCategory: Map<number, number>;
  restrictionsByCategory: Map<number, LobbyNightRestrictions>;
  pricesByCategory: Map<number, LobbyNightPrices>;
}

// Le plan tarifaire « standard » de Lobby (docs/3-integrations/lobby_pms_api.md du dépôt legacy,
// « Standard rates use STANDARD_RATE »). À défaut, le premier plan qui porte des prix lisibles.
const STANDARD_RATE_PLAN = "STANDARD_RATE";

// Un prix lisible : nombre, ou chaîne non vide (Lobby écrit parfois `"120000.00"`), fini et > 0.
// Arrondi au peso : `order_lines.price_cop` est un entier, et l'écart est au plus d'un demi-peso.
// Absent, illisible ou ≤ 0 : `null`, donc omis — jamais un 0 qui mettrait une nuit en vente gratuite.
function readPriceValue(value: unknown): number | null {
  const usable = typeof value === "number" || (typeof value === "string" && value.trim().length > 0);
  if (!usable) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

// `prices[{people, value}]` d'un plan. Une même occupation cotée deux fois à deux prix différents
// est AMBIGUË : on ne sait pas lequel fait foi, elle est retirée (non cotée), jamais tranchée.
function readPlanPrices(plan: Record<string, unknown>): LobbyNightPrices | null {
  if (!Array.isArray(plan.prices)) return null;
  const prices: Record<number, number> = {};
  const ambiguous = new Set<number>();
  for (const entry of plan.prices) {
    const price = asRecord(entry);
    if (!price) continue;
    const people = typeof price.people === "string" ? Number(price.people) : price.people;
    if (typeof people !== "number" || !Number.isInteger(people) || people < 1) continue;
    const value = readPriceValue(price.value);
    if (value === null) continue;
    if (prices[people] !== undefined && prices[people] !== value) ambiguous.add(people);
    prices[people] = value;
  }
  for (const people of ambiguous) delete prices[people];
  return Object.keys(prices).length > 0 ? prices : null;
}

function readCategoryPrices(category: Record<string, unknown>): LobbyNightPrices | null {
  if (!Array.isArray(category.plans)) return null;
  const plans = category.plans.map(asRecord).filter((plan): plan is Record<string, unknown> => plan !== null);
  const standard = plans.find((plan) => plan.name === STANDARD_RATE_PLAN);
  const fromStandard = standard ? readPlanPrices(standard) : null;
  if (fromStandard) return fromStandard;
  for (const plan of plans) {
    const prices = readPlanPrices(plan);
    if (prices) return prices;
  }
  return null;
}

function samePrices(a: LobbyNightPrices, b: LobbyNightPrices): boolean {
  const keysA = Object.keys(a);
  return keysA.length === Object.keys(b).length && keysA.every((key) => a[Number(key)] === b[Number(key)]);
}

function readCategories(record: Record<string, unknown>): NightCategories | null {
  const rawCategories = record.categories;
  if (!Array.isArray(rawCategories)) return null;

  const availableByCategory = new Map<number, number>();
  const restrictionsByCategory = new Map<number, LobbyNightRestrictions>();
  const pricesByCategory = new Map<number, LobbyNightPrices>();
  const ambiguousPrices = new Set<number>();
  for (const entry of rawCategories) {
    const category = asRecord(entry);
    if (!category) continue;

    // `Number(null)` vaut 0 : sans ce garde, une entrée dont `category_id` est nul créerait une
    // catégorie FANTÔME numéro 0. Ce n'est pas théorique — `isPmsBacked` accepte
    // `lobby_category_id = 0` (il ne teste que `!= null`), donc un produit pourrait s'y raccrocher.
    if (category.category_id === null || category.category_id === undefined) continue;
    const categoryId = Number(category.category_id);
    if (!Number.isInteger(categoryId)) continue;

    // ⚠️ UNE DISPONIBILITÉ ILLISIBLE N'EST PAS UN ZÉRO — corrigé le 2026-08-28 après revue.
    // La première version reprenait le repli de l'ancien parseur : champ absent, `null` ou `""`
    // donnaient 0, c'est-à-dire « complet ». Une nuit devenait donc non réservable SANS un seul
    // log, exactement le silence que tout ce lot existe pour supprimer, et en contradiction avec la
    // règle du dossier (un échec de LECTURE n'est pas une disponibilité). La catégorie est
    // désormais laissée HORS de la map : elle est alors « non cotée », ce que pickCategoryNights
    // rapporte nommément.
    //
    // `asNonNegativeInt` porte les deux prudences qui comptent ici, et les porte pour tout le
    // dossier : 0 est une valeur LÉGITIME (« complet »), et une chaîne vide n'en est pas une —
    // `Number("")` vaut 0, donc un champ non renseigné se lirait « complet » sans ce filtre.
    const available = asNonNegativeInt(category.available_rooms);
    if (available === null) continue;

    // Doublon de catégorie dans une même nuit : on garde le MINIMUM. On ne sait pas laquelle des
    // deux lignes fait foi, et la seule erreur qui coûte de l'argent est de sur-vendre.
    const known = availableByCategory.get(categoryId);
    availableByCategory.set(categoryId, known === undefined ? available : Math.min(known, available));

    const restrictions = readRestrictions(category.restrictions);
    if (restrictions) restrictionsByCategory.set(categoryId, restrictions);

    // Doublon de catégorie aux prix DIFFÉRENTS : comme pour une occupation en double, aucun des deux
    // n'est retenu. Mêmes prix : rien d'ambigu.
    const prices = readCategoryPrices(category);
    const knownPrices = pricesByCategory.get(categoryId);
    if (knownPrices && (!prices || !samePrices(knownPrices, prices))) ambiguousPrices.add(categoryId);
    else if (prices && !knownPrices && known !== undefined) ambiguousPrices.add(categoryId);
    if (prices) pricesByCategory.set(categoryId, prices);
  }
  for (const categoryId of ambiguousPrices) pricesByCategory.delete(categoryId);
  return { availableByCategory, restrictionsByCategory, pricesByCategory };
}

// Même discipline défensive que le reste : un champ absent ou illisible reste `null`, jamais 0 —
// un 0 signifierait « Lobby dit qu'il n'y a pas de contrainte », ce qui n'est pas la même chose que
// « Lobby n'a rien dit ». La distinction compte : c'est exactement celle que le relevé doit rendre.
function readRestrictions(value: unknown): LobbyNightRestrictions | null {
  const record = asRecord(value);
  if (!record) return null;
  const read = asNonNegativeInt;
  const restrictions = {
    minStay: read(record.min_stay),
    maxStay: read(record.max_stay),
    leadDays: read(record.lead_days),
  };
  // Un objet `restrictions` présent mais dont aucun des trois champs n'est lisible n'apprend rien :
  // ne pas l'inscrire évite de faire croire à une observation qu'on n'a pas faite.
  return restrictions.minStay === null && restrictions.maxStay === null && restrictions.leadDays === null
    ? null
    : restrictions;
}

/**
 * Deux formes de racine, exactement comme les autres parseurs du dossier : le corps lui-même
 * (forme mono-nuit RÉELLEMENT OBSERVÉE) ou un tableau `data[]` (forme tolérée par précaution,
 * jamais confirmée — c'est précisément ce que la sonde de plage doit trancher). La différence avec
 * le parseur précédent est qu'ici `data[]` est lu EN ENTIER, pas seulement `data[0]`.
 */
export function parseLobbyNightCatalog(body: unknown): LobbyNightCatalogResult {
  const outer = asRecord(body);
  if (!outer) return { ok: false };

  if (Array.isArray(outer.data)) {
    const entries: LobbyCatalogEntry[] = [];
    for (const element of outer.data) {
      const record = asRecord(element);
      if (!record) return { ok: false };
      const categories = readCategories(record);
      if (!categories) return { ok: false };
      entries.push({ date: readEntryDate(record), ...categories });
    }
    return { ok: true, entries };
  }

  const categories = readCategories(outer);
  if (!categories) return { ok: false };
  return { ok: true, entries: [{ date: readEntryDate(outer), ...categories }] };
}
