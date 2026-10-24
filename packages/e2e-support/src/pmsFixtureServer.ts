import { addDaysIso } from "@hifago/domain";
import { createServer, type Server } from "node:http";

// Spec 21 — connecteur LobbyPMS. Serveur node:http minimal, aucune nouvelle dépendance (ni Nock ni
// MSW ne sont réellement installés dans ce monorepo, cf. spec 21 §10) : sert de cible unique pour
// TOUTES les couches qui ont besoin d'un LobbyPMS de test — le module domain (packages/domain/src/
// pms/lobbyClient.test.ts a son propre serveur inline, plus simple), une Route Handler Next.js
// (via LOBBY_API_BASE_URL) ET une Edge Function Deno (via supabase/functions/.env,
// LOBBY_API_BASE_URL=http://host.docker.internal:<port>) — ce qu'aucune lib de mock JS ne peut
// faire, pg_net émettant un vrai appel HTTP depuis Postgres.
// Un prix tel que Lobby l'écrit dans `plans[].prices[]` (docs/3-integrations/lobby_pms_api.md du
// dépôt legacy) : `value`, jamais `price` — la fixture écrivait `price` jusqu'au 2026-10-23.
export interface FixtureLobbyPrice {
  people: number;
  value: number | string;
}

export interface PmsFixtureScenario {
  rooms?: unknown;
  createBookingStatus?: number;
  createBookingBody?: unknown;
  addProductServiceStatus?: number;
  addProductServiceBody?: unknown;
  bookingDetailByStatus?: Map<number, { status: number; body: unknown }>;
  // Spec 21 §13 (gap comblé) — clé = la NUIT (yyyy-MM-dd), pas le `start_date` de la requête.
  // Une date absente de cette map répond "disponible" par défaut (available_rooms: 5) : un scénario
  // n'a besoin d'énumérer que les exceptions (nuit pleine, nuit en erreur), pas tout le mois.
  //
  // ⚠️ RÉÉCRIT LE 2026-08-28. Jusque-là, ce serveur IGNORAIT PUREMENT ET SIMPLEMENT `end_date` : il
  // répondait toujours UNE nuit, celle de `start_date`. Tant que la production demandait une nuit
  // par appel, l'écart ne se voyait pas. Mais il rendait INDÉTECTABLE l'erreur la plus coûteuse du
  // dossier : un test « un seul appel couvre 30 nuits » aurait été VERT contre un serveur qui n'en
  // rend qu'une, et l'aurait été tout autant si le code de production avait recopié la disponibilité
  // du 1er jour sur les 29 autres. Une fixture plus complaisante que le vrai service ne teste pas le
  // service.
  //
  // `status` : une réponse HTTP n'a qu'un statut. Quand une requête couvre plusieurs nuits, la
  // PREMIÈRE nuit de la plage qui en déclare un l'emporte pour toute la réponse.
  // `availableByCategory` : le catalogue de cette nuit-là (categoryId → unités). C'est ce que Lobby
  // rend quand on ne lui passe PAS `category_id`, et donc ce dont le chemin R1 a besoin.
  //
  // `pricesByCategory` (2026-10-23) : les prix Lobby de cette nuit, catégorie → `prices[]` du plan
  // STANDARD_RATE. Prime sur le `pricesByCategory` du scénario (ci-dessous) pour cette nuit-là.
  nightAvailabilityByDate?: Record<
    string,
    {
      status?: number;
      availableRooms?: number;
      availableByCategory?: Record<number, number>;
      pricesByCategory?: Record<number, FixtureLobbyPrice[]>;
    }
  >;
  // Prix par défaut de chaque nuit, catégorie → `prices[]` (forme réelle : `{people, value}`, `value`
  // nombre ou chaîne). SANS valeur par défaut, comme les catégories : une catégorie sans prix rend
  // `plans: []`, et un devis échoue fermé (`price_missing`) au lieu de passer sur un prix inventé.
  pricesByCategory?: Record<number, FixtureLobbyPrice[]>;
  // Délai avant toute réponse de GET /api/v2/available-rooms (ms), pour les tests de timeout.
  availableRoomsDelayMs?: number;
  // Catégories cotées par défaut quand la requête ne filtre pas sur `category_id`. Volontairement
  // SANS valeur par défaut : un scénario en mode catalogue doit dire quelles catégories existent,
  // sinon la réponse ne cote rien — un test mal câblé échoue bruyamment au lieu de passer sur une
  // disponibilité fabriquée.
  catalogCategoryIds?: number[];
  // `end_date` EST INCLUSIF — MESURÉ, plus supposé. Sonde du 2026-08-28 sur le compte réel de Casa
  // Kayam : demandé 2026-09-27 → 2026-10-02, Lobby rend SIX enregistrements (du 27 au 2 compris),
  // là où l'hypothèse exclusive en prévoyait cinq. Le défaut de cette fixture est donc `true`,
  // parce qu'une fixture plus complaisante que le vrai service ne teste pas le service.
  // Passer `false` rejoue le monde exclusif — utile pour prouver que le code marche dans les deux,
  // jamais pour décrire Lobby tel qu'il est.
  endDateInclusive?: boolean;
  // `"ignores_end_date"` : le monde où Lobby ne saurait pas faire de plage et rendrait toujours la
  // seule nuit de `start_date`. RÉFUTÉ par la même sonde, mais gardé : c'est CE monde-là qui rend
  // un test de plage faussement vert, et un test doit prouver qu'on le détecte.
  rangeBehaviour?: "honours" | "ignores_end_date";
  // Refonte parcours produit ↔ LobbyPMS — GET /api/v1/products (les « services » du compte). Sans
  // cette route, le picker de services (apps/admin/app/api/pms/lobby-services/route.ts) tombait en
  // 404 → 502 : il n'était ni testable ni exerçable en local, contrairement à son jumeau /rooms.
  services?: unknown;
  // POST /api/v1/cancel-booking/{id} — clé = booking_id. Une entrée absente répond 200 avec un
  // cancel_booking synthétique ; poser explicitement { status: 422, body: { error_code:
  // "RESTRICTED_RESERVATION" } } pour rejouer le cas « booking portant déjà une charge », qui est
  // un cas ATTENDU et documenté (spec 21 §0), jamais une exception.
  cancelBookingByStatus?: Map<number, { status: number; body: unknown }>;
  // GET /api/v2/available-rooms appelé SANS `category_id` — forme « catalogue entier pour la nuit »,
  // utilisée par le job nocturne de contrôle de contrat (jamais par le parcours de réservation, qui
  // filtre toujours sur une catégorie). Servie telle quelle, sans synthèse : ce scénario existe
  // précisément pour rejouer une charge utile OBSERVÉE, restrictions comprises.
  availableRoomsCatalog?: unknown;
}

