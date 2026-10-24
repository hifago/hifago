import {
  addDaysIso,
  getNightAvailabilityRange,
  LOBBY_DEFAULT_BASE_URL,
  lobbyOccupancyForUnit,
  quoteLobbyStay,
  stayUnitPriceCop,
  type LobbyStayQuote,
  type NightCatalogRow,
} from "@hifago/domain";
import { createServiceRoleClient } from "@hifago/supabase/service";

// LE DEVIS DE /pago (prix public = prix Lobby, décision du 2026-10-23, spec 24 §0 révisée). Appelé
// par `app/[locale]/(tunnel)/pago/page.tsx` à CHAQUE rendu, AVANT `getCartLines` : `create_order`
// exige, pour une ligne Lobby d'un établissement à `lobby_dynamic_pricing`, un devis de moins de
// 15 min aux mêmes produit et dates (migration 20261024110000), et `cart_lines_availability` le lit.
//
//   - Lobby lu À CHAUD, jamais le cache de night-availability ni le miroir : c'est le prix facturé.
//     Un appel par établissement et par plage (deux lignes de mêmes dates ne coûtent qu'un appel) ;
//   - le compte vient de la session vérifiée par la page (`auth.getUser()`), jamais du client ; les
//     lignes sont relues ici en service_role (le jeton Lobby n'est lisible qu'ainsi) ;
//   - ÉCHEC FERMÉ (CLAUDE.md §4.4) : Lobby injoignable, 429, délai dépassé, nuit ou prix non coté,
//     écriture du devis en panne → la ligne est rendue `pms_quote_missing`, la page la signale et
//     l'envoi est bloqué (`hasUnavailableLine`). Jamais un prix deviné, jamais l'ancien devis resservi
//     comme frais ;
//   - pas assez de places : le devis est QUAND MÊME enregistré (create_order rend alors
//     `pms_capacity_exceeded`, un motif qui dit quoi faire) et la ligne rendue telle.
// La capacité réelle reste tenue après create_order par check-nights / hold_pms_nights : ce devis ne
// refuse que tôt.

// Le rendu de /pago attend ce devis : un délai borné, plus court que celui de check-nights (15 s).
const QUOTE_CALL_TIMEOUT_MS = 8_000;

export type PmsCartQuote =
  | { ok: true; totalCop: number; unitPriceCop: number; nightly: LobbyStayQuote["nightly"] }
  | { ok: false; reason: "pms_quote_missing" | "pms_capacity_exceeded" };

type Service = ReturnType<typeof createServiceRoleClient>;

interface CartRow {
  id: string;
  product_id: string;
  date: string;
  end_date: string | null;
  qty: number;
  products: { type: string; lobby_category_id: number | null; unit: string | null; establishment_id: string } | null;
}

interface EstablishmentRow {
  id: string;
  lobby_connector_active: boolean;
  lobby_api_token: string | null;
  lobby_dynamic_pricing: boolean;
}

interface QuotableLine {
  cartItemId: string;
  productId: string;
  date: string;
  endDate: string;
  qty: number;
  categoryId: number;
  occupancy: number;
  establishment: EstablishmentRow & { lobby_api_token: string };
}

/**
 * Devis frais de chaque ligne Lobby à prix dynamique du panier de `accountId`, enregistrés en base.
 * Rend une entrée par ligne concernée (clé : `cart_items.id`) ; une ligne absente de la carte n'est
 * pas concernée (pas Lobby, interrupteur éteint, ou connecteur coupé — create_order la refuse alors
 * `pms_unavailable`, sans devis).
 */
