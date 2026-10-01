// Ce que le formulaire d'hébergement fait d'un échec de `/api/pms/night-availability`.
//
// AVANT (spec 30 §7a) : la décision vivait en DEUX morceaux, dans deux endroits différents de
// `LodgingReservationForm` — un booléen dans le corps du composant
// (`reason !== "connector_inactive"`) et un ternaire dans le JSX (`reason === "pms_rate_limited"`).
// Conséquence mesurée : la Route Handler émet DIX motifs, le formulaire n'en connaissait que DEUX
// par leur nom, et les neuf autres héritaient de « réessayer » par défaut.
//
// ⚠️ LE DÉFAUT EST « NON RETENTABLE », ET C'EST DÉLIBÉRÉ. Un motif ajouté côté route sans être
// ajouté ici est un oubli : s'il héritait de « retentable », l'oubli serait invisible — le bouton
// s'afficherait, personne ne remarquerait rien, et le visiteur cliquerait sur une action qui ne
// peut pas aboutir. En retombant sur « non retentable », l'oubli se voit. Et le test de ce fichier
// relit la Route Handler pour qu'il se voie AVANT la mise en production.
//
// Ce module ne traduit rien : il rend une clé, la page appelle `t()` (même frontière que
// `lib/catalog/`, spec 28 §0).

export type MotivoPms = {
  /** Proposer le bouton « réessayer » ? Uniquement quand rejouer la requête peut réussir. */
  reintentable: boolean;
  /** Clé next-intl du namespace `ProductPage`. */
  claveI18n: "pmsAvailabilityError" | "pmsAvailabilityRateLimited" | "pmsAvailabilityConnectorOff";
};

/**
 * Les dix motifs que `/api/pms/night-availability` peut rendre, chacun avec ce qu'on en fait.
 *
 * RETENTABLES — rejouer la requête telle quelle peut réussir :
 *   `pms_rate_limited`  le quota se libère en attendant (c'est son seul remède) ;
 *   `pms_unreachable`   panne réseau MESURÉE transitoire — novembre est revenu 0, puis 29/30,
 *                       puis 30/30 (2026-08-28) : ce qui manquait n'était pas un meilleur
 *                       message, c'était de REDEMANDER ;
 *   `pms_rejected`      Lobby a répondu une erreur — elle peut être passagère (503) ;
 *   `pms_unparseable`   réponse illisible, même raisonnement.
 *
 * NON RETENTABLES — rejouer donnera exactement le même résultat :
 *   `connector_inactive`      le connecteur est coupé CÔTÉ ADMIN : rien ne changera tant qu'un
 *                             humain n'aura rien fait ;
 *   `pms_category_not_quoted` la catégorie n'est pas cotée chez Lobby (dette du backlog,
 *                             refermée ici) ;
 *   `month_out_of_range`      hors horizon de vente : réessayer n'y changera rien, et la
 *                             navigation est déjà bornée par `startMonth`/`endMonth` — ce motif
 *                             ne devrait donc jamais atteindre l'écran. Il était pourtant
 *                             retentable, et personne ne l'avait réclamé ;
 *   `invalid_params`          requête mal formée : un bug du client, pas une panne ;
 *   `product_not_found`       le produit n'existe pas ou n'est plus publié ;
 *   `not_pms_backed`          le produit n'est pas adossé à un PMS — le formulaire n'aurait pas dû
 *                             appeler.
 */
export const MOTIVOS_PMS: Record<string, MotivoPms> = {
  pms_rate_limited: { reintentable: true, claveI18n: "pmsAvailabilityRateLimited" },
  pms_unreachable: { reintentable: true, claveI18n: "pmsAvailabilityError" },
  pms_rejected: { reintentable: true, claveI18n: "pmsAvailabilityError" },
  pms_unparseable: { reintentable: true, claveI18n: "pmsAvailabilityError" },
  // Texte propre : rien ne changera sans qu'un admin rallume le connecteur — inviter à réessayer
  // serait faux (le message générique le fait).
  connector_inactive: { reintentable: false, claveI18n: "pmsAvailabilityConnectorOff" },
  pms_category_not_quoted: { reintentable: false, claveI18n: "pmsAvailabilityError" },
  month_out_of_range: { reintentable: false, claveI18n: "pmsAvailabilityError" },
  invalid_params: { reintentable: false, claveI18n: "pmsAvailabilityError" },
  product_not_found: { reintentable: false, claveI18n: "pmsAvailabilityError" },
  not_pms_backed: { reintentable: false, claveI18n: "pmsAvailabilityError" },
};

/** Le repli, appliqué à tout motif que la table ne connaît pas. Voir l'en-tête. */
export const MOTIVO_PMS_DESCONOCIDO: MotivoPms = {
  reintentable: false,
  claveI18n: "pmsAvailabilityError",
};

export function motivoPms(reason: string | undefined): MotivoPms {
  if (reason === undefined) return MOTIVO_PMS_DESCONOCIDO;
  return MOTIVOS_PMS[reason] ?? MOTIVO_PMS_DESCONOCIDO;
}