// Forme RÉELLEMENT OBSERVÉE le 2026-08-26 sur le compte Lobby de Casa Kayam, via la préprod
// (spec 24 §11.1) — et non plus une transcription de leur documentation, qui s'était déjà révélée
// fausse une fois sur `POST /bookings`.
//
// Ces constantes sont LOAD-BEARING depuis le 2026-08-27 :
// `apps/admin/lib/pms/lobbyContract.test.ts` démarre ce serveur, les sert sur du vrai HTTP et
// vérifie la chaîne complète (lobbyClient → parseur → pagination). Modifier une valeur ici fait
// donc rougir un test — c'est tout l'intérêt.
//
// Elles ne l'étaient PAS quand elles ont été écrites, et le commentaire prétendait le contraire
// (« les tests qui consomment ceci prouvent le contrat réel », alors qu'aucun ne les consommait) ;
// le /simplify du 2026-08-26 l'a relevé, d'où le test. À garder branché : sans consommateur, ces
// valeurs redeviennent une référence décorative qui peut diverger de Lobby en silence.
//
// Les quatre traits que cette fixture doit conserver, parce que chacun a cassé ou aurait pu casser
// quelque chose :
//   1. `type` est en ESPAGNOL (`privada` / `compartida`), jamais en anglais ;
//   2. `capacity` = occupants d'UNE unité, `quantity` = NOMBRE d'unités — un dortoir est
//      capacity:1 × quantity:8 (huit lits), pas capacity:8 ;
//   3. `descriptions[]` contient `pt` et `fr` en plus de `es`/`en` : le parseur DOIT les ignorer
//      sans les écrire (l'éditeur hifago est fermé à es/en) et les signaler via unsupportedLangs ;
//   4. une catégorie parfaitement valide peut avoir `descriptions: []` ET `photos: []` — c'est le
//      cas de 2 des 6 catégories réelles, jamais une anomalie.
export const LOBBY_ROOMS_OBSERVED_2026_08_26 = {
  data: [
    {
      category_id: 29376,
      name: "GLAMPING",
      type: "privada",
      capacity: 2,
      quantity: 3,
      descriptions: [
        { description: "Habitación con baño privado, agua caliente\n", lang: "es" },
        { description: "Room with private bathroom, hot water", lang: "en" },
        { description: "Quarto com banheiro privativo, água quente", lang: "pt" },
        { description: "Chambre avec salle de bain privée, eau chaude", lang: "fr" },
      ],
      photos: [
        { photo_id: 60107, url: "https://app.lobbypms.com/permanent/uploads/1157066d7610b43075.jpg" },
        { photo_id: 60108, url: "https://app.lobbypms.com/permanent/uploads/1157066d7613394959.jpg" },
      ],
      rooms: [
        { id: 718411, name: "EMBERA", type: "privada" },
        { id: 718412, name: "KUNA", type: "privada" },
        { id: 718413, name: "ZENU", type: "privada" },
      ],
    },
    {
      category_id: 9631,
      name: "VIDPOVO",
      type: "compartida",
      capacity: 1,
      quantity: 8,
      descriptions: [
        { description: "Dormitorio práctico y organizado con cortinas [8 camas]", lang: "es" },
        { description: "Practical and organized bedroom with curtains [8 beds]", lang: "en" },
      ],
      photos: [
        { photo_id: 60541, url: "https://app.lobbypms.com/permanent/uploads/1157064f271ab8fb20.jpg" },
      ],
      rooms: Array.from({ length: 8 }, (_, i) => ({
        id: 700000 + i,
        name: `Cama ${i + 1}`,
        type: "compartida",
      })),
    },
    // Catégorie sans aucun contenu éditorial — cas réel (2 des 6 catégories du compte), à garder
    // pour que la carte de prévisualisation soit toujours exercée sur sa branche "rien à montrer".
    {
      category_id: 49823,
      name: "CAMPER Van",
      type: "privada",
      capacity: 4,
      quantity: 2,
      descriptions: [],
      photos: [],
      rooms: [
        { id: 939246, name: "Habitación 1", type: "privada" },
        { id: 939247, name: "Habitación 2", type: "privada" },
      ],
    },
  ],
  meta: { total_records: 3, total_pages: 1 },
};

