// ⚠️ Extension `.ts` OBLIGATOIRE, et elle manquait ici — corrigé le 2026-09-17. Deno résout les
// imports par URL : sans elle, le worker Edge ne boote pas du tout (BOOT_ERROR, « Module not
// found … Maybe add a '.ts' extension »). Le défaut était INVISIBLE jusqu'ici parce qu'aucune
// Edge Function n'importait ce module — les trois existantes ne tirent que lobbyClient,
// detectTraslado et les parseurs, qui l'avaient. ⚠️ `deno check` NE L'ATTRAPE PAS (il résout à
// la TypeScript), donc le job `functions` de la CI passait au vert : seul un boot réel le
// révèle, ce que fait désormais tests/pms-integration/pms_sync_availability.integration.mjs.
import { addDaysIso, joursDansLeMois } from "../time/bogotaDates.ts";
import { getLobbyAvailableRooms } from "./lobbyClient.ts";
import { hasActiveRestriction, parseLobbyNightCatalog, type LobbyNightRestrictions } from "./parseLobbyNightCatalog.ts";
import { alignLobbyCatalogEntries, type NightCatalogRow } from "./alignLobbyCatalogEntries.ts";
import { describeLobbyErrorBody } from "./describeLobbyErrorBody.ts";

export type { NightCatalogRow };

export interface NightAvailabilityRow {
  date: string;
  capacity: number;
  booked: number;
}

// Pourquoi une cause TYPÉE plutôt qu'un `null`. Jusqu'au 2026-08-28, une nuit perdue l'était pour
// trois raisons très différentes — statut non-200 (429 de quota, 5xx, 403 du relais), catégorie
// absente de la réponse, exception réseau — toutes réduites au même `null`, sans un seul log. C'est
// ce qui a rendu la panne du 23 décembre indiagnosticable : l'écran ne savait pas distinguer
// « complet » de « je n'ai pas su », et personne ne pouvait savoir laquelle des trois s'était
// produite. `bodyExcerpt` ne contient que le corps de la RÉPONSE, jamais l'URL (CLAUDE.md §8).
export type PmsFailure =
  | { kind: "rate_limited"; status: number; retryAfterSeconds: number | null; limit: number | null; bodyExcerpt: string }
  | { kind: "rejected"; status: number; bodyExcerpt: string }
  | { kind: "unparseable"; status: number; bodyExcerpt: string }
  | { kind: "unreachable"; message: string };

// Une fenêtre est complète ou elle a échoué — il n'y a pas de demi-succès. Le seuil est UNE nuit
// manquante, jamais « toutes manquantes » : la panne mesurée le 2026-08-28 comprenait des mois
// PARTIELS (novembre à 29 nuits sur 30), qu'un déclencheur « zéro nuit » aurait laissé passer pour
// un succès. `requested`/`obtained` servent au diagnostic, pas à une décision de l'appelant.
export type PmsWindowResult =
  | { ok: true; nights: NightCatalogRow[] }
  | { ok: false; failure: PmsFailure; requested: number; obtained: number };

type CatalogFetch = { ok: true; nights: NightCatalogRow[] } | { ok: false; failure: PmsFailure };

const CHUNK_SIZE = 6;

