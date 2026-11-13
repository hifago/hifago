// Ce qu'une entrée du ledger paie, en une ligne lisible (20261112190000). Sans elle, une commission
// d'auto-recomendación, une commission de recommandation et une compensation d'annulation se
// ressemblaient trait pour trait sur /admin/ledger (même établissement, même montant, « Referente »
// vide pour la compensation). Le pourcentage est celui FIGÉ sur la ligne (cahier client §3b,
// snapshot) : une ligne de l'ancien barème garde son 10 %.
export type LedgerConceptInput = {
  entryType: string;
  commissionCase: string;
  referrerPct: number;
};

// Espace insécable avant « % » : sous md, « … · 8 » et « % » se séparaient à la ligne.
export function formatPct(pct: number): string {
  return `${Math.round(pct * 1000) / 10} %`;
}

export function ledgerConceptLabel({ entryType, commissionCase, referrerPct }: LedgerConceptInput): string {
  if (entryType === "establishment_compensation") {
    // A3 : le client a annulé (ou ne s'est pas présenté) après avoir payé l'acompte — la part
    // référent revient à l'établissement qui a bloqué la place.
    return `Compensación por anulación · ${formatPct(referrerPct)}`;
  }
  if (commissionCase === "self_referral") {
    return `Auto-recomendación · ${formatPct(referrerPct)}`;
  }
  if (commissionCase === "external_referrer") {
    return `Recomendación · ${formatPct(referrerPct)}`;
  }
  return "Comisión";
}