// Forme réellement observée de GET /api/v1/products (spec 24 §11.3). À retenir : un service ne
// porte NI photo, NI capacité, NI quantité, NI description — ces champs n'existent pas sur cette
// ressource, et aucun compte n'en fournira. `stock` est null quand `infinite_inventory` est vrai.
export const LOBBY_SERVICES_OBSERVED_2026_08_26 = {
  data: [
    { service_id: 494426, name: "YOGA session", value: 22000, infinite_inventory: true, stock: null },
    { service_id: 473220, name: "Ensayo hora", value: 40000, infinite_inventory: true, stock: null },
    { service_id: 566605, name: "Paddle boarding 4H", value: 135000, infinite_inventory: true, stock: null },
  ],
  meta: { total_records: 3, total_pages: 1 },
};

// Forme réellement observée le 2026-08-27 sur le compte Casa Kayam — GET /api/v2/available-rooms
// appelé SANS `category_id` (catalogue entier pour une nuit), relevé par la sonde de
// pms-nightly-contract-check via le relais. Ce que ce relevé a tranché, et qui était ouvert depuis
// le début du chantier :
//
//   C1 — RÉFUTÉ. L'hypothèse « Lobby ne cote que les catégories réservables » est fausse : les 6
//        catégories du compte sont cotées, avec une signature de champs IDENTIQUE
//        [available_rooms, category_id, name, plans, restrictions] et une disponibilité non nulle
//        pour toutes. Cette réponse ne porte AUCUN discriminant. Y compris pour 18013 et 49823,
//        qui figuraient parmi les catégories refusant un booking en 422 le 2026-07-06.
//   C5 — RÉPONDU. `restrictions` existe (il n'avait jamais été observé) et vaut {0,0,0} sur les
//        SIX. Aucune contrainte sur ce compte : lire défensivement et n'appliquer que si > 0 reste
//        la bonne règle, désormais fondée sur un constat et non sur une précaution.
//
// Troisième constat, non cherché : `plans[].prices[]` compte AUTANT D'ENTRÉES QUE LA CAPACITÉ
// d'une unité — GLAMPING (capacity 2) → 2 prix, CAMPER Van (capacity 4) → 4 prix, les dortoirs
// (capacity 1) → 1 prix. Les prix Lobby sont donc par NIVEAU D'OCCUPATION, un modèle que hifago
// n'a pas (unit = per_person | per_two | per_house). Ce constat fondait « Lobby n'est jamais la
// source du prix », RÉVISÉ le 2026-10-23 : le prix public est le prix Lobby, lu au niveau
// d'occupation exact du produit (per_two : 2, sinon 1 — quoteLobbyStay.ts, spec 24 §0).
//
// ⚠️ Ce qui est OBSERVÉ ici : les identifiants, `available_rooms`, `restrictions`, la liste des
// clés, et le NOMBRE de plans et de prix. Ce qui ne l'est PAS : les valeurs de prix, les
// identifiants et noms de plan, et les noms de catégorie ci-dessous — reconstruits pour donner un
// objet complet. Depuis le 2026-10-23 le parseur de réservation LIT les prix (prix public = prix
// Lobby) : la clé est donc celle de la doc, `value` (la fixture écrivait `price`, que personne ne
// lisait), et le plan porte le nom `STANDARD_RATE` de la doc. Le contrat nocturne, lui, ne fait
// toujours que compter les prix.
export const LOBBY_AVAILABILITY_OBSERVED_2026_08_27 = {
  date: "2026-09-26",
  categories: [
    { category_id: 9629, name: "Dormitorio A", available_rooms: 4, restrictions: { min_stay: 0, max_stay: 0, lead_days: 0 },
      plans: [{ plan_id: 1, name: "STANDARD_RATE", prices: [{ people: 1, value: 45000 }] }] },
    { category_id: 9631, name: "VIDPOVO", available_rooms: 8, restrictions: { min_stay: 0, max_stay: 0, lead_days: 0 },
      plans: [{ plan_id: 1, name: "STANDARD_RATE", prices: [{ people: 1, value: 45000 }] }] },
    { category_id: 18013, name: "Dormitorio B", available_rooms: 12, restrictions: { min_stay: 0, max_stay: 0, lead_days: 0 },
      plans: [{ plan_id: 1, name: "STANDARD_RATE", prices: [{ people: 1, value: 45000 }] }] },
    { category_id: 29376, name: "GLAMPING", available_rooms: 3, restrictions: { min_stay: 0, max_stay: 0, lead_days: 0 },
      plans: [{ plan_id: 1, name: "STANDARD_RATE", prices: [{ people: 1, value: 120000 }, { people: 2, value: 180000 }] }] },
    { category_id: 36572, name: "Dormitorio C", available_rooms: 6, restrictions: { min_stay: 0, max_stay: 0, lead_days: 0 },
      plans: [{ plan_id: 1, name: "STANDARD_RATE", prices: [{ people: 1, value: 45000 }] }] },
    { category_id: 49823, name: "CAMPER Van", available_rooms: 2, restrictions: { min_stay: 0, max_stay: 0, lead_days: 0 },
      plans: [{ plan_id: 1, name: "STANDARD_RATE", prices: [
        { people: 1, value: 90000 }, { people: 2, value: 140000 },
        { people: 3, value: 180000 }, { people: 4, value: 210000 },
      ] }] },
  ],
};

