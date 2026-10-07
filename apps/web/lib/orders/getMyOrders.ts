import { createClient } from "@hifago/supabase/server";
import { resolveLocalizedField, asLocalizedField } from "@hifago/domain";
import type { Locale } from "@/messages";

// Spec 34 — les réservations du client connecté, pour `/cuenta/reservas`.
//
// Même place et même rôle que `getOrderByToken.ts` (spec 33) et `getCartLines.ts` (spec 32) : la
// route n'écrit jamais de requête elle-même. Ce module est ce qui fait TOMBER l'exemption de
// `scripts/check-data-layer.sh` que `cuenta/reservas/page.tsx` traînait depuis la feature 8 — la
// liste des écrans hérités passe de deux à un.
//
// ⚠️ Aucun `createServiceRoleClient` : `list_my_orders` est SECURITY DEFINER et filtre elle-même
// sur `auth.uid()`. Passer par `service_role` déplacerait l'autorisation dans l'app, hors de portée
// des tests pgTAP — et `service_role` contourne RLS entièrement, il n'est le filet de rien
// (CLAUDE.md §3.5).
//
// ⚠️ POURQUOI CE MODULE NE DÉCIDE RIEN. Le groupe (`upcoming`/`past`) et l'ordre viennent de la
// base : `list_my_orders` les calcule avec le prédicat de `list_clients` et `today_in_bogota()`,
// que le TypeScript ne peut de toute façon pas appeler (EXECUTE révoqué pour `authenticated`). Ce
// fichier ne fait donc qu'un `filter` sur un champ déjà décidé — jamais un second calcul de
// « à venir », qui divergerait au premier fuseau mal géré (spec 34 invariant 5).

/** Une prestation, telle que la carte de la liste l'affiche. */
export type MyOrderLine = {
  id: string;
  productName: string;
  establishmentName: string;
  /** Le lien vers la fiche. `null` si la prestation n'est rattachée à aucun établissement. */
  establishmentSlug: string | null;
  date: string;
  endDate: string | null;
  /** `products.duration_days` — non nul seulement pour un camp (cf. `getOrderByToken.ts`). */
  durationDays: number | null;
  slotStartTime: string | null;
  qty: number;
  /** Décision ④ : ce qui a été payé en ligne POUR CETTE prestation, figé à la commande. */
  acompteCop: number;
  /** Décision ④ : le prix total de cette prestation, figé lui aussi. */
  totalCop: number;
  /** `reserved` | `fulfilled` | `no_show` | `cancelled_by_client` | `cancelled_by_provider` | `expired` | `superseded` */
  status: string;
  /**
   * Le client peut-il l'annuler ? Décidé EN BASE (`list_my_orders`, même règle que
   * `cancel_order_line` : `order_line_client_cancellable`, 20261006192424) — jamais déduit ici du
   * statut, qui ferait vivre la règle une seconde fois.
   */
  cancellable: boolean;
  /**
   * L'acompte reste acquis si le client annule : `deposit_kept_on_cancel` de `list_my_orders`
   * (`order_deposit_collected`, la règle même de `close_order_line_locked`, 20261007003627) —
   * jamais recopié ici. Absent = faux : on ne dit jamais « no se devuelve » sans le savoir.
   */
  depositKeptOnCancel: boolean;
};

export type MyOrder = {
  id: string;
  /** Le numéro AFFICHÉ (`HFG-000042`) — jamais le jeton. */
  reference: string;
  /** Le secret d'accès à `/reserva/<jeton>`, seul chemin vers le détail (décision ③). */
  accessToken: string;
  /** `unpaid` | `pending` | `paid` | `partially_refunded` | `refunded` */
  paymentStatus: string;
  /**
   * Somme des acomptes des lignes VIVANTES, telle que `order_for_client_jsonb` la rend déjà
   * (`sum(ligne_acompte_cop) filter (where vivante)`). Porté ici parce qu'il a un lecteur —
   * `deriveOrderState` — exactement le critère posé par le commentaire ci-dessous : la resommer en
   * TypeScript ferait vivre « ligne vivante » une seconde fois, en face de `DEAD_LINE_STATUSES`.
   */
  acompteCop: number;
  lines: MyOrderLine[];
  /** Spec 39 D3 — mêmes clés que `OrderForDisplay`, même dérivation (`orderState.ts`). */
  paymentReceivedNotHonored: boolean;
  refundStatus: string | null;
};