/**
 * LECTURE NUIT PAR NUIT — conservée comme REPLI, plus comme chemin nominal. Depuis que la sonde du
 * 2026-08-28 a prouvé que `available-rooms` honore une plage, la production passe par
 * getNightAvailabilityRange (un appel par mois). Cette fonction reste testée et exportée parce
 * qu'elle est la seule qui ne dépend d'AUCUNE hypothèse sur la sémantique de plage : si Lobby
 * changeait de comportement, c'est ici qu'on revient.
 *
 * R1 — LE FILTRE `category_id` A DISPARU, et c'est le plus gros gain unitaire du dossier.
 *
 * Ce que ça change. `GET /api/v2/available-rooms` rend un tableau `categories[]` : appelé SANS
 * `category_id`, il cote TOUT le catalogue de l'établissement pour la nuit demandée — forme
 * OBSERVÉE le 2026-08-27 sur le compte Casa Kayam, les 6 catégories en une seule réponse, signature
 * de champs identique pour toutes. L'unité de coût côté Lobby n'était donc pas l'établissement mais
 * le couple (jeton, catégorie) : Casa Kayam payait 6 appels par nuit pour une information qui tient
 * en un seul. Un mois affiché passait de 30 à 180 appels dès que deux produits du même
 * établissement étaient consultés — contre un plafond mesuré de 60 par fenêtre d'une minute.
 * Après ce changement : 30 appels pour le mois, quel que soit le nombre de produits liés.
 *
 * Corollaire, assumé et exploité par l'appelant : ce que cette fonction rend n'appartient plus à un
 * produit mais à un ÉTABLISSEMENT. Le cache doit donc être clé par établissement, plus par produit
 * — et la conversion unités → cupos (`cuposPerUnit`), qui dépend du `lodging_kind` et de la
 * `capacity` de CHAQUE produit, se fait obligatoirement APRÈS cette lecture, produit par produit.
 * Deux produits pointant la même catégorie Lobby peuvent avoir des capacités différentes.
 *
 * Port de mapChunked (app legacy, src/services/portalService.js) : lots séquentiels, appels
 * parallèles intra-lot — évite de saturer Lobby tout en restant raisonnablement rapide.
 *
 * ARRÊT AU PREMIER ÉCHEC, et ce n'est pas qu'une optimisation. Le mode d'échec dominant est le
 * quota (60 appels par fenêtre, mesuré) : une fois le mur atteint, les 25 appels suivants sont
 * certains d'échouer et ne feraient que creuser le trou. Le legacy poursuivait et rendait un
 * résultat partiel muet — c'est exactement ce qu'on retire.
 */
export async function getNightAvailabilityWindow(
  baseUrl: string,
  apiToken: string,
  nights: string[],
  relaySecret?: string
): Promise<PmsWindowResult> {
  const rows: NightCatalogRow[] = [];

  for (let i = 0; i < nights.length; i += CHUNK_SIZE) {
    const chunk = nights.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map((date) => fetchCatalog(baseUrl, apiToken, [date], relaySecret))
    );

    // Le premier échec du lot fait foi : les autres nuits du même lot sont parties en parallèle,
    // leur sort n'apprend rien de plus sur la cause.
    const failed = results.find((result): result is { ok: false; failure: PmsFailure } => !result.ok);
    if (failed) {
      return { ok: false, failure: failed.failure, requested: nights.length, obtained: rows.length };
    }

    for (const result of results) {
      if (result.ok) rows.push(...result.nights);
    }
  }

  return { ok: true, nights: rows };
}

/**
 * LA MÊME FENÊTRE EN UN SEUL APPEL. C'est le chemin de la production depuis le 2026-08-28.
 *
 * CE QUE LA SONDE A MESURÉ, et sans quoi ceci serait un pari. `available-rooms` est documenté
 * « over a date range » et personne ne l'avait jamais essayé — ni l'app legacy, ni hifago. Sonde du
 * 2026-08-28 sur le compte réel de Casa Kayam, via pms-nightly-contract-check en mode opt-in :
 *
 *   - LA PLAGE EST HONORÉE. Racine `{ data: [...], meta }`, un enregistrement PAR NUIT, chacun
 *     portant `date` et `categories` — la forme `data[]` n'est donc plus « tolérée par précaution,
 *     jamais confirmée », elle est observée.
 *   - `end_date` EST INCLUSIF. Demandé 2026-09-27 → 2026-10-02 : SIX enregistrements, du 27 au 2
 *     compris. La production supposait EXCLUSIF depuis le premier jour, sans l'avoir vérifié.
 *   - `meta` = { total_records, current_page, records_per_page: 100, total_pages } — la pagination
 *     existe et la page fait 100 enregistrements. Un mois (31 nuits) tient donc en UNE page ; et si
 *     un appelant demandait un jour davantage, la vérification de couverture échouerait bruyamment
 *     plutôt que de tronquer en silence.
 *
 * POURQUOI ON ENVOIE QUAND MÊME `dernière nuit + 1`. `end_date` étant inclusif, cette borne fait
 * rendre à Lobby une nuit de plus que demandé. C'est délibéré : c'est la forme que la production
 * émet depuis toujours et qui est prouvée fonctionner, alors que `start_date == end_date` n'a
 * jamais été observé. La nuit en trop ne coûte qu'un enregistrement de charge utile, et
 * `alignLobbyCatalogEntries` l'écarte — par sa DATE, jamais par son rang.
 *
 * Coût : UN appel pour un mois entier et pour tous les produits de l'établissement. Le mois affiché
 * qui coûtait 180 appels à Casa Kayam avant le 2026-08-28 (6 catégories × 30 nuits) en coûte 1.
 */
