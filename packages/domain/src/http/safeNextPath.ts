// Destination de retour (`?next=`) après connexion, confirmation d'email ou 2FA — UNE seule garde
// pour les deux apps, au lieu d'un `startsWith("/")` recopié à chaque page (interdit par la règle
// de lint no-restricted-syntax d'eslint.rules.mjs, qui renvoie ici). Ne rend jamais qu'un chemin interne
// au site (`pathname + search + hash`), sinon `fallback`. Fonction PURE : API URL standard
// seulement (navigateur ET Node), aucun import Next.
const SENTINELLE = "http://hifago.invalid";

export function safeNextPath(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return fallback;

  const parsed = new URL(raw, SENTINELLE);
  if (parsed.origin !== SENTINELLE) return fallback;

  // Deuxième passe, à ne pas retirer : le parseur normalise `\` et les segments `.`/`..` APRÈS avoir
  // classé l'entrée comme relative — le chemin obtenu peut donc commencer par `//`, qu'un
  // navigateur lit comme une autre origine. On revérifie la sortie elle-même.
  const out = parsed.pathname + parsed.search + parsed.hash;
  return new URL(out, SENTINELLE).origin === SENTINELLE ? out : fallback;
}
