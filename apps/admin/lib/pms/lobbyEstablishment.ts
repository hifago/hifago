import {
  createTtlCache,
  getLobbyProducts,
  getLobbyRooms,
  LOBBY_DEFAULT_BASE_URL,
  parseLobbyPageMeta,
  parseLobbyRooms,
  parseLobbyServices,
  type LobbyCallResult,
  type LobbyRoomCategory,
  type LobbyService,
} from "@hifago/domain";
import { createClient } from "@hifago/supabase/server";
import { createServiceRoleClient } from "@hifago/supabase/service";
import { isUuid } from "@/lib/uuid";

// Frontière d'accès aux données LobbyPMS d'un établissement, définie UNE fois (/simplify du
// 2026-08-26). Les trois Route Handlers `api/pms/*` en portaient chacun leur copie : 38 lignes
// strictement identiques entre lobby-rooms et lobby-services, 18 de plus dans import-room-photos.
// Le commentaire de ce dernier consacrait même cinq lignes à ARGUMENTER que sa garde était bien la
// même que celle des deux autres — un helper rend cet argument vérifiable au lieu de déclaratif.
//
// ⚠️ Ce n'était pas qu'une duplication : la garde recopiée était plus FAIBLE que celle de la base.
// Elle comparait `establishment.partner_id` au partenaire du compte, alors que la RPC qui persiste
// réellement le travail (`submit_product_creation_proposal`) exige
// `has_capability(uid, 'operator', establishment_id)` — laquelle filtre en plus sur
// `status = 'active'` et sur l'établissement précis. Un compte dont la capacité operator est
// SUSPENDUE, ou un compte référent-seul du même partenaire, franchissait donc la route, déclenchait
// des appels sur le jeton Lobby du partenaire et jusqu'à 6 écritures dans catalog-media — pour une
// proposition que la RPC refusait ensuite en `capability_suspended`. Le travail sortant et les
// octets écrits, eux, étaient déjà consommés. Corrigé ici, donc pour les trois routes à la fois.
export type LobbyEstablishmentAccess =
  | {
      ok: true;
      establishmentId: string;
      apiToken: string;
      baseUrl: string;
      relaySecret: string | undefined;
      /** Client porteur de la session de l'appelant — pour les RPC qui doivent rester gardées (add_catalog_media). */
      supabase: Awaited<ReturnType<typeof createClient>>;
      service: ReturnType<typeof createServiceRoleClient>;
      isAdmin: boolean;
    }
  | { ok: false; response: Response };

function deny(reason: string, status: number): { ok: false; response: Response } {
  return { ok: false, response: Response.json({ ok: false, reason }, { status }) };
}

/** Ligne d'établissement telle que lue par les deux chemins ci-dessous. */
type EstablishmentRow = {
  lobby_api_token: string | null;
  lobby_connector_active: boolean | null;
  lobby_has_token: boolean | null;
} | null;

/**
 * Valide qu'un établissement est réellement connecté et en extrait de quoi appeler Lobby. Séparé
 * de la garde d'autorisation parce que les deux chemins d'accès diffèrent : le sélecteur part d'un
 * `establishmentId` fourni par l'écran, l'import-rattachement part d'un `productId` dont on REMONTE
 * l'établissement en base (jamais du corps de requête, qui ne doit désigner que la ressource).
 */
export function lobbyCredentials(
  establishment: EstablishmentRow,
):
  | { ok: true; apiToken: string; baseUrl: string; relaySecret: string | undefined }
  | { ok: false; response: Response } {
  if (!establishment) return deny("establishment_not_found", 404);
  if (!establishment.lobby_connector_active || !establishment.lobby_has_token) {
    return deny("pms_not_connected", 409);
  }
  return {
    ok: true,
    apiToken: establishment.lobby_api_token as string,
    // Volontairement lu ICI et pas dans packages/domain : lobbyClient.ts pose comme décision
    // d'architecture que baseUrl/apiToken sont toujours des paramètres explicites, jamais lus
    // depuis l'environnement à l'intérieur du module — c'est ce qui lui permet de tourner en Node,
    // en Deno et contre le serveur de fixtures.
    baseUrl: process.env.LOBBY_API_BASE_URL || LOBBY_DEFAULT_BASE_URL,
    relaySecret: process.env.LOBBY_RELAY_SECRET,
  };
}

/**
 * Vérifie que l'appelant a le droit d'agir sur les données Lobby de cet établissement, et renvoie
 * de quoi appeler Lobby. `requireAdmin` couvre les gestes réservés à l'admin (rattachement direct
 * d'un média à un produit existant) ; sinon la règle est « admin OU operator actif sur CET
 * établissement », jamais « authentifié ».
 */
