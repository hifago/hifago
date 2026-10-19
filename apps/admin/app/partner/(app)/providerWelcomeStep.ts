// Accueil du prestataire (texte validé par Jérôme, 2026-10-19) : quelle étape de la prise en main
// montrer sur /partner, à la place du bandeau « Prestador activo ».
//
//   - "establishment" : ni établissement approuvé, ni proposition en revue → « crée ton
//     établissement » (bloc 1) ;
//   - "service" : un établissement (approuvé ou en revue), mais aucun service, ni publié ni
//     proposé → « propose ton premier service » (bloc 2) ;
//   - "referrer" : un service, mais aucun compte Mercado Pago → « tu es aussi référent » (bloc 3) ;
//   - null : tout est fait → l'accueil habituel.
//
// Pas de colonne « première connexion » : chaque étape s'efface d'elle-même dès que son action est
// faite, comme l'accueil du référent seul (PartnerReferrerWelcome). Un établissement EN REVUE
// compte : sans lui, l'accueil répétait « Aún no tienes ningún establecimiento » juste après sa
// création.

export type ProviderWelcomeStep = "establishment" | "service" | "referrer";

export function providerWelcomeStep({
  hasEstablishment,
  hasPendingEstablishment,
  hasService,
  hasPayoutAccount,
}: {
  hasEstablishment: boolean;
  hasPendingEstablishment: boolean;
  hasService: boolean;
  hasPayoutAccount: boolean;
}): ProviderWelcomeStep | null {
  if (!hasEstablishment && !hasPendingEstablishment) return "establishment";
  if (!hasService) return "service";
  if (!hasPayoutAccount) return "referrer";
  return null;
}
