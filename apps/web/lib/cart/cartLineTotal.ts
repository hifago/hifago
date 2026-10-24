import { parseISO } from "date-fns";
import {
  estimateNightsTotal,
  nightsInRange,
  resolveTierPrice,
  type PriceTier,
} from "@/lib/reservas/reservationRange";
import type { CartLinePmsPrice } from "@/lib/cart/getCartLines";

// Sous-ensemble de `CartLineForDisplay` (getCartLines.ts) réellement nécessaire au calcul — même
// découplage que `LineSchedule` dans `formatLineSchedule.ts` : plus simple à tester, et
// `CartLineForDisplay` reste structurellement compatible (aucune conversion au point d'appel).
export type CartLineForPricing = {
  date: string;
  endDate: string | null;
  qty: number;
  priceCop: number;
  priceTiers: PriceTier[] | null;
  /** Prix Lobby (2026-10-23) : prime sur tout calcul local ; `pending` ne compte pas au total. */
  pmsPrice?: CartLinePmsPrice | null;
};

// Prix total affiché par ligne de panier (Jérôme, 2026-09-16). Une ligne `lodging` (endDate posé —
// seul type à plage sur ce schéma depuis la suppression de room_type_id le 2026-08-27) se totalise
// nuits × palier de quantité × qty, EXACTEMENT comme LodgingReservationForm.tsx l'estime déjà sur
// la fiche produit (mêmes fonctions de lib/reservas/reservationRange.ts, jamais une formule
// recopiée) — et, depuis la migration 20260916120000_fix_lodging_price_missing_qty, EXACTEMENT la
// formule authoritative de create_order/modify_order_line elle-même : qty désigne des unités
// facturables (lits/chambres selon lodging_kind, toujours 1 pour whole_house), jamais des
// occupants, donc multipliée comme partout ailleurs. Toute autre ligne (evento, camp, activité à
// créneau) garde price_cop × qty : déjà la formule authoritative de create_order pour ces types-là
// (price_cop y représente l'unité entière — ex. le forfait complet d'un camp — pas un tarif
// journalier), aucun changement ici.
//
// ⚠️ SIMPLIFICATION ASSUMÉE, documentée : les surcharges par nuit (stay_rates, product_calendar)
// sont ignorées ici. Le panier reste une ESTIMATION affichée (create_order recalcule seul, de façon
// authoritative, au moment du paiement) ; les récupérer pour chaque produit distinct d'un panier
// mixte est une complexité non demandée qui resterait de toute façon une estimation.
export function computeCartLineTotal(line: CartLineForPricing): number {
  // Une ligne au prix Lobby : le devis (/pago) ou l'estimation du miroir, déjà × qty — jamais le prix
  // fixe hifago, que create_order ne facturera pas. Sans estimation, 0 : le total le dit à part.
  if (line.pmsPrice) return line.pmsPrice.kind === "pending" ? 0 : line.pmsPrice.totalCop;
  if (!line.endDate) return line.priceCop * line.qty;

  const nights = nightsInRange({ from: parseISO(line.date), to: parseISO(line.endDate) });
  const tierPrice = resolveTierPrice(line.priceTiers, line.priceCop, line.qty);
  // `estimateNightsTotal` et pas `nights.length * tierPrice` : c'est la fonction par laquelle la
  // fiche produit affiche DÉJÀ cette estimation (`LodgingReservationForm`). Le jour où le panier
  // voudra les surcharges par nuit, il n'y aura qu'un lookup à brancher dans le 3ᵉ argument, au
  // lieu d'une formule à réaligner entre deux écrans.
  return estimateNightsTotal(nights, tierPrice, () => undefined) * line.qty;
}
