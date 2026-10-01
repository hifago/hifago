// Le cookie d'attribution `hifago_ref` (feature 7, spec 32) — posé par `proxy.ts` depuis un
// `?ref=<code>`, relu par `api/cart/attribution/route.ts` pour `carts.attribution_code`. Une seule
// définition pour les deux : ce qui est accepté à l'écriture l'est à la lecture.

export const REF_COOKIE = "hifago_ref";

/**
 * Longueur maximale acceptée. `partner_codes.code` n'impose aucun motif (codes saisis par l'admin,
 * `SEED-REFACTIVE` en local) : la borne est donc une longueur, jamais une forme inventée. Un code
 * réel tient largement dedans ; au-delà, ce n'est pas un code — et la valeur, recopiée telle quelle
 * dans `carts`, ne doit pas pouvoir grossir jusqu'à la limite d'un cookie.
 */
export const REF_CODE_MAX_LENGTH = 64;

/** Le code nettoyé, ou `null` s'il est absent, vide ou trop long — jamais tronqué. */
export function normalizeRefCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim();
  return code.length > 0 && code.length <= REF_CODE_MAX_LENGTH ? code : null;
}

/**
 * Options du cookie. Sans `maxAge` : cookie de session, voulu (cf. `proxy.ts`). `Secure` décidé sur
 * le protocole réel de la requête, jamais sur NODE_ENV : `next start` en local sert du HTTP en mode
 * production, et un cookie `Secure` y serait refusé hors `localhost`.
 */
export function refCookieOptions(protocol: string) {
  return { path: "/", httpOnly: true, sameSite: "lax" as const, secure: protocol === "https:" };
}
