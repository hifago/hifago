/**
 * Longueur maximale d'un code de parrainage (`partner_codes.code`) — la borne commune aux deux
 * apps (2026-10-02) : la vitrine ignore un `?ref=` plus long (apps/web/lib/attribution/refCookie.ts),
 * et l'admin refuse d'en créer un (création de partenaire, invitation). Sans cette constante
 * partagée, l'admin acceptait un code que la vitrine ignorait ensuite : l'attribution se perdait
 * en silence.
 *
 * `partner_codes.code` n'impose aucun motif (codes saisis par l'admin, `SEED-REFACTIVE` en local) :
 * la borne est une longueur, jamais une forme inventée. Le même plafond en base est l'affaire de
 * la base elle-même.
 */
export const REF_CODE_MAX_LENGTH = 64;
