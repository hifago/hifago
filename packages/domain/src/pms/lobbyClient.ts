// Client LobbyPMS générique — port du pattern portalService.js `call()` (app legacy,
// src/services/portalService.js) vers fetch natif : ne lève JAMAIS d'exception sur un 4xx/5xx,
// laisse l'appelant décider (un 422 INPUT_PARAMETERS ou un 404 sur booking annulé sont des
// réponses NORMALES à traiter, pas des cas d'erreur, cf. client cahier des charges §5).
//
// Principe central (spec 21 §3) : baseUrl/apiToken sont TOUJOURS des paramètres explicites de
// fonction, jamais lus depuis process.env/Deno.env à l'intérieur de ce module. C'est ce qui permet
// à ce module identique de tourner dans un Route Handler Next.js (Node) ET une Edge Function
// Supabase (Deno), et d'être redirigé vers un serveur de fixtures local en test.

export const LOBBY_DEFAULT_BASE_URL = "https://api.lobbypms.com";

// Quota d'appels rapporté par Lobby. LobbyPMS est une application Laravel (constaté dans ses corps
// d'erreur : « No query results for model [App\\Models\\Booking] »), dont le middleware `api` par
// défaut est `throttle:60,1` — et un plafond de 60 appels par fenêtre a effectivement été mesuré en
// préprod le 2026-08-28. Ces trois en-têtes sont ce qui permet de le CONSTATER au lieu de le
// déduire : `X-RateLimit-Limit` donne le chiffre exact, et son évolution selon l'établissement
// interrogé dira si le seau est par jeton ou global.
//
// Liste blanche stricte : on ne transporte jamais l'objet `Headers` entier (il peut porter un
// `set-cookie`), et ces trois-là sont des en-têtes de RÉPONSE — journalisables, contrairement à
// l'URL de la requête qui porte `api_token` (CLAUDE.md §8).
export interface LobbyRateLimit {
  limit: number | null;
  remaining: number | null;
  retryAfterSeconds: number | null;
}

export interface LobbyCallResult<T = unknown> {
  status: number;
  body: T;
  rateLimit: LobbyRateLimit;
}

function readPositiveIntHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function lobbyCall<T = unknown>(
  method: "GET" | "POST",
  baseUrl: string,
  path: string,
  apiToken: string,
  options: {
    params?: Record<string, string | number>;
    data?: unknown;
    relaySecret?: string;
    timeoutMs?: number;
    noRedirect?: boolean;
  } = {}
): Promise<LobbyCallResult<T>> {
  const url = new URL(path, baseUrl);
  if (method === "GET") {
    url.searchParams.set("api_token", apiToken);
    for (const [key, value] of Object.entries(options.params ?? {})) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (options.relaySecret) {
    headers["X-Relay-Secret"] = options.relaySecret;
  }

  // `timeoutMs` est OPT-IN : seule la réservation du tunnel (/api/pms/reserve-nights) le pose
  // aujourd'hui. Un dépassement lève une `TimeoutError` (DOMException) — pour un POST, l'issue est
  // alors INCONNUE (Lobby a pu créer le booking), jamais un refus. Les Edge Functions, qui importent
  // ce module tel quel sous Deno, gardent leur comportement tant qu'elles ne le passent pas.
  const response = await fetch(url.toString(), {
    method,
    headers,
    body: method === "POST" ? JSON.stringify({ api_token: apiToken, ...(options.data as object) }) : undefined,
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
    // Une écriture ne suit jamais une redirection : `fetch` transformerait le POST en GET, et la
    // réponse finale masquerait un booking peut-être déjà créé. Le 3xx reste visible à l'appelant.
    redirect: options.noRedirect ? "manual" : "follow",
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Réponse non-JSON (rare, ex. page d'erreur HTML d'un proxy amont) — forme défensive, jamais
    // une exception (client cahier des charges §5 : parser défensivement, ne jamais supposer un
    // format garanti).
    body = { raw: text };
  }

  return {
    status: response.status,
    body: body as T,
    rateLimit: {
      limit: readPositiveIntHeader(response.headers, "x-ratelimit-limit"),
      remaining: readPositiveIntHeader(response.headers, "x-ratelimit-remaining"),
      // `Retry-After` peut être une date HTTP plutôt qu'un nombre de secondes (RFC 9110) ; on ne
      // retient que la forme numérique, la forme date retombe sur null plutôt que sur une valeur
      // fabriquée.
      retryAfterSeconds: readPositiveIntHeader(response.headers, "retry-after"),
    },
  };
}

export function getLobbyRooms(baseUrl: string, apiToken: string, page?: number, relaySecret?: string) {
  return lobbyCall("GET", baseUrl, "/api/v1/rooms", apiToken, {
    params: page ? { page } : undefined,
    relaySecret,
  });
}

// GET /api/v1/products — services/activités du compte Lobby (jamais des chambres). Réponse
// { data: [{ service_id, name, value, infinite_inventory, stock }], meta }. Champ nommé
// service_id côté Lobby — le Route Handler appelant (jamais ce module générique) est responsable
// de le mapper vers ce que hifago appelle lobby_product_id ailleurs, cohérent avec l'usage de ce
// même identifiant comme product_id dans addLobbyProductService.
export function getLobbyProducts(baseUrl: string, apiToken: string, page?: number, relaySecret?: string) {
  return lobbyCall("GET", baseUrl, "/api/v1/products", apiToken, {
    params: page ? { page } : undefined,
    relaySecret,
  });
}

// GET /api/v2/available-rooms pour UNE nuit (start_date=date, end_date=date+1) — la forme V2 groupe
// les prix par plan (plans[].prices[]), pas directement categories[].prices[] comme la V1.
//
// ⚠️ N'EST PLUS SUR LE CHEMIN DE RÉSERVATION depuis le 2026-08-28 (R1) : le calendrier lit
// désormais le catalogue entier via getLobbyAvailableRooms, ce qui divise par six le coût d'un mois
// affiché chez Casa Kayam. Cette fonction reste utilisée par la SONDE de contrôle de contrat, qui
// compare précisément la réponse filtrée à la réponse non filtrée pour vérifier que la prémisse de
// R1 tient sur un vrai compte.
export function getLobbyNightAvailability(
  baseUrl: string,
  apiToken: string,
  categoryId: number,
  date: string,
  nextDate: string,
  relaySecret?: string
) {
  return lobbyCall("GET", baseUrl, "/api/v2/available-rooms", apiToken, {
    params: { category_id: categoryId, start_date: date, end_date: nextDate },
    relaySecret,
  });
}

// GET /api/v2/available-rooms SANS `category_id` — la réponse porte un tableau `categories[]`, donc
// omettre le filtre revient à demander le catalogue entier pour la nuit.
//
// PROMUE SUR LE CHEMIN DE RÉSERVATION le 2026-08-28 (R1). Elle était jusque-là réservée au job
// nocturne d'observation ; sa forme ayant été OBSERVÉE le 2026-08-27 (les 6 catégories de Casa
// Kayam cotées en une seule réponse, signature de champs identique), le calendrier s'en sert
// désormais et un établissement de 6 produits liés passe de 6 appels par nuit à 1.
//
// Ce que cet appel a tranché, et que rien d'autre ne pouvait :
//   C1 — RÉFUTÉ : Lobby cote TOUTES les catégories, y compris celles qui refusent un booking en
//        422. La réponse ne porte aucun discriminant.
//   C5 — RÉPONDU : restrictions{min_stay, max_stay, lead_days} = {0,0,0} sur les six.
export function getLobbyAvailableRooms(
  baseUrl: string,
  apiToken: string,
  date: string,
  nextDate: string,
  relaySecret?: string
) {
  return lobbyCall("GET", baseUrl, "/api/v2/available-rooms", apiToken, {
    params: { start_date: date, end_date: nextDate },
    relaySecret,
  });
}

export interface CreateLobbyBookingInput {
  categoryId: number;
  startDate: string;
  endDate: string;
  totalAdults: number;
  totalChildren?: number;
  holderName: string;
  ratesPerDay: { date: string; price: number }[];
  note?: string;
}

// rates_per_day[].price est le tarif DÉJÀ NET (remise appliquée, quantité encodée) — Lobby ne
// multiplie jamais par occupants ni n'applique de remise propre (piège confirmé, client cahier des
// charges §5). L'appelant (Route Handler) est responsable d'envoyer un prix déjà net.
export function createLobbyBooking(
  baseUrl: string,
  apiToken: string,
  input: CreateLobbyBookingInput,
  relaySecret?: string,
  timeoutMs?: number
) {
  return lobbyCall("POST", baseUrl, "/api/v1/bookings", apiToken, {
    data: {
      category_id: input.categoryId,
      start_date: input.startDate,
      end_date: input.endDate,
      total_adults: input.totalAdults,
      total_children: input.totalChildren,
      holder_name: input.holderName,
      rates_per_day: input.ratesPerDay,
      note: input.note,
    },
    relaySecret,
    timeoutMs,
    noRedirect: true,
  });
}

export function addLobbyProductService(
  baseUrl: string,
  apiToken: string,
  bookingId: number,
  items: { productId: number; qty: number }[],
  relaySecret?: string,
  timeoutMs?: number
) {
  return lobbyCall("POST", baseUrl, "/api/v1/booking/add-product-service", apiToken, {
    data: {
      booking_id: bookingId,
      items: items.map((item) => ({ product_id: item.productId, cant: item.qty })),
    },
    relaySecret,
    timeoutMs,
    noRedirect: true,
  });
}

export function getLobbyBookingDetail(baseUrl: string, apiToken: string, bookingId: number, relaySecret?: string) {
  return lobbyCall("GET", baseUrl, `/api/v1/bookings/${encodeURIComponent(String(bookingId))}`, apiToken, {
    relaySecret,
  });
}

export function cancelLobbyBooking(
  baseUrl: string,
  apiToken: string,
  bookingId: number,
  cancellationReason: string,
  description?: string,
  relaySecret?: string
) {
  return lobbyCall(
    "POST",
    baseUrl,
    `/api/v1/cancel-booking/${encodeURIComponent(String(bookingId))}`,
    apiToken,
    { data: { cancellation_reason: cancellationReason, description }, relaySecret }
  );
}
