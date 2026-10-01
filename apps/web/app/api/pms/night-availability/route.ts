import {
  asLodgingKind,
  createTtlCache,
  cuposPerUnit,
  getNightAvailabilityRange,
  isPmsBacked,
  LOBBY_DEFAULT_BASE_URL,
  nightsOfMonth,
  pickCategoryNights,
  isMonthWithinHorizon,
  todayInBogota,
  toMirrorRows,
  type NightAvailabilityRow,
  type NightCatalogRow,
  type PmsFailure,
} from "@hifago/domain";
import { createServiceRoleClient } from "@hifago/supabase/service";

// Spec 21 §13 (gap comblé) — alimente le calendrier de sélection de dates de LodgingReservationForm.tsx
// pour un logement PMS-backed (Casa Kayam). Précédent direct : apps/web/app/api/pms/reserve-nights/
// route.ts (service_role, relit AUTORITATIVEMENT product/establishment par id, jamais un champ
// métier envoyé par le client). Différences volontaires par rapport à ce précédent : cette route est
// un GET public (fiche produit visible par un visiteur anonyme, même niveau d'exposition que
// product_availability déjà public pour un produit non-PMS — aucune auth.getUser() nécessaire), et
// remonte un vrai code d'erreur HTTP (jamais "toujours 200" comme reserve-nights, dont l'invariant
// "un échec PMS ne défait jamais la commande" ne s'applique pas ici : rien n'est encore réservé, la
// page doit pouvoir dégrader son affichage proprement en cas d'échec Lobby).
//
// Ne lit QUE la disponibilité (available_rooms), jamais un prix : Lobby n'est jamais la source du
// prix côté hifago (cf. packages/domain/src/pms/buildEvenRatesPerDay.ts) — product_date_rates/
// price_tiers restent la seule source de prix, y compris pour un produit PMS-backed.
export const runtime = "nodejs";

// `MirrorRow` (packages/domain) n'a pas de signature d'index : la forme locale à ce cast, reprise
// telle quelle d'`apps/web/lib/orders/getOrderByToken.ts` et de trois écrans admin, plutôt qu'un
// import de `@hifago/supabase` — la seule chose demandée ici est que `p_rows` soit accepté en jsonb.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

interface ProductRow {
  id: string;
  type: string;
  lobby_category_id: number | null;
  establishment_id: string;
  lodging_kind: string | null;
  capacity: number | null;
}

interface EstablishmentRow {
  id: string;
  lobby_connector_active: boolean;
  lobby_api_token: string | null;
}

// ⚠️ LE NUMÉRO DE MOIS EST VALIDÉ, pas seulement sa forme — corrigé le 2026-08-28 après revue.
// `/^\d{4}-\d{2}$/` acceptait `00` et `13` à `99`, et les deux échouaient MAL :
//   - `2026-13` : `nightsOfMonth` fabriquait des dates impossibles, `new Date(...)` levait, et la
//     route rendait un 502 `pms_unreachable` avec une pile en console — pour une faute de saisie.
//   - `2026-00` : toutes les nuits étaient filtrées par la comparaison avec « aujourd'hui », donc
//     `{ok:true, nights:[]}` — un SUCCÈS sur un mois qui n'existe pas, mis en cache par-dessus.
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
// Même motif que reserve-nights/route.ts : un identifiant malformé est une requête invalide (400),
// jamais transmis à PostgREST — qui répondrait une ERREUR (22P02), lue sinon comme une panne.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Horizon : `isMonthWithinHorizon` (packages/domain), six mois, décidé le 2026-08-28. Ce garde
// jouait jusqu'ici DEUX rôles avec un seul nombre volontairement très large (36 mois) : borner un
// abus, faute d'horizon produit tranché. Cette route est publique et anonyme, et chaque mois distinct
// est une clé de cache neuve donc un vrai appel LobbyPMS — soixante requêtes sur soixante mois
// futurs suffisaient à consommer le plafond mesuré (60/min) et à mettre le calendrier réel en 429
// pour tout le monde. L'horizon produit étant strictement plus serré, il couvre l'abus au passage :
// un garde d'abus n'a aucune raison d'être plus large que ce qu'on accepte de vendre.

