// « Pagar todo » (20261112200000) : ce que le dialogue envoie à mark_partner_ledger_entries_paid.
// La base revérifie tout sous verrou (entrées encore « A pagar », à ce bénéficiaire, même total) ;
// ici, seulement de quoi refuser d'envoyer une liste incomplète.

/** Au-delà, le dialogue renvoie à la liste filtrée : jamais une liste tronquée réglée comme entière. */
export const PAY_ALL_LIMIT = 100;

export type PayAllEntry = { id: string; amountCop: number };

export type PayAllPlan =
  | { ok: true; ids: string[]; totalCop: number }
  | { ok: false; reason: "empty" | "too_many" };

/**
 * `totalCount` : le nombre d'entrées « A pagar » en base pour ce bénéficiaire (total_count de la
 * liste) ; s'il dépasse ce qui a été chargé, payer « tout » paierait une partie seulement.
 */
export function planPayAll(entries: PayAllEntry[], totalCount: number): PayAllPlan {
  if (entries.length === 0) return { ok: false, reason: "empty" };
  if (totalCount > entries.length) return { ok: false, reason: "too_many" };
  return {
    ok: true,
    ids: entries.map((entry) => entry.id),
    totalCop: entries.reduce((sum, entry) => sum + entry.amountCop, 0),
  };
}