export async function quoteCart(
  accountId: string,
  options: { timeoutMs?: number } = {}
): Promise<Map<string, PmsCartQuote>> {
  const results = new Map<string, PmsCartQuote>();
  const service = createServiceRoleClient();

  let lines: QuotableLine[];
  try {
    lines = await readQuotableLines(service, accountId);
  } catch (error) {
    // Les lignes ne sont pas lisibles : on ne sait même pas lesquelles sont concernées. Rien n'est
    // enregistré, donc create_order et cart_lines_availability les refusent `pms_quote_missing`.
    console.error(`quoteCart : lecture du panier échouée (compte ${accountId})`, error);
    return results;
  }
  if (lines.length === 0) return results;

  // Un appel par (établissement, plage) — la clé porte l'établissement : `lobby_category_id` est
  // local au compte Lobby de chacun.
  const groups = new Map<string, QuotableLine[]>();
  for (const line of lines) {
    const key = `${line.establishment.id}:${line.date}:${line.endDate}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  const toRecord: Record<string, unknown>[] = [];
  const recordedResults = new Map<string, PmsCartQuote>();
  const baseUrl = process.env.LOBBY_API_BASE_URL || LOBBY_DEFAULT_BASE_URL;
  const relaySecret = process.env.LOBBY_RELAY_SECRET;

  await Promise.all(
    [...groups.values()].map(async (group) => {
      const { establishment, date, endDate } = group[0];
      const nights = nightsOf(date, endDate);
      let catalog: NightCatalogRow[] | null = null;
      try {
        const window = await getNightAvailabilityRange(
          baseUrl,
          establishment.lobby_api_token,
          nights,
          relaySecret,
          options.timeoutMs ?? QUOTE_CALL_TIMEOUT_MS
        );
        if (window.ok) catalog = window.nights;
        else console.warn(`quoteCart : lecture Lobby échouée (établissement ${establishment.id}, ${date} → ${endDate})`, window.failure.kind);
      } catch (error) {
        console.error(`quoteCart : lecture Lobby a levé (établissement ${establishment.id})`, error);
      }

      for (const line of group) {
        if (!catalog) {
          results.set(line.cartItemId, { ok: false, reason: "pms_quote_missing" });
          continue;
        }
        const quoted = quoteLobbyStay({
          catalog,
          categoryId: line.categoryId,
          occupancy: line.occupancy,
          nights,
          qty: line.qty,
        });
        if (!quoted.ok && quoted.reason !== "insufficient") {
          results.set(line.cartItemId, { ok: false, reason: "pms_quote_missing" });
          continue;
        }
        toRecord.push({
          cart_item_id: line.cartItemId,
          product_id: line.productId,
          date: line.date,
          end_date: line.endDate,
          nightly_unit_prices: quoted.quote.nightly.map((night) => ({
            date: night.date,
            unit_price_cop: night.unitPriceCop,
          })),
          min_available_cupos: quoted.quote.minAvailableCupos,
        });
        const unitPriceCop = stayUnitPriceCop(quoted.quote.nightly);
        recordedResults.set(
          line.cartItemId,
          quoted.ok
            ? { ok: true, totalCop: unitPriceCop * line.qty, unitPriceCop, nightly: quoted.quote.nightly }
            : { ok: false, reason: "pms_capacity_exceeded" }
        );
      }
    })
  );

  if (toRecord.length > 0) {
    let recorded = false;
    try {
      const { data, error } = await service.rpc("record_pms_cart_quotes", {
        p_account_id: accountId,
        p_quotes: toRecord as never,
      });
      const outcome = data as { ok?: boolean; recorded?: number } | null;
      recorded = !error && outcome?.ok === true && outcome.recorded === toRecord.length;
      if (!recorded) console.error(`quoteCart : devis non enregistrés (compte ${accountId})`, error ?? outcome);
    } catch (error) {
      console.error(`quoteCart : enregistrement des devis a levé (compte ${accountId})`, error);
    }
    // Un devis que la base n'a pas pris n'existe pas pour create_order : la page doit le dire.
    for (const [cartItemId, result] of recordedResults) {
      results.set(cartItemId, recorded ? result : { ok: false, reason: "pms_quote_missing" });
    }
  }

  return results;
}

// Les nuits d'un séjour, arrivée incluse, départ exclu. Bornée : un panier ne dépasse jamais l'horizon
// de vente (six mois), une plage aberrante ne fait pas boucler le rendu.
function nightsOf(date: string, endDate: string): string[] {
  const nights: string[] = [];
  for (let night = date; night < endDate && nights.length < 400; night = addDaysIso(night, 1)) nights.push(night);
  return nights;
}

async function readQuotableLines(service: Service, accountId: string): Promise<QuotableLine[]> {
  const { data: cart, error } = await service
    .from("cart_items")
    .select("id, product_id, date, end_date, qty, products(type, lobby_category_id, unit, establishment_id)")
    .eq("account_id", accountId)
    .returns<CartRow[]>();
  if (error) throw error;

  const lodging = (cart ?? []).filter(
    (row) => row.products?.type === "lodging" && row.products.lobby_category_id !== null && row.end_date !== null
  );
  if (lodging.length === 0) return [];

  const establishmentIds = [...new Set(lodging.map((row) => row.products!.establishment_id))];
  const { data: establishments, error: establishmentError } = await service
    .from("establishments")
    .select("id, lobby_connector_active, lobby_api_token, lobby_dynamic_pricing")
    .in("id", establishmentIds)
    .returns<EstablishmentRow[]>();
  if (establishmentError) throw establishmentError;
  const byId = new Map((establishments ?? []).map((row) => [row.id, row]));

  const lines: QuotableLine[] = [];
  for (const row of lodging) {
    const product = row.products!;
    const establishment = byId.get(product.establishment_id);
    if (!establishment?.lobby_dynamic_pricing || !establishment.lobby_connector_active || !establishment.lobby_api_token) {
      continue;
    }
    lines.push({
      cartItemId: row.id,
      productId: row.product_id,
      date: row.date,
      endDate: row.end_date as string,
      qty: row.qty,
      categoryId: product.lobby_category_id as number,
      occupancy: lobbyOccupancyForUnit(product.unit),
      establishment: { ...establishment, lobby_api_token: establishment.lobby_api_token },
    });
  }
  return lines;
}
