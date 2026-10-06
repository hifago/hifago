// Débit d'un job vers un fournisseur limité en requêtes par seconde : le délai à respecter avant
// l'appel SUIVANT, lu sur la réponse de l'appel courant. Pur — testé sans réseau.
//
// En-têtes de l'IETF (draft-ietf-httpapi-ratelimit-headers-06), que Resend rend à chaque réponse :
//   - `ratelimit-remaining` : requêtes restantes dans la fenêtre courante ;
//   - `ratelimit-reset` : secondes avant la remise à zéro de la fenêtre.
//
//   - jamais moins que `minSpacingMs` entre deux appels (le débit choisi par le job) ;
//   - fenêtre épuisée (`remaining = 0`) : attendre sa remise à zéro ;
//   - attente plus longue que `maxWaitMs` : null — le job rend le reste de son lot au passage
//     suivant plutôt que de dormir sur son budget (ou de provoquer un 429).
// Un en-tête absent ou illisible ne compte pas : seul l'espacement minimal s'applique.

function readSeconds(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function delayBeforeNextCall(
  headers: Pick<Headers, "get">,
  minSpacingMs: number,
  maxWaitMs: number
): number | null {
  const remaining = readSeconds(headers.get("ratelimit-remaining"));
  const resetSeconds = readSeconds(headers.get("ratelimit-reset"));
  if (remaining !== 0 || resetSeconds === null) return minSpacingMs;
  const waitMs = Math.max(minSpacingMs, Math.ceil(resetSeconds * 1000));
  return waitMs > maxWaitMs ? null : waitMs;
}
