import { asLocalizedField, resolveLocalizedField, resolveListParams } from "@hifago/domain";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { OrdersTable, type OrderLineRow } from "./OrdersTable";
import { ORDERS_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { ORDERS_DEFAULT_SORT, ORDERS_SORT_WHITELIST } from "@/lib/lists/sortable-columns";

export default async function AdminOrdersPage({
  searchParams,
}: PageProps<"/admin/orders">) {
  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: ORDERS_SORT_WHITELIST,
      defaultSort: ORDERS_DEFAULT_SORT,
      filters: ORDERS_FILTER_DEFINITIONS,
    }
  );

  const supabase = await createClient();

  // Table dense sur order_lines (pas orders) : c'est la ligne, pas la commande, qui porte la
  // date/le produit/la quantité à préparer (cahier des charges admin §2). referrer_partner_id
  // (feature 7) affiché pour la première fois ici, jusqu'ici prouvé seulement par pgTAP.
  //
  // docs/specs/10-listes-standardisees-admin-socio.md — pagination ET tri désormais tous les deux
  // côté serveur, écran pilote de la spec. `filters.product_id` : posé par le lien "voir les
  // réservations de ce jour" du calendrier produit, jamais saisi par l'admin — sans lui, un
  // date_from/date_to seuls montreraient TOUTES les réservations de ce jour, tous produits
  // confondus, pas seulement celles du produit consulté.
  // Une panne LÈVE (lib/supabase/checkedRead.ts) : lue comme une absence, elle affichait « aucune
  // réservation ».
  const { data: lines } = checkedRead(
    await supabase.rpc("admin_orders_list", {
      p_status: filters.status ?? null,
      p_date_from: filters.date_from ?? null,
      p_date_to: filters.date_to ?? null,
      p_q: filters.q ?? null,
      p_product_id: filters.product_id ?? null,
      p_sort_key: sort.column,
      p_sort_desc: sort.direction === "desc",
      p_limit: to - from + 1,
      p_offset: from,
    }),
    "admin_orders_list",
  );
  const count = !lines || lines.length === 0 ? 0 : lines[0].total_count;

  const rows: OrderLineRow[] = (lines ?? []).map((line) => ({
    id: line.id,
    orderId: line.order_id,
    date: line.date,
    endDate: line.end_date,
    qty: line.qty,
    status: line.status,
    productName: resolveLocalizedField(asLocalizedField(line.product_name), "es") ?? "—",
    establishmentName: resolveLocalizedField(asLocalizedField(line.establishment_name), "es") ?? "—",
    holderName: line.holder_name ?? "—",
    holderPhone: line.holder_phone,
    // Première fois que referrer_partner_id (feature 7) est réellement affiché — "Directo" quand
    // aucun référent n'a été résolu à la création de la commande, jamais une valeur devinée ici.
    referrerName: line.referrer_display_name ?? "Directo",
    // total_cop : le snapshot de commission (feature 11), pas un recalcul via products.price_cop —
    // celui-ci dérive silencieusement si le prix du produit est modifié après coup (cf.
    // /admin/orders/[id] qui utilise déjà ce même snapshot).
    amount: line.total_cop,
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Pedidos</h1>
      <OrdersTable
        rows={rows}
        page={page}
        pageSize={pageSize}
        totalCount={count ?? 0}
        sort={sort}
        filterValues={filters}
        extraParams={extraParams}
      />
    </div>
  );
}