export async function getNightAvailabilityRange(
  baseUrl: string,
  apiToken: string,
  nights: string[],
  relaySecret?: string,
  timeoutMs?: number
): Promise<PmsWindowResult> {
  if (nights.length === 0) return { ok: true, nights: [] };

  const result = await fetchCatalog(baseUrl, apiToken, nights, relaySecret, timeoutMs);
  if (!result.ok) {
    return { ok: false, failure: result.failure, requested: nights.length, obtained: 0 };
  }
  return { ok: true, nights: result.nights };
}

// Un seul aller-retour HTTP, couvrant `nights` (une ou plusieurs). Toute la connaissance du
// protocole Lobby est ici ; les deux fonctions publiques ci-dessus ne diffèrent que par le
// découpage qu'elles en font.
async function fetchCatalog(
  baseUrl: string,
  apiToken: string,
  nights: string[],
  relaySecret?: string,
  timeoutMs?: number
): Promise<CatalogFetch> {
  const startDate = nights[0];
  const endDate = addDaysIso(nights[nights.length - 1], 1);

  let response;
  try {
    response = await getLobbyAvailableRooms(baseUrl, apiToken, startDate, endDate, relaySecret, timeoutMs);
  } catch (error) {
    return {
      ok: false,
      failure: { kind: "unreachable", message: error instanceof Error ? error.message : String(error) },
    };
  }

  // 429 est le cas qu'on veut nommer plutôt que subir : c'est le plafond de débit, il se rattrape
  // en attendant, contrairement à un 4xx de configuration. `Retry-After` et `X-RateLimit-Limit`
  // viennent de la réponse elle-même — Lobby dit lui-même sa limite, on cesse de la déduire.
  if (response.status === 429) {
    return {
      ok: false,
      failure: {
        kind: "rate_limited",
        status: response.status,
        retryAfterSeconds: response.rateLimit.retryAfterSeconds,
        limit: response.rateLimit.limit,
        bodyExcerpt: describeLobbyErrorBody(response.body),
      },
    };
  }

  if (response.status !== 200) {
    return {
      ok: false,
      failure: { kind: "rejected", status: response.status, bodyExcerpt: describeLobbyErrorBody(response.body) },
    };
  }

  const parsed = parseLobbyNightCatalog(response.body);
  if (!parsed.ok) {
    // 200 mais aucun `categories[]` exploitable. Distinct d'une catégorie cotée à `0`, qui est une
    // réponse pleine et entière (« complet »), et distinct aussi d'une catégorie ABSENTE du
    // catalogue — cette dernière n'est plus une panne de fenêtre depuis R1, mais un problème de
    // CE produit, tranché par pickCategoryNights chez l'appelant.
    return {
      ok: false,
      failure: { kind: "unparseable", status: response.status, bodyExcerpt: describeLobbyErrorBody(response.body) },
    };
  }

  const aligned = alignLobbyCatalogEntries(parsed.entries, nights);
  if (!aligned.ok) {
    // Une réponse bien formée mais qui ne recouvre pas ce qu'on a demandé est un échec de LECTURE,
    // pas une disponibilité — c'est exactement le silence qu'on retire du code (CLAUDE.md §4.4).
    return {
      ok: false,
      failure: {
        kind: "unparseable",
        status: response.status,
        bodyExcerpt: `alignement impossible (${aligned.reason}) : ${aligned.detail}`,
      },
    };
  }

  return { ok: true, nights: aligned.nights };
}

