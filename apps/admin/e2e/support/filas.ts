import type { Locator, Page } from "@playwright/test";

/**
 * Ligne d'une liste ÉDITABLE de /admin (catálogo, etiquetas, establecimientos, partners),
 * retrouvée par le nom affiché dans sa première cellule.
 *
 * ⚠️ POURQUOI CE HELPER EXISTE (2026-10-13). Depuis l'édition en ligne, ce nom est la VALEUR d'un
 * champ, plus un texte : `page.locator("tr", { hasText: nombre })` ne le voit plus (`hasText` lit
 * `textContent`, qui ignore la valeur des `<input>`) et ne trouve aucune ligne — sans erreur, le
 * test échoue 30 secondes plus tard sur l'action suivante.
 *
 * Chaque champ d'une ligne porte `aria-label="<colonne> — <nom>"` (`DataList`, packages/ui), où
 * `<nom>` est la valeur EN BASE de la première colonne : c'est ce nom accessible qui identifie la
 * ligne, et il ne bouge pas pendant qu'on tape dans la cellule.
 *
 * Ne sert QUE pour ces quatre listes. Une liste en lecture seule (pedidos, ledger, la table des
 * capacités d'un partenaire…) garde `locator("tr", { hasText })`.
 */
export function filaPorNombre(page: Page, nombre: string): Locator {
  return page.locator("tr").filter({ has: page.locator(`[aria-label$=${JSON.stringify(` — ${nombre}`)}]`) });
}