/** Les deux groupes, dans l'ordre où l'écran les rend. Décidés en base, pas ici. */
export type MyOrders = {
  upcoming: MyOrder[];
  past: MyOrder[];
};

// ⚠️ Ces types décrivent ce que l'ÉCRAN AFFICHE, pas tout ce que la RPC sait rendre (elle renvoie
// aussi `product_type`, `product_slug`, `price_cop`, `establishment_contact_phone` par ligne, et
// `created_at`/`holder_*`/`total_cop`/`acompte_cop` sur la commande). Les porter sans lecteur
// donnerait l'illusion d'un contrat. ⚠️ En particulier, la carte n'affiche AUCUN total de
// commande : avec l'annulation par prestation (décision ⑤), un total global baisserait à chaque
// annulation alors que rien n'est remboursé — c'est précisément ce que la décision ④ a écarté en
// descendant les montants au niveau de la prestation.

// Miroir local de ce que la RPC construit, parce que `Returns: Json` est tout ce que les types
// générés savent d'une fonction qui rend du jsonb. Le contrat vit dans la migration
// 20260911100000 ; `list_my_orders.test.sql` est ce qui les empêche de diverger en silence.
type RpcLine = {
  id: string;
  product_name: unknown;
  establishment_name: unknown;
  establishment_slug: string | null;
  date: string;
  end_date: string | null;
  duration_days: number | null;
  slot_start_time: string | null;
  qty: number;
  acompte_cop: number;
  total_cop: number;
  status: string;
  cancellable?: boolean;
  deposit_kept_on_cancel?: boolean;
};

type RpcOrder = {
  id: string;
  reference: string;
  access_token: string;
  payment_status: string;
  acompte_cop: number;
  group: "upcoming" | "past";
  lines: RpcLine[];
  payment_received_not_honored?: boolean;
  refund_status?: string | null;
};

type RpcResult = { ok: boolean; reason?: string; orders?: RpcOrder[] };

/**
 * Rend `null` quand la liste n'a pas pu être lue — panne, ou refus de la RPC (session anonyme,
 * décision ⑦). L'écran affiche le même message dans les deux cas : un client n'a rien à faire de
 * la différence, et la garde de `page.tsx` l'aura de toute façon redirigé avant d'en arriver là.
 */
export async function getMyOrders(locale: Locale): Promise<MyOrders | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_orders");

  const result = data as RpcResult | null;
  if (error || !result?.ok || !result.orders) return null;

  const orders = result.orders.map((order) => ({
    id: order.id,
    reference: order.reference,
    accessToken: order.access_token,
    paymentStatus: order.payment_status,
    acompteCop: order.acompte_cop,
    group: order.group,
    paymentReceivedNotHonored: order.payment_received_not_honored === true,
    refundStatus: order.refund_status ?? null,
    lines: (order.lines ?? []).map((line) => ({
      id: line.id,
      // Les libellés sortent bruts de la base : la résolution dans la locale du visiteur se fait
      // ICI, comme dans `getOrderByToken` et `getCartLines`. La RPC ne traduit rien.
      productName: resolveLocalizedField(asLocalizedField(line.product_name), locale) ?? "",
      establishmentName:
        resolveLocalizedField(asLocalizedField(line.establishment_name), locale) ?? "",
      establishmentSlug: line.establishment_slug,
      date: line.date,
      endDate: line.end_date,
      durationDays: line.duration_days,
      slotStartTime: line.slot_start_time,
      qty: line.qty,
      acompteCop: line.acompte_cop,
      totalCop: line.total_cop,
      status: line.status,
      // Absent (base plus ancienne que la migration) = non annulable : jamais un bouton qui
      // échouerait à coup sûr.
      cancellable: line.cancellable === true,
      depositKeptOnCancel: line.deposit_kept_on_cancel === true,
    })),
  }));

  // Un `filter` sur un champ déjà décidé — l'ordre à l'intérieur de chaque groupe est celui que la
  // base a rendu, jamais retrié ici.
  return {
    upcoming: orders.filter((o) => o.group === "upcoming"),
    past: orders.filter((o) => o.group === "past"),
  };
}
