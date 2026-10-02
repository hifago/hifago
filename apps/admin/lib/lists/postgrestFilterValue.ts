// Une valeur saisie (recherche d'une liste) insérée dans un filtre `.or(...)` de PostgREST fait
// partie de sa grammaire : `,` sépare les conditions, `(` `)` les groupent, `.` et `:` séparent
// opérateurs et colonnes. Insérée telle quelle, une saisie contenant l'un d'eux rendait le filtre
// invalide (400) ou en changeait le sens (2026-10-02). Entre guillemets doubles, avec `"` et `\`
// échappés par `\` (règle de PostgREST), elle redevient une simple valeur.
//
// Les jokers de LIKE (`%`, `_`) ne sont pas neutralisés : ils élargissent une recherche, sans rien
// changer au filtre lui-même.
export function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
