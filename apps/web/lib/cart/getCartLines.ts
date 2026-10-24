import { createClient } from "@hifago/supabase/server";
import {
  addDaysIso,
  asLocalizedField,
  lobbyOccupancyForUnit,
  resolveLocalizedField,
  unitPriceForOccupancy,
  type LobbyNightPrices,
} from "@hifago/domain";
import type { PriceTier } from "@/lib/reservas/reservationRange";
import { precioLobbyPorUnidad } from "@/lib/reservas/precioLobby";
import type { PmsCartQuote } from "@/lib/pms/quoteCart";
import type { Locale } from "@/messages";

// Spec 32 (panier en base) — lecture JOINTE du panier de l'appelant, réservée aux Server
// Components (`/mi-viaje`, `/pago`) : `cart_items` ne stocke que `product_id` (décision ②, jamais
// de type/nom/photo/établissement dénormalisés) — c'est cette fonction qui fait la jointure vers
// `products`/`establishments` au moment de l'affichage, jamais côté client (aucun précédent dans
// ce dépôt d'une requête `.from()` jointe depuis un composant client — cf. `lib/catalog/`, qui ne
// sert que depuis des Server Components).
//
// Disponibilité de chaque ligne (spec 32 §10) : `cart_lines_availability` (migration
// 20261014211217) rend, ligne par ligne, ce que create_order en dirait — chaque ligne jugée avec
// les sommes du panier entier, d'où la relecture après chaque retrait. Un confort d'affichage,
// jamais la décision : create_order reste seul juge à l'envoi (CLAUDE.md §4.5).
//   - `available` / `unavailable` (+ la raison, liste fermée de `lineReasons.ts`) : le verdict ;
//   - `unknown` : lecture en panne, ou ligne arrivée entre les deux lectures. Jamais « disponible » :
//     l'écran dit qu'il n'a pas pu vérifier, et create_order tranchera.
export type CartLineAvailability =
  | { status: "available" }
  | { status: "unavailable"; reason: string | null }
  | { status: "unknown" };

/**
 * Le prix d'une ligne Lobby à prix dynamique (`lobby_dynamic_pricing`, 2026-10-23) — `null` pour
 * toute autre ligne, qui garde le calcul de `computeCartLineTotal` :
 *   - `quoted` : le devis lu à chaud sur /pago, celui que create_order facturera ; `estimateCop`, ce
 *     que le miroir laissait attendre, sert à dire que le prix a changé ;
 *   - `estimated` : la somme des prix Lobby du miroir (/mi-viaje, ou /pago quand le devis a échoué) ;
 *   - `pending` : rien d'estimable, « precio confirmado en el pago ».
 */
export type CartLinePmsPrice =
  | { kind: "quoted"; totalCop: number; estimateCop: number | null }
  | { kind: "estimated"; totalCop: number }
  | { kind: "pending" };

export type CartLineForDisplay = {
  id: string;
  productId: string;
  productName: string;
  productType: string;
  productSlug: string;
  establishmentId: string;
  establishmentName: string;
  date: string;
  endDate: string | null;
  slotStartTime: string | null;
  qty: number;
  priceCop: number;
  availability: CartLineAvailability;
  /**
   * `products.duration_days` — non nul seulement pour `camp`. Ajouté le 2026-09-15 pour
   * `findCampMissingLodging` (`lib/cart/campMissingLodging.ts`) : le seul champ qui manquait ici
   * pour reproduire côté front, sans requête supplémentaire, la même formule que `create_order`
   * (nuits requises = duration_days - 1).
   */
  durationDays: number | null;
  /**
   * `products.price_tiers` — jsonb déjà normalisé côté Postgres. Sert uniquement à
   * `computeCartLineTotal` (`lib/cart/cartLineTotal.ts`) pour reproduire, côté panier, le même
   * palier de quantité que `LodgingReservationForm.tsx` affiche déjà sur la fiche produit.
   */
  priceTiers: PriceTier[] | null;
  /** Cf. `CartLinePmsPrice` : non nul seulement pour une ligne Lobby à prix dynamique. */
  pmsPrice: CartLinePmsPrice | null;
};

