// Ventilation d'une ligne pour la fiche commande admin (/admin/orders/[id]) — un affichage, jamais
// une écriture. Révisé le 2026-11-12 (migration 20261112200000) : l'état de commission se LIT
// dans le vrai ledger (admin_order_line_ledger rend la commission et la compensation de chaque
// ligne). Avant, il était DÉDUIT du statut de la ligne : jamais « Pagada », et « Redistribuido »
// pour une ligne expirée ou une annulation sans paiement, alors qu'aucune compensation n'existait.

/** Statuts réels de ledger_entries.status (check constraint, 20260818120000). */
export type LedgerEntryStatus = "estimated" | "due" | "paid" | "reversed" | "void";

export type LedgerLineInput = {
  totalCop: number;
  acompteCop: number;
  referrerCommissionCop: number;
  appCommissionCop: number;
  lineStatus: string;
  commissionEntry: { status: string; amountCop: number } | null;
  compensationEntry: { status: string; amountCop: number } | null;
};

export type LedgerLineView = {
  appDueCop: number;
  referrerDueCop: number;
  providerDueCop: number;
  /** Ce que la colonne « Estado de comisión » montre : l'entrée qui compte pour cette ligne. */
  display:
    | { kind: "compensation"; status: string }
    | { kind: "commission"; status: string }
    | { kind: "none" };
};

// Une entrée encore en vie : à venir, à payer ou payée. `void`/`reversed` ne doivent plus rien.
const LIVE = new Set(["estimated", "due", "paid"]);

// La ligne n'a pas été réalisée : rien n'est dû au référent, et seul un acompte ENCAISSÉ (que la
// compensation A3 matérialise) laisse quelque chose à partager.
const NOT_REALIZED = new Set(["cancelled_by_client", "no_show", "expired", "cancelled_by_provider", "superseded"]);

export function deriveLedgerEntry(input: LedgerLineInput): LedgerLineView {
  const { totalCop, acompteCop, referrerCommissionCop, appCommissionCop, lineStatus, commissionEntry, compensationEntry } =
    input;
  // Ce que le prestataire garde hors commission — conséquence structurelle de total/acompte.
  const providerShareCop = totalCop - acompteCop;
  const compensation = compensationEntry && LIVE.has(compensationEntry.status) ? compensationEntry : null;

  const display: LedgerLineView["display"] = compensationEntry
    ? { kind: "compensation", status: compensationEntry.status }
    : commissionEntry
      ? { kind: "commission", status: commissionEntry.status }
      : { kind: "none" };

  if (NOT_REALIZED.has(lineStatus)) {
    if (!compensation) {
      // Annulation prestataire (remboursée), expiration, annulation sans acompte payé, ligne
      // remplacée par une modification : rien n'a été encaissé pour cette ligne.
      return { appDueCop: 0, referrerDueCop: 0, providerDueCop: 0, display };
    }
    // A3 : acompte payé puis annulation client ou no-show — la part référent part à
    // l'établissement (montant réel de la compensation), en plus de sa part structurelle.
    return {
      appDueCop: appCommissionCop,
      referrerDueCop: 0,
      providerDueCop: providerShareCop + compensation.amountCop,
      display,
    };
  }

  // Réservée ou réalisée : la commission telle que le ledger la porte (montant net de l'option
  // 17 %), ou le snapshot de la ligne s'il n'y a pas d'entrée (ligne directe : 0).
  const referrerDueCop = commissionEntry
    ? LIVE.has(commissionEntry.status)
      ? commissionEntry.amountCop
      : 0
    : referrerCommissionCop;
  return { appDueCop: appCommissionCop, referrerDueCop, providerDueCop: providerShareCop, display };
}
