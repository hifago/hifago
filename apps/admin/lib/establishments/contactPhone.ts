// Contact WhatsApp PUBLIC d'un établissement (spec 30, Tranche 2). Une seule définition pour le bloc
// admin à sauvegarde immédiate (EstablishmentContactBlock) et pour les deux formulaires de
// proposition du partenaire (migration 20261015004421).
// Pas de "use client" : lu par les pages (Server Components) comme par les formulaires.

// E.164 — le MÊME motif que la contrainte `establishments_contact_phone_e164`, que
// update_establishment_contact et que establishment_proposal_details.
// ⚠️ Plusieurs copies de la même règle, et c'est assumé : celle-ci sert à expliquer AVANT d'envoyer,
// les RPC rendent un motif lisible, la contrainte est le seul rempart qu'on ne peut pas contourner.
// Si elles divergent un jour, c'est la contrainte qui a raison.
export const E164 = /^\+[1-9][0-9]{7,14}$/;

export const CONTACT_PHONE_FORMAT_MESSAGE =
  "El número debe estar en formato internacional, por ejemplo +573001234567.";

/** Le champ VIDE est valide : c'est ainsi qu'on retire le bouton de la fiche publique. */
export function isContactPhoneInvalid(value: string): boolean {
  const saisi = value.trim();
  return saisi.length > 0 && !E164.test(saisi);
}

/** La clé n'entre dans une proposition d'ÉDITION que si le numéro a changé (cf. stayIfChanged). */
export function contactPhoneIfChanged(initial: string, current: string): { contact_phone?: string | null } {
  return initial.trim() === current.trim() ? {} : { contact_phone: current.trim() || null };
}

/** À la CRÉATION : la clé seulement si un numéro est saisi. */
export function contactPhoneIfFilled(value: string): { contact_phone?: string } {
  return value.trim() ? { contact_phone: value.trim() } : {};
}