// Cache 60s en mémoire, une seule instance par process serverless (spec 21 §0 : "cache 60s autorisé
// uniquement pour l'affichage" — jamais au moment de réserver, reserve-nights relit toujours à
// chaud). Best-effort, non partagé entre instances Vercel concurrentes — acceptable, ce cache n'a
// qu'une valeur de réduction de charge sur Lobby, jamais de correction.
//
// ⚠️ CE QUI EST MIS EN CACHE A CHANGÉ LE 2026-08-28 (R1) : ce n'est plus la disponibilité d'UNE
// catégorie, mais le CATALOGUE ENTIER de l'établissement pour le mois — parce que c'est exactement
// ce que Lobby rend quand on cesse de lui passer `category_id`. Une seule lecture sert donc tous
// les produits de l'établissement. Cumulé à la lecture par plage juste en dessous : les 6 produits
// de Casa Kayam consultés dans la même minute coûtent UN appel, contre 180 avant cette date.
const cache = createTtlCache<NightCatalogRow[]>(60_000);

// Le cache n'évince que sur promesse REJETÉE (cf. ttlCache.ts). Une fenêtre incomplète étant une
// valeur RÉSOLUE, elle restait mémorisée 60 s et resservie à tous les visiteurs de l'instance —
// c'est ce qui transformait un échec passager en panne d'une minute. Envelopper l'échec dans une
// exception est donc ce qui le rend NON mémorisable, sans toucher au cache lui-même. Idiome déjà
// en place côté admin (`LobbyRejectedError`, lib/pms/lobbyEstablishment.ts).
class PmsAvailabilityError extends Error {
  constructor(readonly failure: PmsFailure) {
    super(`disponibilité Lobby indisponible (${failure.kind})`);
    this.name = "PmsAvailabilityError";
  }
}

