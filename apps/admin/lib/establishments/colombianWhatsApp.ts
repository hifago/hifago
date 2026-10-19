// Le WhatsApp du prestataire — obligatoire à la création d'un établissement, toujours colombien
// (décision Jérôme du 2026-10-19). La règle qui fait foi est `public.colombian_whatsapp_or_null`
// (migration 20261019170000) : +57 suivi de 10 chiffres. Ce module ne sert qu'à l'ÉCRAN — afficher
// l'erreur avant l'envoi, et toujours envoyer la forme canonique. Si les deux divergent un jour,
// c'est la base qui a raison.

export const COLOMBIA_PREFIX = "+57";

/**
 * Ce que l'écran saisit (les 10 chiffres derrière le préfixe fixe « +57 ») vers la forme stockée.
 * Tolère ce qu'on colle depuis un téléphone : espaces, tirets, et un « +57 »/« 57 » déjà présent.
 * `null` si ce n'est pas un numéro colombien à 10 chiffres.
 */
export function toColombianWhatsApp(saisie: string): string | null {
  let chiffres = saisie.replace(/\D/g, "");
  if (chiffres.length === 12 && chiffres.startsWith("57")) chiffres = chiffres.slice(2);
  return /^[0-9]{10}$/.test(chiffres) ? `${COLOMBIA_PREFIX}${chiffres}` : null;
}

/** La partie saisie (sans le préfixe) d'un numéro déjà stocké — pour pré-remplir le champ. */
export function localPartOfColombianWhatsApp(stocke: string | null | undefined): string {
  if (!stocke) return "";
  return stocke.startsWith(COLOMBIA_PREFIX) ? stocke.slice(COLOMBIA_PREFIX.length) : stocke;
}

/** Message d'écran, ou `null` si la saisie est valide. Un champ vide est une erreur : il est obligatoire. */
export function colombianWhatsAppError(saisie: string): string | null {
  if (!saisie.trim()) return "El WhatsApp del prestador es obligatorio.";
  return toColombianWhatsApp(saisie) ? null : "Debe tener 10 dígitos después de +57, por ejemplo 300 123 4567.";
}

/** Motifs rendus par les RPC (`contact_phone_required`, `contact_phone_invalid`, `phone_required`, `invalid_phone`). */
export function colombianWhatsAppReasonMessage(reason: string | undefined): string | null {
  switch (reason) {
    case "contact_phone_required":
    case "phone_required":
      return "El WhatsApp del prestador es obligatorio.";
    case "contact_phone_invalid":
    case "invalid_phone":
      return "El WhatsApp debe ser un número colombiano: +57 seguido de 10 dígitos.";
    default:
      return null;
  }
}
