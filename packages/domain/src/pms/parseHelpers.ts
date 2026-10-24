// Primitives de lecture défensive partagées par les parseurs LobbyPMS (/simplify du 2026-08-26 :
// ces trois fonctions étaient identiques au caractère près dans parseLobbyRooms.ts et
// parseLobbyServices.ts). Interne au dossier pms — volontairement PAS réexporté par le barrel
// packages/domain/src/index.ts : c'est de l'outillage de parsing, pas une notion du domaine.
//
// Discipline commune à tous les parseurs de ce dossier (cf. l'en-tête de parseLobbyRooms.ts) : la
// doc officielle de LobbyPMS s'est déjà révélée fausse une fois, donc aucun champ n'est supposé
// présent, aucune exception n'est levée, et un champ absent est OMIS plutôt que fabriqué.
//
// Le parseur plus ancien du dossier (parseLobbyBookingResponse) applique le même principe avec un
// idiome inline. Il n'est volontairement PAS réécrit ici : il a ses tests, et le rétro-adapter
// n'achèterait rien aujourd'hui.

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Entier strictement positif, ou null. Accepte une chaîne numérique (Lobby en renvoie parfois). */
export function asPositiveInt(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return null;
  const rounded = Math.trunc(parsed);
  return rounded > 0 ? rounded : null;
}

export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Entier >= 0, ou null. Le pendant d'`asPositiveInt` pour les champs où **0 est une valeur
 * légitime** : `available_rooms` à 0 veut dire « complet », `min_stay` à 0 veut dire « aucune
 * contrainte ». Les confondre avec l'absence coûterait cher dans les deux sens.
 *
 * ⚠️ `Number("")` vaut 0, et `Number("  ")` aussi. Sans le filtre de contenu ci-dessous, une chaîne
 * vide — la forme la plus banale d'un champ non renseigné — se lirait « complet » sur une
 * disponibilité, ou « pas de contrainte » sur un `min_stay`. Lobby renvoie parfois ses nombres en
 * chaîne, d'où la tolérance ; elle s'arrête à une chaîne qui a du contenu.
 *
 * Tronqué, pas arrondi : Lobby compte des unités physiques, et un `2.5` hypothétique deviendrait
 * une demi-place à vendre (une unité Lobby = un cupo, `pmsUnitsToCupos`).
 */
export function asNonNegativeInt(value: unknown): number | null {
  const usable = typeof value === "number" || (typeof value === "string" && value.trim().length > 0);
  if (!usable) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
}