// Codes de motif d'annulation acceptés par LobbyPMS — liste FERMÉE
// (docs/3-integrations/lobby_pms_api.md § Cancel Booking). Envoyer autre chose, y compris une
// phrase parfaitement claire en espagnol, donne un 422 INPUT_PARAMETERS.
const LOBBY_CANCELLATION_REASONS = new Set(["NS", "RC", "RE", "TTC", "CC", "OTH"]);

let scenario: PmsFixtureScenario = {};

export function setPmsFixtureScenario(next: PmsFixtureScenario): void {
  scenario = next;
}

// COMPTEUR D'APPELS, par chemin. Ajouté le 2026-08-28 pour une raison précise : la réduction de
// charge apportée par R1 (suppression du filtre `category_id`) est INVISIBLE autrement — le
// résultat fonctionnel est identique, seul le nombre d'allers-retours change. Un gain qu'aucun test
// ne compte est un gain qu'une refonte future annulera sans que rien ne rougisse.
const callsByPath = new Map<string, number>();

export function resetPmsFixtureCalls(): void {
  callsByPath.clear();
}

export function getPmsFixtureCalls(path?: string): number {
  if (path !== undefined) return callsByPath.get(path) ?? 0;
  return [...callsByPath.values()].reduce((total, count) => total + count, 0);
}