// Les raisons qui ne disent QUE « pas encore de devis » : sur /mi-viaje, aucun devis n'est pris (il
// l'est au rendu de /pago), elles n'y signalent donc aucune indisponibilité.
const PMS_QUOTE_REASONS = new Set(["pms_quote_missing", "pms_quote_expired"]);

/**
 * `pmsQuotes` : les devis que `quoteCart` vient de prendre (/pago seulement, AVANT cet appel). Absent
 * (/mi-viaje) : une ligne Lobby à prix dynamique sans devis reste « disponible », au prix estimé.
 */
export async function getCartLines(
  locale: Locale,
  options: { pmsQuotes?: Map<string, PmsCartQuote> } = {}
): Promise<CartLineForDisplay[]> {
  const supabase = await createClient();
  const [{ data, error }, verdicts] = await Promise.all([
    supabase
      .from("cart_items")
      .select(
        "id, product_id, date, end_date, slot_start_time, qty, created_at, products(name, type, slug, price_cop, price_tiers, establishment_id, duration_days, lobby_category_id, unit, establishment:establishments(id, name, lobby_dynamic_pricing))"
      )
      // Ordre chronologique du séjour (Jérôme, 2026-09-16) : la date de la ligne d'abord, jamais
      // l'ordre d'ajout au panier. `created_at` en départage stable pour deux lignes à la même date.
      .order("date", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase.rpc("cart_lines_availability"),
  ]);

  // Un panier illisible n'est jamais un panier vide : l'erreur lève, l'écran d'erreur de la zone
  // (tunnel) prend le relais — « Tu viaje está vacío » sur une panne ferait croire au client qu'il
  // a perdu ses réservations.
  if (error) throw error;
  if (!data) return [];

  // Panne de la disponibilité : toutes les lignes « inconnues », jamais « disponibles » — et pas une
  // levée : le panier est lisible, seul le confort manque.
  const verdictParLigne = new Map<string, Verdict>(
    verdicts.error ? [] : (verdicts.data ?? []).map((verdict) => [verdict.id, verdict])
  );

  // Prix Lobby (2026-10-23) : l'estimation de chaque ligne à prix dynamique, depuis le miroir — une
  // requête pour tout le panier, seulement s'il porte une telle ligne.
  const estimates = await estimateFromMirror(
    supabase,
    data.flatMap((row) =>
      isLobbyPriced(row.products, row.end_date)
        ? [
            {
              id: row.id,
              establishmentId: row.products!.establishment!.id,
              categoryId: row.products!.lobby_category_id as number,
              occupancy: lobbyOccupancyForUnit(row.products!.unit),
              date: row.date,
              endDate: row.end_date as string,
              qty: row.qty,
            },
          ]
        : []
    )
  );

  return data.map((row) => {
    const product = row.products;
    const establishment = product?.establishment;
    let availability: CartLineAvailability = product
      ? toAvailability(verdictParLigne.get(row.id))
      : { status: "unavailable", reason: "not_sellable" };
    let pmsPrice: CartLinePmsPrice | null = null;
    if (product && isLobbyPriced(product, row.end_date)) {
      const estimateCop = estimates.get(row.id) ?? null;
      const fallback: CartLinePmsPrice =
        estimateCop !== null ? { kind: "estimated", totalCop: estimateCop } : { kind: "pending" };
      const quote = options.pmsQuotes?.get(row.id);
      if (options.pmsQuotes) {
        // /pago : le devis frais fait foi. Échoué, il ferme l'envoi — sauf si la base signale déjà
        // une autre raison, plus précise, qu'on garde.
        pmsPrice = quote?.ok ? { kind: "quoted", totalCop: quote.totalCop, estimateCop } : fallback;
        if (quote && !quote.ok) {
          const verdictPrecis =
            availability.status === "unavailable" && !PMS_QUOTE_REASONS.has(availability.reason ?? "");
          if (!verdictPrecis) availability = { status: "unavailable", reason: quote.reason };
        }
      } else {
        pmsPrice = fallback;
        if (availability.status === "unavailable" && PMS_QUOTE_REASONS.has(availability.reason ?? "")) {
          availability = { status: "available" };
        }
      }
    }
    return {
      id: row.id,
      productId: row.product_id,
      productName: resolveLocalizedField(asLocalizedField(product?.name), locale) ?? "",
      productType: product?.type ?? "",
      productSlug: product?.slug ?? "",
      establishmentId: establishment?.id ?? "",
      establishmentName: resolveLocalizedField(asLocalizedField(establishment?.name), locale) ?? "",
      date: row.date,
      endDate: row.end_date,
      slotStartTime: row.slot_start_time,
      qty: row.qty,
      priceCop: product?.price_cop ?? 0,
      // Produit masqué par la RLS (`products_select_public` : sellable seulement) : il n'est plus en
      // vente, quoi que dise — ou taise, en panne — la disponibilité.
      availability,
      durationDays: product?.duration_days ?? null,
      priceTiers: (product?.price_tiers as PriceTier[] | null | undefined) ?? null,
      pmsPrice,
    };
  });
}

type ProductForPricing = {
  type: string;
  lobby_category_id: number | null;
  establishment: { id: string; lobby_dynamic_pricing: boolean } | null;
} | null;

// Une nuitée Lobby d'un établissement vendant au prix Lobby : même prédicat que create_order.
function isLobbyPriced(product: ProductForPricing, endDate: string | null): boolean {
  return Boolean(
    product &&
      product.type === "lodging" &&
      product.lobby_category_id !== null &&
      product.establishment?.lobby_dynamic_pricing &&
      endDate
  );
}

type LineToEstimate = {
  id: string;
  establishmentId: string;
  categoryId: number;
  occupancy: number;
  date: string;
  endDate: string;
  qty: number;
};

// Σ des prix Lobby du miroir × qty, par ligne ; une ligne dont une nuit n'est pas cotée est absente de
// la carte (« precio confirmado en el pago »). Une panne du miroir n'est pas une erreur du panier :
// les lignes restent simplement sans estimation.
async function estimateFromMirror(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lines: LineToEstimate[]
): Promise<Map<string, number>> {
  const estimates = new Map<string, number>();
  if (lines.length === 0) return estimates;

  const from = lines.reduce((min, line) => (line.date < min ? line.date : min), lines[0].date);
  const to = lines.reduce((max, line) => (line.endDate > max ? line.endDate : max), lines[0].endDate);
  const { data, error } = await supabase
    .from("pms_availability_mirror")
    .select("establishment_id, lobby_category_id, date, prices")
    .in("establishment_id", [...new Set(lines.map((line) => line.establishmentId))])
    .in("lobby_category_id", [...new Set(lines.map((line) => line.categoryId))])
    .gte("date", from)
    .lt("date", to);
  if (error || !data) return estimates;

  const prices = new Map(
    data.map((row) => [`${row.establishment_id}:${row.lobby_category_id}:${row.date}`, row.prices as LobbyNightPrices | null])
  );
  for (const line of lines) {
    const nights: string[] = [];
    for (let night = line.date; night < line.endDate && nights.length < 400; night = addDaysIso(night, 1)) nights.push(night);
    const unit = precioLobbyPorUnidad(nights, (night) =>
      unitPriceForOccupancy(prices.get(`${line.establishmentId}:${line.categoryId}:${night}`), line.occupancy)
    );
    if (unit !== null) estimates.set(line.id, unit * line.qty);
  }
  return estimates;
}

// Ce qui ferme l'envoi sur /pago : une ligne SIGNALÉE. Une disponibilité illisible (`unknown`) ne
// le ferme pas — create_order tranchera, et une panne de confort ne bloque pas une réservation.
export function hasUnavailableLine(lines: CartLineForDisplay[]): boolean {
  return lines.some((line) => line.availability.status === "unavailable");
}

// `reason` est nulle exactement quand la ligne est disponible (le type généré dit `string`).
type Verdict = { available: boolean; reason: string | null };

function toAvailability(verdict: Verdict | undefined): CartLineAvailability {
  if (!verdict) return { status: "unknown" };
  return verdict.available ? { status: "available" } : { status: "unavailable", reason: verdict.reason };
}