export interface CategoryNights {
  /** Les nuits que Lobby COTE pour cette catégorie. Les autres sont simplement absentes. */
  nights: NightAvailabilityRow[];
  /** Les nuits demandées que Lobby ne cote PAS pour cette catégorie. Jamais lues comme « complet ». */
  missingDates: string[];
  /**
   * Les nuits où Lobby pose une contrainte NON NULLE sur cette catégorie — RELEVÉ, jamais appliqué.
   * Vide sur tous les comptes observés à ce jour ({0,0,0} sur les six catégories de Casa Kayam,
   * 2026-08-27 et 2026-08-28), et c'est exactement pourquoi il faut le remonter : une valeur non
   * nulle qui apparaîtrait un jour ferait accepter au calendrier des nuits que `POST /bookings`
   * refuserait en 422, sans que rien ne relie la cause à l'effet.
   */
  restrictedNights: { date: string; restrictions: LobbyNightRestrictions }[];
}

/**
 * Extrait UNE catégorie d'un catalogue déjà lu — l'étape qui remplace le filtre `category_id`
 * supprimé côté HTTP, et qui ne coûte rien.
 *
 * Une catégorie absente du catalogue n'est JAMAIS interprétée comme « complet » : c'est la règle
 * qui porte tout ce dossier — un échec de lecture n'est pas une disponibilité. Mais l'absence est
 * rapportée NUIT PAR NUIT, et cette granularité est le correctif du 2026-08-28 (revue
 * adversariale). La première version rendait un échec global dès qu'UNE nuit n'était pas cotée :
 * si Lobby cessait de coter une catégorie sur une seule nuit lointaine (tarif non chargé, période
 * fermée), les trente autres nuits — parfaitement connues, déjà en cache pour les produits
 * voisins — devenaient inaccessibles.
 *
 * Omettre la nuit inconnue est STRICTEMENT plus sûr que de la rendre, et c'est déjà la discipline
 * de l'écran : `LodgingReservationForm` refuse toute date absente de la carte (`!byDate.has(…)`),
 * corrigé le 2026-08-28 précisément pour supprimer l'asymétrie affichage/verdict. Une nuit non
 * cotée reste donc non sélectionnable — mais elle ne condamne plus le mois.
 *
 * ⚠️ Le cas « AUCUNE nuit cotée » reste une erreur franche, et c'est à l'appelant de la traiter :
 * c'est la signature d'un `lobby_category_id` faux ou d'une catégorie supprimée côté Lobby, et
 * rendre un mois vide en `ok:true` serait exactement le silence qu'on retire du code.
 */
export function pickCategoryNights(rows: NightCatalogRow[], categoryId: number): CategoryNights {
  const nights: NightAvailabilityRow[] = [];
  const missingDates: string[] = [];
  const restrictedNights: { date: string; restrictions: LobbyNightRestrictions }[] = [];

  for (const row of rows) {
    const restrictions = row.restrictionsByCategory.get(categoryId);
    if (restrictions && hasActiveRestriction(restrictions)) {
      restrictedNights.push({ date: row.date, restrictions });
    }

    const available = row.availableByCategory.get(categoryId);
    if (available === undefined) {
      missingDates.push(row.date);
      continue;
    }
    nights.push({ date: row.date, capacity: available, booked: 0 });
  }

  return { nights, missingDates, restrictedNights };
}

// Toutes les nuits ISO (yyyy-MM-dd) d'un mois (yyyy-MM), en excluant celles strictement avant
// notBeforeIso — jamais interroger Lobby sur des dates déjà passées (ex. mois courant partiellement
// écoulé). ⚠️ `notBeforeIso` doit être la date à BOGOTÁ (todayInBogota), jamais la date UTC : passé
// 19 h heure locale, la nuit en cours ne serait même pas demandée à Lobby.
export function nightsOfMonth(month: string, notBeforeIso?: string): string[] {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const daysInMonth = joursDansLeMois(year, Number(monthStr));

  const nights: string[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${yearStr}-${monthStr.padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!notBeforeIso || iso >= notBeforeIso) nights.push(iso);
  }
  return nights;
}
