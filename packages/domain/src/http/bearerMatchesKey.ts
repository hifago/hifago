// L'en-tête `Authorization` d'une requête porte-t-il exactement `Bearer <clé attendue>` ?
//
// Comparaison à TEMPS CONSTANT : on compare les EMPREINTES SHA-256 des deux valeurs (32 octets
// chacune, quelle que soit la longueur reçue), octet par octet et sans sortie anticipée. La durée
// ne dépend donc ni de la position de la première différence, ni de la longueur de ce qu'envoie
// l'appelant — un `!==` sur les chaînes, lui, s'arrête au premier caractère différent.
//
// Échec FERMÉ : une clé attendue vide (variable d'environnement absente) ne valide jamais rien,
// pas même un en-tête vide.
//
// Web Crypto seulement (`crypto.subtle`) : ce module tourne tel quel sous Node (Vitest, routes
// Next) et sous Deno (Edge Functions, import relatif avec extension).

const encoder = new TextEncoder();

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

/** Lit le jeton d'un en-tête `Authorization: Bearer <jeton>` ; null si l'en-tête n'a pas cette forme. */
export function readBearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(authorization.trim());
  return match ? match[1] : null;
}

export async function bearerMatchesKey(
  authorization: string | null | undefined,
  expectedKey: string | null | undefined
): Promise<boolean> {
  const expected = expectedKey ?? "";
  // L'empreinte de la clé attendue est calculée même quand l'en-tête est absent : la durée ne dit
  // pas non plus si un en-tête a été envoyé.
  const token = readBearerToken(authorization) ?? "";
  const [received, wanted] = await Promise.all([sha256(token), sha256(expected)]);
  let difference = 0;
  for (let i = 0; i < wanted.length; i++) difference |= received[i] ^ wanted[i];
  return expected.length > 0 && token.length > 0 && difference === 0;
}
