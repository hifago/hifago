const copFormatters = new Map<string, Intl.NumberFormat>();

// Formatage monétaire COP partagé (0 décimale) — un seul point de vérité pour l'affichage des
// montants ; le formatter est mémoïsé par locale pour ne pas le reconstruire à chaque rendu de ligne
// de tableau.
//
// `useGrouping: "always"` (arbitrage de Gabriel, au nom de Jérôme) : toujours le séparateur de
// milliers, « 3.400 COP » comme « 45.000 COP ». Par défaut, la règle CLDR de `es` ne groupe qu'à
// partir de 10 000 (« 3400 COP ») ; `en` groupe déjà (« COP 3,400 »), inchangé.
export function formatCop(value: number, locale: string = "es"): string {
  let formatter = copFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
      useGrouping: "always",
    });
    copFormatters.set(locale, formatter);
  }
  return formatter.format(value);
}
