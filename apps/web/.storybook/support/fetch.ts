import { spyOn } from "storybook/test";

// Simulation des Route Handlers `/api/*` dans le Storybook (2026-10-01). Un écran client
// (disponibilité PMS, création du paiement, statut de commande, suggestions…) appelle `fetch` ;
// sans serveur Next derrière, chaque appel répondrait 404. Une story DÉCLARE donc ses réponses :
//
//   parameters: { simularFetch: { "/api/payments/create": { status: 500 } } }
//
// Branché une fois pour toutes par le `beforeEach` de `.storybook/preview.tsx`. Les clés sont des
// PRÉFIXES de chemin ; la première qui correspond gagne. `demora: "nunca"` laisse la requête
// pendante : c'est l'état « envoi en cours » d'un formulaire, que Jérôme doit pouvoir regarder.
//
// ⚠️ Un `/api/*` NON déclaré part vers le vrai `fetch`, donc vers un 404 visible en console : un
// appel oublié doit se voir, pas être avalé par un succès factice.

export type RespuestaSimulada = {
  status?: number;
  body?: unknown;
  /** Millisecondes avant la réponse, ou `"nunca"` pour une requête qui ne répond jamais. */
  demora?: number | "nunca";
};

export type RutasSimuladas = Record<string, RespuestaSimulada | ((url: URL, init?: RequestInit) => RespuestaSimulada)>;

// Appel best-effort que CHAQUE ajout au panier déclenche (`CartContext.addLine`) : sans ce défaut,
// toute story qui remplit le panier salirait la console d'un 404 sans rapport avec ce qu'elle montre.
const POR_DEFECTO: RutasSimuladas = {
  "/api/cart/attribution": { status: 204 },
  // Après `create_order`, `CheckoutForm` réserve les nuits PMS : la commande sans ligne PMS répond
  // `{ ok: true }`, c'est le cas courant.
  "/api/pms/reserve-nights": { body: { ok: true } },
  // ⚠️ PENDANTE par défaut, et c'est voulu : une réponse avec `init_point` ferait
  // `window.location.href = …` et ferait quitter le Storybook à l'iframe. Cliquer « Payer » montre
  // donc « Redirigiendo a Mercado Pago… », ce que voit le client juste avant de partir.
  "/api/payments/create": { demora: "nunca" },
  // Le champ de recherche reprend `?q=` de l'URL et demande aussitôt des suggestions : sans ce
  // défaut, toute story « recherche » salirait la console. Une story qui veut des suggestions les
  // déclare (Écrans/Accueil, « suggestions »).
  "/api/catalogo/sugerencias": { body: { sugerencias: [] } },
};

export function simularFetch(rutas: RutasSimuladas = {}) {
  const todas = { ...POR_DEFECTO, ...rutas };
  const fetchReal = globalThis.fetch.bind(globalThis);
  const espia = spyOn(globalThis, "fetch").mockImplementation(async (entrada, init) => {
    const brut = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const url = new URL(brut, window.location.origin);
    const clave = Object.keys(todas).find((prefijo) => url.pathname.startsWith(prefijo));
    if (!clave) return fetchReal(entrada, init);
    const definicion = todas[clave];
    const { status = 200, body = {}, demora = 0 } =
      typeof definicion === "function" ? definicion(url, init) : definicion;
    if (demora === "nunca") return new Promise<Response>(() => {});
    if (demora > 0) await new Promise((resolver) => setTimeout(resolver, demora));
    const sinCuerpo = status === 204 || status === 304;
    return new Response(sinCuerpo ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  return () => espia.mockRestore();
}
