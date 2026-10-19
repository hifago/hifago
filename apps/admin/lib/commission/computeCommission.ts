// Spécification exécutable de la table de décision 17/8/9 (cahier des charges client §3b, barème
// du 2026-10-19 qui remplace 17/10/7 — migration 20261019180000) —
// dupliquée, à l'identique, par la RPC create_order (SQL, feature 11) qui calcule réellement le
// snapshot atomiquement avec la résolution du référent. Décision de conception assumée (cf. plan
// feature 11) : pas une élimination de la duplication, une duplication choisie, comme une
// validation de formulaire côté client qui ne remplace jamais la validation serveur. Utile pour un
// futur estimateur admin/socio sans réclamer un aller-retour RPC pour une simple simulation.
export type CommissionCase = "direct" | "self_referral" | "external_referrer";

export type CommissionBreakdown = {
  case: CommissionCase;
  acomptePct: number;
  referrerPct: number;
  appPct: number;
};

export function computeCommission({
  referrerPartnerId,
  productPartnerId,
}: {
  referrerPartnerId: string | null;
  productPartnerId: string;
}): CommissionBreakdown {
  if (referrerPartnerId === null) {
    return { case: "direct", acomptePct: 0.17, referrerPct: 0, appPct: 0.17 };
  }
  if (referrerPartnerId === productPartnerId) {
    return { case: "self_referral", acomptePct: 0.09, referrerPct: 0, appPct: 0.09 };
  }
  return { case: "external_referrer", acomptePct: 0.17, referrerPct: 0.08, appPct: 0.09 };
}
