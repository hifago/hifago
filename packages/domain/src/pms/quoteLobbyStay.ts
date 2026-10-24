import type { NightCatalogRow } from "./alignLobbyCatalogEntries.ts";
import type { LobbyNightPrices } from "./parseLobbyNightCatalog.ts";
import { pmsUnitsToCupos } from "../products/lodgingCupos.ts";

// LE PRIX D'UN SÉJOUR LOBBY (décision du 2026-10-23, retour au cahier client §5 et à la v1) : le prix
// public d'une nuit est le prix Lobby, sans marge. Ce module est PUR — il ne lit ni réseau ni base ;
// `apps/web/lib/pms/quoteCart.ts` lui passe un catalogue lu À CHAUD, la route night-availability le
// catalogue en cache (affichage seulement).

/**
 * Le niveau d'occupation coté chez Lobby pour UNE unité vendue (sous-règle (a)) : 2 pour un produit
 * vendu `per_two`, 1 sinon (lit d'un dortoir, `per_person`, `per_house`). Jamais un autre niveau en
 * repli : une occupation non cotée rend la nuit non vendable (échec fermé).
 */
export function lobbyOccupancyForUnit(unit: string | null | undefined): number {
  return unit === "per_two" ? 2 : 1;
}

/** Le prix d'une unité pour une nuit à cette occupation, ou `null` s'il n'est pas coté. */
export function unitPriceForOccupancy(
  prices: LobbyNightPrices | null | undefined,
  occupancy: number
): number | null {
  const value = prices?.[occupancy];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export interface LobbyNightUnitPrice {
  date: string;
  unitPriceCop: number;
}

export interface LobbyStayQuote {
  /** Une entrée par nuit du séjour, dans l'ordre : le prix d'UNE unité cette nuit-là. */
  nightly: LobbyNightUnitPrice[];
  /** Le minimum, sur les nuits du séjour, des places libres chez Lobby (en cupos, facteur 1). */
  minAvailableCupos: number;
}

export type LobbyStayQuoteFailure = "night_missing" | "price_missing" | "insufficient";

export type LobbyStayQuoteResult =
  | { ok: true; quote: LobbyStayQuote }
  // Une nuit absente du catalogue, ou dont la catégorie n'est pas cotée : rien à vendre.
  | { ok: false; reason: "night_missing"; date: string | null }
  // La nuit est cotée en disponibilité mais pas en prix à cette occupation.
  | { ok: false; reason: "price_missing"; date: string }
  // Tout est coté, mais pas assez de places : le devis existe quand même (il est enregistré, et
  // `create_order` rend alors `pms_capacity_exceeded` au lieu d'un motif muet).
  | { ok: false; reason: "insufficient"; quote: LobbyStayQuote };

export interface LobbyStayQuoteInput {
  catalog: readonly NightCatalogRow[];
  categoryId: number;
  occupancy: number;
  /** Les nuits du séjour (yyyy-MM-dd), arrivée incluse, départ exclu. */
  nights: readonly string[];
  qty: number;
}

export function quoteLobbyStay(input: LobbyStayQuoteInput): LobbyStayQuoteResult {
  if (input.nights.length === 0) return { ok: false, reason: "night_missing", date: null };

  const byDate = new Map(input.catalog.map((row) => [row.date, row]));
  const nightly: LobbyNightUnitPrice[] = [];
  let minAvailableCupos = Number.POSITIVE_INFINITY;

  for (const date of input.nights) {
    const row = byDate.get(date);
    const available = row?.availableByCategory.get(input.categoryId);
    if (row === undefined || available === undefined) return { ok: false, reason: "night_missing", date };

    const unitPriceCop = unitPriceForOccupancy(row.pricesByCategory.get(input.categoryId), input.occupancy);
    if (unitPriceCop === null) return { ok: false, reason: "price_missing", date };

    nightly.push({ date, unitPriceCop });
    minAvailableCupos = Math.min(minAvailableCupos, pmsUnitsToCupos(available));
  }

  const quote = { nightly, minAvailableCupos };
  return input.qty > minAvailableCupos ? { ok: false, reason: "insufficient", quote } : { ok: true, quote };
}

/** Prix d'UNE unité pour tout le séjour : ce que `order_lines.price_cop` porte pour une nuitée. */
export function stayUnitPriceCop(nightly: readonly LobbyNightUnitPrice[]): number {
  return nightly.reduce((sum, night) => sum + night.unitPriceCop, 0);
}