function send(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// Taille de page OBSERVÉE le 2026-08-28 sur GET /api/v2/available-rooms
// (`meta.records_per_page`). Un mois (31 nuits, 32 avec la borne inclusive) tient donc largement
// dans une page — c'est ce chiffre qui autorise l'appel unique par mois du chemin de réservation.
const RECORDS_PER_PAGE = 100;

// Énumère les nuits d'une plage. `endDateInclusive` vaut `true` par défaut parce que c'est ce que
// LobbyPMS fait RÉELLEMENT (mesuré le 2026-08-28) ; la production envoie néanmoins
// `end_date = dernière nuit + 1`, donc reçoit une nuit de plus qu'elle n'en demande — écartée par
// sa date, jamais par son rang. Un scénario peut rejouer le monde exclusif avec `false`.
// Borné à 400 nuits — au-delà c'est une requête aberrante, et une fixture qui bouclerait sans fin
// sur des dates mal formées vaut moins qu'une fixture qui s'arrête.
// ⚠️ `addDaysIso` plutôt qu'un curseur `Date` maison (converge le 2026-08-29) : c'était la
// TROISIÈME implémentation de l'incrément de date civile dans ce dépôt, et une fixture qui dérive
// de la production est le défaut que l'en-tête de ce fichier dénonce lui-même. La comparaison est
// LEXICOGRAPHIQUE — sur `yyyy-MM-dd` zéro-padé elle coïncide exactement avec l'ordre chronologique,
// et elle évite de reparser deux dates à chaque tour.
function enumerateNights(startDate: string, endDate: string, endDateInclusive: boolean): string[] {
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  if (!ISO_DATE.test(startDate)) return [];
  const nights: string[] = [];
  const last = ISO_DATE.test(endDate) ? endDate : null;
  let cursor = startDate;

  for (let guard = 0; guard < 400; guard += 1) {
    if (last !== null) {
      if (endDateInclusive ? cursor > last : cursor >= last) break;
    } else if (guard > 0) {
      break; // pas d'`end_date` exploitable : une seule nuit, comme un appel mono-nuit.
    }
    nights.push(cursor);
    cursor = addDaysIso(cursor, 1);
  }
  return nights;
}

// Le catalogue d'une nuit. Avec `category_id`, Lobby ne cote que celle-là ; sans, il cote tout —
// c'est cette seconde forme que le chemin R1 consomme depuis le 2026-08-28.
function categoriesForNight(night: string, categoryId: number | null): unknown[] {
  const entry = scenario.nightAvailabilityByDate?.[night];
  // Les prix de la nuit, sinon ceux du scénario ; sans eux, `plans: []` comme avant le 2026-10-23.
  const plansFor = (id: number) => {
    const prices = entry?.pricesByCategory?.[id] ?? scenario.pricesByCategory?.[id];
    return prices ? [{ id: null, name: "STANDARD_RATE", prices }] : [];
  };

  if (entry?.availableByCategory) {
    const quoted = Object.entries(entry.availableByCategory).map(([id, available]) => ({
      category_id: Number(id),
      available_rooms: available,
      plans: plansFor(Number(id)),
    }));
    return categoryId === null ? quoted : quoted.filter((c) => c.category_id === categoryId);
  }

  const availableRooms = entry?.availableRooms ?? 5;
  if (categoryId !== null) {
    return [{ category_id: categoryId, available_rooms: availableRooms, plans: plansFor(categoryId) }];
  }
  // Sans `catalogCategoryIds`, la réponse ne cote RIEN plutôt qu'une catégorie inventée : un test
  // en mode catalogue mal câblé doit échouer, pas passer sur une disponibilité fabriquée.
  return (scenario.catalogCategoryIds ?? []).map((id) => ({
    category_id: id,
    available_rooms: availableRooms,
    plans: plansFor(id),
  }));
}

export function startPmsFixtureServer(port: number): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    // Le corps était jeté jusqu'au 2026-08-27 (« personne ne le consomme »). Il est désormais lu
    // pour UNE raison précise : valider `cancellation_reason` comme le vrai LobbyPMS le fait — voir
    // la route cancel-booking plus bas. Borné à 64 Ko, ce qui est très au-delà de tout corps réel
    // de cette API et évite de rebufferiser sans limite.
    const chunks: Buffer[] = [];
    let received = 0;
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received <= 65536) chunks.push(chunk);
    });
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      callsByPath.set(url.pathname, (callsByPath.get(url.pathname) ?? 0) + 1);
      if (req.method === "GET" && url.pathname === "/api/v1/rooms") {
        send(res, 200, scenario.rooms ?? { data: [], meta: { total_records: 0 } });
        return;
      }

      const bookingDetailMatch = url.pathname.match(/^\/api\/v1\/bookings\/(\d+)$/);
      if (req.method === "GET" && bookingDetailMatch) {
        const bookingId = Number(bookingDetailMatch[1]);
        const entry = scenario.bookingDetailByStatus?.get(bookingId);
        if (!entry) {
          send(res, 404, { message: "No query results for model [App\\Models\\Booking]." });
          return;
        }
        send(res, entry.status, entry.body);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/v1/bookings") {
        send(
          res,
          scenario.createBookingStatus ?? 200,
          scenario.createBookingBody ?? { booking: { booking_id: 90000001, room_id: 90000002 } }
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v2/available-rooms") {
        // `availableRoomsDelayMs` (2026-10-23) : une réponse qui tarde, pour prouver qu'un devis de
        // /pago échoue fermé sur un délai dépassé au lieu de bloquer la page.
        const reply = (status: number, body: unknown) => {
          if (scenario.availableRoomsDelayMs) setTimeout(() => send(res, status, body), scenario.availableRoomsDelayMs);
          else send(res, status, body);
        };
        const startDate = url.searchParams.get("start_date") ?? "";
        const endDate = url.searchParams.get("end_date") ?? "";
        const categoryId = url.searchParams.has("category_id")
          ? Number(url.searchParams.get("category_id"))
          : null;

        // Charge utile OBSERVÉE rejouée telle quelle (relevé du 2026-08-27) — prioritaire sur toute
        // synthèse, et volontairement insensible à `end_date` : elle témoigne d'UNE nuit réelle, et
        // la démultiplier sur une plage fabriquerait une observation qui n'a jamais eu lieu.
        // Réservée au mode catalogue, comme l'appel qui l'a produite.
        if (categoryId === null && scenario.availableRoomsCatalog !== undefined) {
          reply(200, scenario.availableRoomsCatalog);
          return;
        }

        // ⚠️ ICI EST LE CORRECTIF DU 2026-08-28. `end_date` n'était lu par personne : ce serveur
        // répondait UNE nuit quoi qu'on lui demande. Il énumère désormais la plage, ce qui est la
        // seule façon qu'un test « un appel pour N nuits » prouve quoi que ce soit.
        const nights =
          scenario.rangeBehaviour === "ignores_end_date"
            ? [startDate].filter(Boolean)
            : enumerateNights(startDate, endDate, scenario.endDateInclusive !== false);

        // Une réponse HTTP n'a qu'un statut : la première nuit de la plage qui en déclare un
        // l'emporte. Rendre 200 alors qu'une nuit de la plage devait échouer serait précisément le
        // genre de complaisance qui a laissé passer deux bugs le 2026-08-27.
        const failing = nights.find((night) => scenario.nightAvailabilityByDate?.[night]?.status !== undefined);
        if (failing !== undefined) {
          reply(scenario.nightAvailabilityByDate?.[failing]?.status ?? 500, {
            message: `fixture: nuit ${failing} en erreur`,
          });
          return;
        }

        const records = nights.map((night) => ({ date: night, categories: categoriesForNight(night, categoryId) }));

        // Forme mono-nuit = celle qui est OBSERVÉE. Forme de plage sous `data[]` = HYPOTHÈSE, non
        // confirmée : `available-rooms` est documenté « over a date range » et personne ne l'a
        // jamais essayé. C'est exactement ce que la sonde de pms-nightly-contract-check doit
        // trancher — jusque-là, aucun code de production ne s'appuie sur cette forme-ci.
        if (records.length === 1) {
          reply(200, records[0]);
          return;
        }
        // `meta` reproduit la forme OBSERVÉE le 2026-08-28 : { total_records, current_page,
        // records_per_page: 100, total_pages }. `records_per_page` est ce qui dit qu'un mois tient
        // dans une page — la seule raison pour laquelle la production peut se permettre un appel
        // unique par mois sans jamais paginer.
        //
        // ⚠️ ET LA FIXTURE PAGINE VRAIMENT (corrigé le 2026-08-28 après revue). Elle rendait
        // d'abord TOUS les enregistrements tout en annonçant `records_per_page: 100` — une réponse
        // physiquement impossible (151 enregistrements sur une page de 100), donc plus complaisante
        // que le vrai service. Une évolution qui élargirait la fenêtre au-delà de 100 nuits aurait
        // été VERTE ici et cassée en production. Elle tronque désormais comme LobbyPMS le ferait ;
        // c'est la vérification de couverture, côté domaine, qui doit alors échouer bruyamment.
        const page = records.slice(0, RECORDS_PER_PAGE);
        reply(200, {
          data: page,
          meta: {
            total_records: records.length,
            current_page: 1,
            records_per_page: RECORDS_PER_PAGE,
            total_pages: Math.max(1, Math.ceil(records.length / RECORDS_PER_PAGE)),
          },
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/v1/booking/add-product-service") {
        send(
          res,
          scenario.addProductServiceStatus ?? 200,
          scenario.addProductServiceBody ?? { sale: { id: 90000003, total: 0 } }
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/products") {
        send(res, 200, scenario.services ?? { data: [], meta: { total_records: 0, total_pages: 1 } });
        return;
      }

      const cancelBookingMatch = url.pathname.match(/^\/api\/v1\/cancel-booking\/(\d+)$/);
      if (req.method === "POST" && cancelBookingMatch) {
        const bookingId = Number(cancelBookingMatch[1]);
        const entry = scenario.cancelBookingByStatus?.get(bookingId);
        if (entry) {
          send(res, entry.status, entry.body);
          return;
        }

        // DURCI LE 2026-08-27, APRÈS QUE CETTE FIXTURE A LAISSÉ PASSER DEUX BUGS EN PRODUCTION DE
        // TEST. Elle répondait `200 {cancel_booking}` à absolument tout : plus polie que le vrai
        // LobbyPMS, donc incapable de révéler que (a) `cancellation_reason` est un CODE fermé et
        // non du texte libre, et (b) le succès ne revient PAS avec un statut 200. Les deux ont été
        // découverts contre le compte réel, après déploiement — exactement ce qu'une fixture existe
        // pour éviter.
        //
        // Une fixture qui accepte plus que le vrai service ne teste pas le service : elle teste
        // qu'on sait parler à une version imaginaire et complaisante de celui-ci.
        let reason: unknown;
        try {
          reason = (JSON.parse(rawBody || "{}") as { cancellation_reason?: unknown }).cancellation_reason;
        } catch {
          reason = undefined;
        }
        if (typeof reason !== "string" || !LOBBY_CANCELLATION_REASONS.has(reason)) {
          send(res, 422, {
            error_code: "INPUT_PARAMETERS",
            error: "The selected cancellation reason is invalid.",
          });
          return;
        }

        // Statut délibérément ≠ 200 : observé le 2026-08-27 contre le compte réel, un succès
        // n'arrive pas en 200. La valeur EXACTE n'a pas été capturée — et c'est sans importance,
        // parce que c'est précisément le point : un client correct lit le corps
        // (`{"cancel_booking": id}`), jamais le statut. Si un jour ce test rougit parce que
        // quelqu'un a recodé `status === 201`, il aura fait son travail.
        send(res, 201, { cancel_booking: bookingId });
        return;
      }

      send(res, 404, { message: "not found in fixture server" });
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((closeResolve) => server.close(() => closeResolve())),
      });
    });
  });
}
