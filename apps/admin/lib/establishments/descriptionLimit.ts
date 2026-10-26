// Plafond de la description d'un établissement, par langue (demande de Jérôme, 2026-10-24).
// Une seule source pour les 4 écrans qui la saisissent : création et édition admin, proposition de
// création et proposition de modification côté partenaire.
//
// Pas de `maxLength` sur le champ : il couperait un texte collé sans le dire (même choix que
// REF_CODE_MAX_LENGTH). On affiche un compteur et on bloque l'envoi avec un message.
export const ESTABLISHMENT_DESCRIPTION_MAX = 600;

// Compte en caractères réels (points de code), comme `char_length` de Postgres : un emoji compte
// pour 1, pas pour 2 comme avec `String.length`. Texte nettoyé, comme il sera enregistré.
export function descriptionLength(text: string): number {
  return [...text.trim()].length;
}

export function establishmentDescriptionError(es: string, en: string): string | null {
  for (const [lang, text] of [["ES", es], ["EN", en]] as const) {
    if (descriptionLength(text) > ESTABLISHMENT_DESCRIPTION_MAX) {
      return `La descripción (${lang}) no puede tener más de ${ESTABLISHMENT_DESCRIPTION_MAX} caracteres.`;
    }
  }
  return null;
}
