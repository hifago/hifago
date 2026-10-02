// Cahier socio (docs/02-cahier-des-charges-socio.md, décision du 2026-08-11) : une coordonnée de
// paiement enregistrée n'est JAMAIS réaffichée complète — seuls ses derniers caractères identifient
// le moyen déjà enregistré, et le numéro complet ne retraverse pas le réseau à chaque consultation.
// La page compte calcule ce suffixe côté serveur et ne transmet que lui au navigateur.
//
// Quatre caractères au plus, et jamais plus de la moitié de la valeur : sur un alias court, quatre
// caractères en livreraient l'essentiel.
const VISIBLE_SUFFIX_MAX = 4;

/** Fin visible d'un compte de paiement enregistré, ou `null` s'il n'y en a pas. */
export function payoutAccountSuffix(account: string | null | undefined): string | null {
  const value = account?.trim() ?? "";
  if (!value) return null;
  const visible = Math.min(VISIBLE_SUFFIX_MAX, Math.floor(value.length / 2));
  return visible > 0 ? value.slice(-visible) : "";
}
