// Ce qu'un job écrit de ses erreurs — `job_heartbeats.last_error` (affiché aux admins), les
// `last_error` de ses files, ses journaux et sa réponse HTTP — ne contient JAMAIS la valeur d'un
// secret (hifago/CLAUDE.md §8) : seulement un nom ou un code d'erreur, un statut HTTP, un message
// court.
//
// Deux défenses, parce que l'une ne suffit pas :
//   1. les appelants composent leurs messages à partir de pièces sûres (un `kind`, un statut, un
//      `error.name`), jamais à partir d'un corps de réponse ou d'un `String(err)` brut ;
//   2. tout texte qui sort passe quand même par `redactSecrets`. Un message d'erreur de `fetch`
//      sous Deno CONTIENT l'URL de la requête — « error sending request for url (…?api_token=…) » —
//      et une page d'erreur HTML d'un proxy peut la recopier : le jeton Lobby voyage en query string.
//
// `redactSecrets` masque les secrets CONNUS (leurs valeurs exactes, passées par l'appelant) et les
// formes reconnaissables d'un secret inconnu (paramètre de requête, Bearer, JWT, clés Supabase,
// Resend, Mercado Pago).

const MASK = "[secret]";
const MAX_LENGTH = 300;
/** Les motifs ne parcourent jamais plus que ça (les secrets CONNUS sont masqués sur tout le texte). */
const SCAN_LIMIT = 4_000;

// Les formes d'un secret qu'on reconnaît sans le connaître. Aucun quantificateur ne suit une
// frontière ambiguë (`\b` avant une classe qui contient `-`) : un `(?<!…)` explicite à la place,
// sinon un texte fait de motifs presque complets coûte un temps quadratique.
const PATTERNS: Array<[RegExp, string]> = [
  // Paramètre de requête porteur d'un secret : `api_token=…`, `token=…`, signatures d'URL signées —
  // en clair ou encodé dans une autre URL (`api_token%3D…`).
  [/([?&;\s"'(]|%26|%3F|^)(api_token|access_token|token|apikey|api_key|key|signature|sig|x-amz-signature|x-amz-credential)(=|%3D)[^&\s"'<>)]+/gi, `$1$2$3${MASK}`],
  // Le même secret en JSON : `"api_token":"…"`.
  [/"(api_token|access_token|token|apikey|api_key|password|secret|client_secret)"\s*:\s*"[^"]*"/gi, `"$1":"${MASK}"`],
  // En-têtes recopiés (le schéma d'Authorization compris : sa valeur est le jeton qui suit).
  [/\bauthorization\s*:\s*(?:(?:Bearer|Basic)\s+)?[^\s"',;)<>]+/gi, `Authorization: ${MASK}`],
  [/\b(apikey|x-relay-secret)\s*:\s*[^\s"',;)<>]+/gi, `$1: ${MASK}`],
  [/\bBearer\s+[^\s"',;)<>]+/gi, `Bearer ${MASK}`],
  [/\bBasic\s+[A-Za-z0-9+/=]{8,}/g, `Basic ${MASK}`],
  // JWT (clés Supabase legacy anon/service_role, jetons de session).
  [/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, MASK],
  [/(?<![A-Za-z0-9_-])sb_(secret|publishable)_[A-Za-z0-9_-]+/g, MASK],
  // Clés Resend et jetons Mercado Pago.
  [/(?<![A-Za-z0-9_])re_[A-Za-z0-9_]{16,}/g, MASK],
  [/(?<![A-Za-z0-9_-])(APP_USR|TEST)-[0-9A-Za-z-]{20,}/g, MASK],
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `maxLength` : longueur rendue (défaut 300 — un motif d'erreur court). Le masquage se fait TOUJOURS
 * avant la coupe : un secret à cheval sur la coupure échapperait sinon au masquage par valeur.
 */
export function redactSecrets(
  text: string,
  secrets: ReadonlyArray<string | null | undefined> = [],
  maxLength: number = MAX_LENGTH
): string {
  let out = text;
  // Les plus longs d'abord : un secret qui en contient un autre est masqué entier.
  const known = [...new Set(secrets.filter((s): s is string => typeof s === "string" && s.trim().length >= 8))]
    .map((s) => s.trim())
    .sort((a, b) => b.length - a.length);
  for (const secret of known) {
    out = out.replace(new RegExp(escapeRegExp(secret), "g"), MASK);
    // Le même secret encodé dans une URL (`%2B`, `%2F`…) reste le même secret.
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) out = out.replace(new RegExp(escapeRegExp(encoded), "g"), MASK);
  }
  // Les secrets connus sont masqués sur tout le texte (linéaire) ; les motifs, sur son début seulement
  // — ce qui dépasse SCAN_LIMIT est coupé de toute façon avant de sortir.
  if (out.length > SCAN_LIMIT) out = out.slice(0, SCAN_LIMIT);
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  const limit = Math.min(maxLength, SCAN_LIMIT);
  return out.length > limit ? `${out.slice(0, limit)}…` : out;
}

/**
 * Une erreur levée (réseau, délai, RPC) en une ligne sûre : son nom et son message, masqués et
 * courts. Le nom seul dit déjà l'essentiel (`TimeoutError`, `TypeError` d'un fetch).
 */
export function describeJobError(err: unknown, secrets: ReadonlyArray<string | null | undefined> = []): string {
  if (err instanceof Error) {
    const message = err.message ? `: ${err.message}` : "";
    return redactSecrets(`${err.name}${message}`, secrets);
  }
  if (typeof err === "object" && err !== null && "message" in err) {
    // Erreur PostgREST/Supabase ({ code, message }) : son code et son message.
    const { code, message } = err as { code?: unknown; message?: unknown };
    return redactSecrets(`${typeof code === "string" ? `${code} ` : ""}${String(message)}`.trim(), secrets);
  }
  return redactSecrets(String(err), secrets);
}