export async function resolveLobbyEstablishment(
  establishmentId: string | null,
  options: { requireAdmin?: boolean } = {},
): Promise<LobbyEstablishmentAccess> {
  // Pas un UUID → 400 avant toute lecture : la lecture échouerait (22P02), et une lecture en échec
  // répond ci-dessous 503 « autorisation indéterminable » — un faux 503 pour une faute de saisie.
  if (!isUuid(establishmentId)) return deny("invalid_params", 400);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return deny("not_authenticated", 401);

  const service = createServiceRoleClient();

  // Les trois lectures ne dépendent que de `user.id`/`establishmentId`, jamais l'une de l'autre :
  // une seule vague au lieu des trois séquentielles d'avant (~1 aller-retour Supabase économisé à
  // chaque ouverture du sélecteur). Toutes les autorisations restent évaluées AVANT le premier
  // appel Lobby et avant toute écriture Storage.
  const [adminResult, capabilityResult, establishmentResult] = await Promise.all([
    supabase.rpc("is_admin", { uid: user.id }),
    supabase.rpc("has_capability", {
      uid: user.id,
      p_role: "operator",
      p_establishment_id: establishmentId,
    }),
    service
      .from("establishments")
      .select("id, lobby_api_token, lobby_connector_active, lobby_has_token")
      .eq("id", establishmentId)
      .maybeSingle(),
  ]);

  // ⚠️ Distinguer « tu n'as pas le droit » de « je n'ai pas pu le savoir ». supabase-js ne LÈVE pas
  // sur échec : il renvoie `{ data: null, error }`. Ignorer `error` — ce que faisait le code d'avant
  // — transforme une panne transitoire de Postgres en un 403 silencieux, impossible à distinguer
  // d'un vrai refus dans les journaux comme à l'écran. Constaté en préprod le 2026-08-27 : un 403
  // isolé sur lobby-rooms pendant que lobby-services répondait 200, avec la même session et le même
  // établissement. Un 503 explicite est à la fois plus honnête et plus facile à diagnostiquer, et
  // reste fermé par défaut : on n'autorise jamais sur une réponse qu'on n'a pas obtenue.
  //
  // La lecture de l'établissement suit la même règle : sur une panne, `data` vaut null, que
  // `lobbyCredentials` aurait lu « établissement introuvable » (404) — un faux refus de plus.
  if (adminResult.error || capabilityResult.error || establishmentResult.error) {
    console.error(
      `resolveLobbyEstablishment : autorisation indéterminable (establishment ${establishmentId})`,
      {
        isAdmin: adminResult.error?.message,
        hasCapability: capabilityResult.error?.message,
        establishment: establishmentResult.error?.message,
      },
    );
    return deny("authorization_unavailable", 503);
  }

  const isAdmin = adminResult.data;
  const hasOperator = capabilityResult.data;
  const establishment = establishmentResult.data;

  if (options.requireAdmin && !isAdmin) return deny("not_authorized", 403);
  if (!isAdmin && !hasOperator) return deny("not_authorized", 403);

  const credentials = lobbyCredentials(establishment);
  if (!credentials.ok) return credentials;

  return {
    ok: true,
    establishmentId,
    apiToken: credentials.apiToken,
    baseUrl: credentials.baseUrl,
    relaySecret: credentials.relaySecret,
    supabase,
    service,
    isAdmin: Boolean(isAdmin),
  };
}

const MAX_PAGES = 20;

export type LobbyPageCollection<T> =
  | { ok: true; items: T[] }
  | { ok: false; reason: "lobby_rejected"; status: number };

/**
 * Parcourt les pages de LobbyPMS et accumule les éléments, sans doublon.
 *
 * Deux sorties, dans cet ordre :
 *   1. `meta.total_pages` quand Lobby le renvoie — la sortie rapide, 1 seul appel pour un compte
 *      d'une page.
 *   2. « aucun identifiant nouveau sur cette page » — le filet, qui ne suppose RIEN de Lobby.
 *
 * Le filet n'est pas théorique : `meta` n'a jamais été observé dans une réponse réelle (la sonde du
 * 2026-08-26 n'a capturé que le début du corps, qui ne contenait que `data`), et cette clé vient
 * d'une doc déjà prise en défaut une fois sur `POST /bookings`. Si `meta` manque ET que Lobby borne
 * une page hors plage à la dernière page — comportement courant — la version précédente tapait les
 * 20 pages et renvoyait 20 copies des mêmes catégories dans le sélecteur. La déduplication supprime
 * les deux défauts d'un coup et rend `MAX_PAGES` à son rôle de vrai garde-fou, jamais atteint.
 */