// Un échec de lecture n'est jamais une disponibilité : on refuse, on ne devine pas (CLAUDE.md §4.4).
// Le 429 est le seul cas qui se rattrape en attendant — il mérite son propre code et son Retry-After.
function respondToFailure(failure: PmsFailure): Response {
  if (failure.kind === "rate_limited") {
    return Response.json(
      { ok: false, reason: "pms_rate_limited", retryAfterSeconds: failure.retryAfterSeconds },
      {
        status: 429,
        headers: failure.retryAfterSeconds !== null
          ? { "Retry-After": String(failure.retryAfterSeconds) }
          : undefined,
      }
    );
  }
  const reason =
    failure.kind === "rejected"
      ? "pms_rejected"
      : failure.kind === "unparseable"
        ? "pms_unparseable"
        : "pms_unreachable";
  return Response.json({ ok: false, reason }, { status: 502 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  const month = url.searchParams.get("month");

  if (!productId || !UUID_PATTERN.test(productId) || !month || !MONTH_PATTERN.test(month)) {
    return Response.json({ ok: false, reason: "invalid_params" }, { status: 400 });
  }

  // « Aujourd'hui » à GUATAPÉ, résolu UNE fois pour toute la requête — le garde ci-dessous et le
  // plancher de `nightsOfMonth` plus bas doivent répondre à la même question au même instant. Avec
  // `new Date().toISOString().slice(0, 10)`, qui était ici jusqu'au 2026-08-28, la Colombie étant à
  // UTC−5 : passé 19 h à Guatapé ce plancher valait DÉJÀ demain, et la nuit EN COURS n'était même
  // pas DEMANDÉE à Lobby. Donc absente du calendrier, donc non réservable — tous les soirs, sans un
  // seul message d'erreur.
  const today = todayInBogota();

  // Le mois demandé doit rester dans l'horizon produit. Un mois passé ne coûte aucun appel Lobby
  // (toutes ses nuits sont filtrées) mais occupe une entrée de cache ; un mois lointain, lui, coûte
  // un vrai appel. Les deux sont refusés en 400, avant la moindre lecture en base.
  if (!isMonthWithinHorizon(month, today)) {
    return Response.json({ ok: false, reason: "month_out_of_range" }, { status: 400 });
  }

  const service = createServiceRoleClient();

  // `sellable` : cette route tourne en service_role, donc HORS RLS. `products_select_public`
  // (20260813190232) n'expose qu'un produit publié ; sans ce filtre, la disponibilité Lobby EN
  // DIRECT d'un logement non publié serait interrogeable par quiconque connaît son UUID. La
  // relecture autoritative doit reproduire la règle de la base, pas seulement s'y substituer.
  const { data: product, error: productError } = await service
    .from("products")
    .select("id, type, lobby_category_id, establishment_id, lodging_kind, capacity")
    .eq("id", productId)
    .eq("sellable", true)
    .maybeSingle<ProductRow>();

  // Une lecture en PANNE n'est jamais une absence : ni « produit introuvable » (404), ni plus bas
  // « connecteur coupé » (non réessayable). 503, motif réessayable — le client propose de réessayer.
  if (productError) {
    console.error(`night-availability : lecture du produit échouée (${productId})`, productError);
    return Response.json({ ok: false, reason: "availability_unavailable" }, { status: 503 });
  }

  if (!product) {
    return Response.json({ ok: false, reason: "product_not_found" }, { status: 404 });
  }
  if (!isPmsBacked({ type: product.type, lobbyCategoryId: product.lobby_category_id })) {
    return Response.json({ ok: false, reason: "not_pms_backed" }, { status: 404 });
  }

  const { data: establishment, error: establishmentError } = await service
    .from("establishments")
    .select("id, lobby_connector_active, lobby_api_token")
    .eq("id", product.establishment_id)
    .maybeSingle<EstablishmentRow>();

  if (establishmentError) {
    console.error(
      `night-availability : lecture de l'établissement échouée (${product.establishment_id})`,
      establishmentError
    );
    return Response.json({ ok: false, reason: "availability_unavailable" }, { status: 503 });
  }

  if (!establishment?.lobby_connector_active || !establishment.lobby_api_token) {
    // État anticipé (connecteur désactivé/pas encore configuré), pas une panne — 200, pas 4xx/5xx.
    return Response.json({ ok: false, reason: "connector_inactive" });
  }

  try {
    // ⚠️ LA DATE DE BOGOTÁ, JAMAIS CELLE D'UTC. Cette valeur est le plancher « ne rien demander
    const nights = nightsOfMonth(month, today);
    const baseUrl = process.env.LOBBY_API_BASE_URL || LOBBY_DEFAULT_BASE_URL;
    const relaySecret = process.env.LOBBY_RELAY_SECRET;
    const categoryId = product.lobby_category_id as number;
    const apiToken = establishment.lobby_api_token;

    // LA CLÉ NE PORTE PLUS LA CATÉGORIE (R1, 2026-08-28), et c'est le point : la lecture Lobby ne
    // dépend plus d'un produit. Elle porte toujours l'établissement, et ce n'est pas décoratif —
    // `lobby_category_id` est un entier LOCAL au compte Lobby de chaque établissement. Deux
    // établissements connectés à deux comptes différents ont trivialement la même catégorie 1 ;
    // sans ce préfixe, le second visiteur recevrait la disponibilité du premier.
    const catalog = await cache.getOrFetch(`${establishment.id}:${month}`, async () => {
      // UN SEUL APPEL POUR LE MOIS ENTIER, depuis que la sonde du 2026-08-28 a prouvé sur le compte
      // réel que `available-rooms` honore start_date/end_date (racine `{data[], meta}`, un
      // enregistrement daté par nuit, 100 par page — un mois tient donc dans une page). Avec R1
      // au-dessus, le mois affiché passe de 180 appels à 1 chez Casa Kayam.
      //
      // getNightAvailabilityWindow (nuit par nuit) reste le repli documenté : il ne suppose rien
      // d'une plage. On n'y bascule PAS automatiquement en cas d'échec — ce serait doubler le coût
      // d'un incident et masquer une dérive de contrat que le job nocturne est là pour voir.
      const window = await getNightAvailabilityRange(baseUrl, apiToken, nights, relaySecret);
      if (!window.ok) {
        // ⚠️ Le seuil est UNE nuit manquante, jamais « toutes manquantes ». La panne mesurée le
        // 2026-08-28 comportait des mois PARTIELS (novembre à 29 nuits sur 30) : un déclencheur
        // « fenêtre vide » les aurait laissés passer pour des succès, ce qui est précisément le
        // défaut qu'on corrige.
        console.warn(
          `GET /api/pms/night-availability — fenêtre incomplète (product ${productId}, month ${month}) :`,
          {
            kind: window.failure.kind,
            requested: window.requested,
            obtained: window.obtained,
            ...(window.failure.kind === "rate_limited"
              ? { limit: window.failure.limit, retryAfterSeconds: window.failure.retryAfterSeconds }
              : {}),
            ...("status" in window.failure ? { status: window.failure.status } : {}),
            ...("bodyExcerpt" in window.failure ? { bodyExcerpt: window.failure.bodyExcerpt } : {}),
          }
        );
        throw new PmsAvailabilityError(window.failure);
      }

      // LOT B (20260918170000). Cette route obtient parfois une réponse Lobby FRAÎCHE là où le
      // miroir de disponibilité ne l'a pas encore — connecteur tout juste activé, ou mois dont le
      // cron n'a pas réussi le sync. La reverser dans le miroir répare ce trou sans attendre son
      // prochain passage (jusqu'à 24 h), et coûte ZÉRO appel Lobby de plus : c'est la même réponse,
      // déjà en main, aplatie par le même `toMirrorRows` que le cron. `try/catch` PROPRE, jamais
      // laissé remonter au catch englobant : un défaut du canal miroir ne doit jamais dégrader
      // l'affichage du calendrier que cette route sert en premier lieu.
      try {
        const { error: mirrorError } = await service.rpc("sync_pms_availability_month", {
          p_establishment_id: establishment.id,
          p_month: month,
          p_rows: toMirrorRows(window.nights) as unknown as Json,
        });
        if (mirrorError) {
          console.error(
            `GET /api/pms/night-availability — écriture du miroir a échoué (établissement ${establishment.id}, mois ${month})`,
            mirrorError
          );
        }
      } catch (mirrorException) {
        console.error(
          `GET /api/pms/night-availability — écriture du miroir a levé (établissement ${establishment.id}, mois ${month})`,
          mirrorException
        );
      }

      return window.nights;
    });

    // EXTRACTION DE LA CATÉGORIE — ce qui remplace le filtre `category_id` retiré de l'appel HTTP.
    // Elle est APRÈS le cache et ne coûte rien, mais elle échoue séparément, et c'est délibéré : un
    // catalogue qui ne cote pas CE produit reste une réponse parfaitement valide pour les autres
    // produits du même établissement. Le mémoriser est donc correct ; c'est cette lecture-ci qui
    // refuse, jamais la fenêtre. Une catégorie absente n'est JAMAIS lue comme « complet » — un
    // échec de lecture n'est pas une disponibilité (CLAUDE.md §4.4).
    const picked = pickCategoryNights(catalog, categoryId);

    // AUCUNE nuit cotée : signature d'un `lobby_category_id` faux ou d'une catégorie supprimée côté
    // Lobby. Rendre un mois vide en `ok:true` serait un calendrier muet et sans explication.
    if (picked.nights.length === 0 && catalog.length > 0) {
      console.warn(
        `GET /api/pms/night-availability — catégorie jamais cotée (product ${productId}, month ${month}) :`,
        { categoryId, nights: catalog.length }
      );
      return Response.json({ ok: false, reason: "pms_category_not_quoted" }, { status: 502 });
    }

    // QUELQUES nuits non cotées : on sert les autres, et c'est le correctif du 2026-08-28 (revue).
    // Refuser le mois entier pour une nuit lointaine non cotée rendait inaccessibles trente nuits
    // parfaitement connues. Les nuits omises restent NON SÉLECTIONNABLES à l'écran (le calendrier
    // refuse toute date absente de la carte) — donc la sûreté est identique, l'utilité non.
    if (picked.missingDates.length > 0) {
      console.warn(
        `GET /api/pms/night-availability — nuits non cotées (product ${productId}, month ${month}) :`,
        { categoryId, missing: picked.missingDates.length, firstMissing: picked.missingDates[0] }
      );
    }

    // RESTRICTIONS LOBBY (`min_stay` / `lead_days`) — relevées, journalisées, et depuis le
    // 2026-08-29 TRANSMISES au client, qui les applique. L'arbitrage produit que ce module refusait
    // de faire a été tranché par Jérôme : `min_stay` devient la longueur minimale d'une plage
    // sélectionnable, `lead_days` relève le plancher des nuits réservables.
    //
    // ⚠️ POURQUOI MAINTENANT, alors que c'est mesuré à {0,0,0} sur les six catégories de Casa Kayam
    // (2026-08-27, reconfirmé le 28) : justement parce que c'est zéro. L'effet visible est nul
    // aujourd'hui, donc le moment est sûr. L'alternative était d'attendre qu'un socio pose un
    // `min_stay` dans Lobby et de le découvrir par un 422 en production, sans que rien ne relie la
    // cause à l'effet.
    //
    // ⚠️ CETTE ROUTE N'ARBITRE TOUJOURS PAS. Elle transmet le relevé tel quel — dates et champs, y
    // compris les `null`. La traduction en fenêtre sélectionnable appartient à l'écran
    // (LodgingReservationForm), parce que c'est une question de sélection, pas de disponibilité :
    // les nuits rendues ci-dessous sont RIGOUREUSEMENT les mêmes qu'avant ce lot.
    if (picked.restrictedNights.length > 0) {
      console.warn(
        `GET /api/pms/night-availability — restrictions Lobby relevées, NON appliquées (product ${productId}, month ${month}) :`,
        {
          categoryId,
          nights: picked.restrictedNights.length,
          first: picked.restrictedNights[0],
        }
      );
    }

    // CONVERSION UNITÉS LOBBY → CUPOS, et c'est le coeur de cette route. `available_rooms` compte
    // des chambres/tentes/lits-unités ; tout le reste de hifago (product_availability.capacity,
    // order_lines.qty, min_qty/max_qty, price_tiers) compte des cupos. La règle de conversion est
    // celle du garde-fou capacity_exceeds_physical, partagée dans le domaine plutôt que réécrite
    // ici — cf. cuposPerUnit.
    //
    // ⚠️ ELLE RESTE APPLIQUÉE PAR PRODUIT, APRÈS LA LECTURE, et R1 rend ce point critique plutôt
    // que théorique : ce qui est en cache appartient maintenant à l'ÉTABLISSEMENT, et deux produits
    // pointant la même catégorie Lobby peuvent avoir des `lodging_kind`/`capacity` différents.
    // Multiplier avant le cache écrirait la conversion du premier visiteur sur tous les suivants.
    // Nouveaux objets, jamais une mutation en place — les lignes en cache sont réutilisées telles
    // quelles au prochain hit.
    const perUnit = cuposPerUnit(asLodgingKind(product.lodging_kind), product.capacity);
    const cupos: NightAvailabilityRow[] =
      perUnit === 1
        ? picked.nights
        : picked.nights.map((row) => ({ ...row, capacity: row.capacity * perUnit }));

    // `restrictedNights` ne porte QUE les nuits où Lobby pose une contrainte non nulle
    // (`hasActiveRestriction`) : sur les comptes observés à ce jour, ce tableau est vide et la
    // charge utile est identique à celle d'avant. Les nuits sans contrainte n'y figurent pas — leur
    // absence EST l'information « rien à appliquer ici », et c'est ce qui évite de transporter
    // trente objets nuls par mois.
    return Response.json({ ok: true, nights: cupos, restrictedNights: picked.restrictedNights });
  } catch (error) {
    if (error instanceof PmsAvailabilityError) {
      return respondToFailure(error.failure);
    }
    console.error(`GET /api/pms/night-availability a échoué (product ${productId}, month ${month})`, error);
    return Response.json({ ok: false, reason: "pms_unreachable" }, { status: 502 });
  }
}
