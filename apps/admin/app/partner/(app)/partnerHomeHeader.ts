// En-tête de l'accueil socio (/partner) : quel bloc précède l'agenda.
//
//   - "first-establishment" : prestataire sans aucun établissement (capacité operator sans
//     `establishment_id`, pas suspendue) → un seul message « crée ton établissement »
//     (simplification demandée par Jérôme, refonte vue prestataire, 2026-08-19) ;
//   - "provider-banner" : toutes les capacités actives, dont une operator → bandeau compact
//     « Prestador activo », lien vers son établissement ;
//   - "referrer-banner" : toutes les capacités actives, toutes referrer (aucune operator) →
//     bandeau « Referente activo », liens vers son code et ses commissions (décision de Gabriel,
//     2026-10-07) — jamais « Prestador activo / Mi establecimiento » à qui n'en a pas ;
//   - "roles-card" : sinon (une capacité suspendue, ou aucun rôle) → carte « Tus roles ».
//
// ⚠️ L'ORDRE COMPTE. Depuis 20260820010000, une capacité NAÎT `active` : un prestataire qui vient
// de s'inscrire est donc « tout actif ». Testé après « tout actif », le cas « aucun
// établissement » n'était jamais atteint — le nouvel inscrit voyait « Prestador activo / Mi
// establecimiento », lien vers un établissement qui n'existe pas. Il est donc testé EN PREMIER.
// Et seulement s'il n'a encore AUCUN établissement : un prestataire qui en a un garde son bandeau,
// même avec une autre capacité operator encore vide.

export type PartnerHomeCapability = {
  role: string;
  status: string;
  establishment_id: string | null;
};

export type PartnerHomeHeader = "first-establishment" | "provider-banner" | "referrer-banner" | "roles-card";

export function partnerHomeHeader(rows: readonly PartnerHomeCapability[]): PartnerHomeHeader {
  // Première capacité operator, comme avant : seule `suspended` exclut ce cas (signal explicite
  // d'une action admin, à afficher dans la carte).
  const operator = rows.find((row) => row.role === "operator");
  const hasEstablishment = rows.some((row) => row.role === "operator" && row.establishment_id !== null);
  if (operator && operator.establishment_id === null && operator.status !== "suspended" && !hasEstablishment) {
    return "first-establishment";
  }
  if (rows.length > 0 && rows.every((row) => row.status === "active")) {
    if (operator) return "provider-banner";
    if (rows.every((row) => row.role === "referrer")) return "referrer-banner";
  }
  return "roles-card";
}
