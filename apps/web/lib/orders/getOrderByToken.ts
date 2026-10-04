import { createClient } from "@hifago/supabase/server";
import { resolveLocalizedField, asLocalizedField } from "@hifago/domain";
import { urlDeContacto } from "@/lib/catalog/establecimiento";
import type { Locale } from "@/messages";

// Spec 33 — lecture d'une commande par son jeton d'URL, réservée aux Server Components
// (`/reserva/[token]`). Même place et même rôle que `lib/cart/getCartLines.ts` (spec 32) : la
// route n'écrit jamais de requête elle-même (`scripts/check-data-layer.sh`), et la résolution des
// libellés multilingues se fait ICI, jamais dans la RPC — qui les rend bruts, exactement comme
// `lib/catalog/` ne compose aucun libellé.
//
// ⚠️ Aucun `createServiceRoleClient` : la RPC `get_order_by_token` est SECURITY DEFINER et son
// garde est le jeton. Passer par `service_role` déplacerait l'autorisation dans l'app, hors de
// portée des tests pgTAP — et `service_role` contourne RLS entièrement, il n'est le filet de rien
// (CLAUDE.md §3.5).

// ⚠️ Ces deux types décrivent ce que l'ÉCRAN AFFICHE, pas tout ce que la RPC sait rendre (elle
// renvoie aussi `product_type`, `product_slug`, `price_cop` par ligne, et `created_at` sur la
// commande). Les porter jusqu'ici sans lecteur donnerait l'illusion d'un contrat : quand un
// écran en aura besoin, il ajoutera le champ — c'est une ligne, et la RPC est déjà testée.
//
// ⚠️ `orders.status` N'EST PLUS RENDU par la RPC depuis la spec 34 (migration 20260911100000) :
// la colonne vaut 'confirmed' sur toute ligne et rien ne l'écrit jamais. Le retrait du miroir
// ci-dessous n'est donc pas un rétrécissement de confort — c'est la correction d'un type qui
// aurait menti sur ce que la base envoie.

/** Une ligne de commande, telle que l'écran de résultat l'affiche. */
export type OrderLineForDisplay = {
  id: string;
  productName: string;
  establishmentName: string;
  date: string;
  endDate: string | null;
  /** `products.duration_days` — non nul seulement pour un camp (`endDate` reste null pour lui ;
   * l'écran reconstitue sa date de fin via `ultimoDiaCampIso`, `formatLineSchedule`). */
  durationDays: number | null;
  slotStartTime: string | null;
  qty: number;
  totalCop: number;
  acompteCop: number;
  /** `reserved` | `fulfilled` | `no_show` | `cancelled_by_client` | `cancelled_by_provider` | `expired` | `superseded` */
  status: string;
  /** Spec 34 décision ③ — le lien vers la fiche. `null` si la prestation n'a pas d'établissement. */
  establishmentSlug: string | null;
  /**
   * Spec 34 décision ⑥ — l'URL `wa.me` de l'établissement, SANS le message : celui-ci est
   * localisé, donc ajouté par le composant, qui seul dispose du traducteur. `null` quand
   * `contact_phone` est vide — et alors aucun bouton n'est rendu, jamais un bouton mort.
   *
   * ⚠️ Construite ICI et pas dans `OrderResult.tsx`, qui est `"use client"` : y importer
   * `urlDeContacto` embarquerait tout `lib/catalog/` — et `createPublicClient` — dans le bundle
   * navigateur. C'est l'angle mort nommé en tête de `scripts/check-data-layer.sh`, déjà réalisé
   * une fois par `FichaEstablecimiento.tsx` : ne pas en faire une seconde occurrence.
   */
  establishmentContactUrl: string | null;
};

export type OrderForDisplay = {
  id: string;
  /** Le numéro AFFICHÉ (`HFG-000042`) — jamais le jeton (spec 33 invariant 1). */
  reference: string;
  /** `unpaid` | `pending` | `paid` | `partially_refunded` | `refunded` */
  paymentStatus: string;
  holderName: string;
  holderPhone: string | null;
  holderEmail: string;
  /** Totaux des lignes VIVANTES seulement — une ligne annulée reste listée sans les gonfler. */
  totalCop: number;
  acompteCop: number;
  lines: OrderLineForDisplay[];
  /** Spec 39 D3 — cf. `OrderStateInput`. */
  paymentReceivedNotHonored: boolean;
  refundStatus: string | null;
};

// Miroir local de ce que la RPC construit (`jsonb_build_object`), parce que `Returns: Json` est
// tout ce que les types générés savent d'une fonction qui rend du jsonb. Le contrat vit dans la
// migration 20260910170100 ; ce type le recopie, et `get_order_by_token.test.sql` est ce qui les
// empêche de diverger en silence.
type RpcLine = {
  id: string;
  product_name: unknown;
  product_type: string | null;
  product_slug: string | null;
  establishment_name: unknown;
  establishment_slug: string | null;
  establishment_contact_phone: string | null;
  date: string;
  end_date: string | null;
  duration_days: number | null;
  slot_start_time: string | null;
  qty: number;
  price_cop: number;
  total_cop: number;
  acompte_cop: number;
  status: string;
};

type RpcResult = {
  ok: boolean;
  reason?: string;
  order?: {
    id: string;
    reference: string;
    payment_status: string;
    created_at: string;
    holder_name: string;
    holder_phone: string | null;
    holder_email: string;
    total_cop: number;
    acompte_cop: number;
    lines: RpcLine[];
    payment_received_not_honored?: boolean;
    refund_status?: string | null;
  };
};

/**
 * Rend `null` pour un jeton inconnu, malformé ou absent — la RPC ne distingue jamais les trois
 * (elle répond `{ ok: false }`, sans erreur), et l'appelant n'a qu'un seul geste à faire :
 * `notFound()`. Une ERREUR de lecture, elle, lève : l'écran est relu en boucle au retour de
 * Mercado Pago, et une panne passagère ne doit jamais y devenir « cette page n'existe pas ».
 */
export async function getOrderByToken(
  token: string,
  locale: Locale
): Promise<OrderForDisplay | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_order_by_token", { p_token: token });

  if (error) throw error;
  const result = data as RpcResult | null;
  if (!result?.ok || !result.order) return null;

  const order = result.order;
  return {
    id: order.id,
    reference: order.reference,
    paymentStatus: order.payment_status,
    holderName: order.holder_name,
    holderPhone: order.holder_phone,
    holderEmail: order.holder_email,
    totalCop: order.total_cop,
    acompteCop: order.acompte_cop,
    paymentReceivedNotHonored: order.payment_received_not_honored === true,
    refundStatus: order.refund_status ?? null,
    lines: (order.lines ?? []).map((line) => ({
      id: line.id,
      productName: resolveLocalizedField(asLocalizedField(line.product_name), locale) ?? "",
      establishmentName:
        resolveLocalizedField(asLocalizedField(line.establishment_name), locale) ?? "",
      date: line.date,
      endDate: line.end_date,
      durationDays: line.duration_days,
      slotStartTime: line.slot_start_time,
      qty: line.qty,
      totalCop: line.total_cop,
      acompteCop: line.acompte_cop,
      status: line.status,
      establishmentSlug: line.establishment_slug,
      establishmentContactUrl: line.establishment_contact_phone
        ? urlDeContacto(line.establishment_contact_phone)
        : null,
    })),
  };
}
