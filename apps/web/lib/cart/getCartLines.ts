import { createClient } from "@hifago/supabase/server";
import { resolveLocalizedField, asLocalizedField } from "@hifago/domain";
import type { PriceTier } from "@/lib/reservas/reservationRange";
import type { Locale } from "@/messages";

// Spec 32 (panier en base) — lecture JOINTE du panier de l'appelant, réservée aux Server
// Components (`/mi-viaje`, `/pago`) : `cart_items` ne stocke que `product_id` (décision ②, jamais
// de type/nom/photo/établissement dénormalisés) — c'est cette fonction qui fait la jointure vers
// `products`/`establishments` au moment de l'affichage, jamais côté client (aucun précédent dans
// ce dépôt d'une requête `.from()` jointe depuis un composant client — cf. `lib/catalog/`, qui ne
// sert que depuis des Server Components).
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
  // Vérification minimale (products.sellable) — le mécanisme complet de revérification de
  // disponibilité à la reprise du panier reste un point ouvert (spec 32 §10), pas réinventé ici.
  unavailable: boolean;
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
};

export async function getCartLines(locale: Locale): Promise<CartLineForDisplay[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cart_items")
    .select(
      "id, product_id, date, end_date, slot_start_time, qty, created_at, products(name, type, slug, price_cop, price_tiers, sellable, establishment_id, duration_days, establishment:establishments(id, name))"
    )
    // Ordre chronologique du séjour (Jérôme, 2026-09-16) : la date de la ligne d'abord, jamais
    // l'ordre d'ajout au panier. `created_at` en départage stable pour deux lignes à la même date.
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });

  // Un panier illisible n'est jamais un panier vide : l'erreur lève, l'écran d'erreur de la zone
  // (tunnel) prend le relais — « Tu viaje está vacío » sur une panne ferait croire au client qu'il
  // a perdu ses réservations.
  if (error) throw error;
  if (!data) return [];

  return data.map((row) => {
    const product = row.products;
    const establishment = product?.establishment;
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
      unavailable: !product?.sellable,
      durationDays: product?.duration_days ?? null,
      priceTiers: (product?.price_tiers as PriceTier[] | null | undefined) ?? null,
    };
  });
}