export async function collectLobbyPages<T>(
  fetchPage: (page: number) => Promise<LobbyCallResult>,
  parse: (body: unknown) => T[],
  getKey: (item: T) => number,
): Promise<LobbyPageCollection<T>> {
  const items: T[] = [];
  const seen = new Set<number>();
  let totalPages: number | null = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await fetchPage(page);
    if (response.status !== 200) {
      return { ok: false, reason: "lobby_rejected", status: response.status };
    }

    let addedOnThisPage = 0;
    for (const item of parse(response.body)) {
      const key = getKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      addedOnThisPage += 1;
    }
    if (addedOnThisPage === 0) break;

    totalPages = parseLobbyPageMeta(response.body).totalPages ?? totalPages;
    if (totalPages !== null && page >= totalPages) break;
  }

  return { ok: true, items };
}

// ─────────────────────────── Lectures Lobby mises en cache ───────────────────────────
//
// Sans cache, un seul geste utilisateur déclenchait DEUX balayages complets de GET /rooms : le
// montage du sélecteur, puis le clic sur « Usar estos datos » (ou « Importar fotos »), qui repose
// exactement la même question à quelques secondes d'intervalle. Le défaut `lobbyLinkMode = "picker"`
// posé le 2026-08-26 a amplifié le premier : quatre écrans qui ne faisaient aucun appel en font
// désormais un au chargement.
//
// Réutilise createTtlCache de packages/domain (renommé le 2026-08-27 : il s'appelait
// createNightAvailabilityCache alors qu'il n'a jamais rien eu de spécifique aux nuitées). Il cache
// la PROMESSE en vol, donc il coalesce aussi les appels concurrents — ce qui neutralise au passage
// le double montage de React StrictMode en développement et les rafales de démontage/remontage
// quand on bascule le mode du sélecteur.
//
// Best-effort et par instance : sur Vercel, le GET du sélecteur et le POST de l'import peuvent
// atterrir sur deux lambdas différentes, l'économie est donc opportuniste et jamais garantie. C'est
// acceptable — aucune décision d'anti-survente ne passe par ici (la disponibilité live a son propre
// chemin, /api/pms/night-availability), et la liste des catégories d'un compte change au mieux une
// fois par mois.
const roomsCache = createTtlCache<LobbyRoomCategory[]>(60_000);
const servicesCache = createTtlCache<LobbyService[]>(60_000);

/** Lobby a répondu autre chose que 200 — jamais mis en cache (cf. createTtlCache). */
export class LobbyRejectedError extends Error {
  constructor(readonly status: number) {
    super(`LobbyPMS a répondu ${status}`);
    this.name = "LobbyRejectedError";
  }
}

export type LobbyFetchCredentials = {
  apiToken: string;
  baseUrl: string;
  relaySecret: string | undefined;
};

// L'échec est LEVÉ plutôt que renvoyé : c'est ce qui fait évincer l'entrée par createTtlCache (il
// n'évince que sur promesse rejetée). Renvoyer un `{ok:false}` le figerait 60 s, et une panne
// passagère de Lobby deviendrait une minute d'indisponibilité pour tout le monde.
export function fetchLobbyRoomsCached(
  establishmentId: string,
  credentials: LobbyFetchCredentials,
): Promise<LobbyRoomCategory[]> {
  return roomsCache.getOrFetch(establishmentId, async () => {
    const collected = await collectLobbyPages<LobbyRoomCategory>(
      (page) => getLobbyRooms(credentials.baseUrl, credentials.apiToken, page, credentials.relaySecret),
      parseLobbyRooms,
      (category) => category.categoryId,
    );
    if (!collected.ok) throw new LobbyRejectedError(collected.status);
    return collected.items;
  });
}

export function fetchLobbyServicesCached(
  establishmentId: string,
  credentials: LobbyFetchCredentials,
): Promise<LobbyService[]> {
  return servicesCache.getOrFetch(establishmentId, async () => {
    const collected = await collectLobbyPages<LobbyService>(
      (page) => getLobbyProducts(credentials.baseUrl, credentials.apiToken, page, credentials.relaySecret),
      parseLobbyServices,
      (service) => service.serviceId,
    );
    if (!collected.ok) throw new LobbyRejectedError(collected.status);
    return collected.items;
  });
}
