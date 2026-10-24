/**
 * Le prix d'UNE unité pour tout le séjour, au prix Lobby (2026-10-23) : la somme des prix des nuits
 * telles que la fiche les connaît (miroir, ou `/api/pms/night-availability`). Une nuit sans prix
 * coté rend `null` — le séjour n'est alors pas estimable, et le formulaire désactive l'ajout plutôt
 * que d'afficher un total partiel. Une ESTIMATION : le prix facturé vient du devis lu à chaud sur
 * /pago (`lib/pms/quoteCart.ts`).
 */
export function precioLobbyPorUnidad(
  noches: readonly string[],
  precioDe: (noche: string) => number | null | undefined
): number | null {
  if (noches.length === 0) return null;
  let total = 0;
  for (const noche of noches) {
    const precio = precioDe(noche);
    if (typeof precio !== "number" || !Number.isFinite(precio) || precio <= 0) return null;
    total += precio;
  }
  return total;
}
