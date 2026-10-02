import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { resolveListParams } from "@hifago/domain";
import { ClientsList, type ClientRow } from "./ClientsList";
import { CLIENTS_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { CLIENTS_DEFAULT_SORT, CLIENTS_SORT_WHITELIST } from "@/lib/lists/sortable-columns";

// Revue admin clientes (Jérôme, 2026-08-19) — migré du Table brut fait main (seul écran admin
// resté en dehors du pattern DataList/ServerFilters) vers le même pattern standardisé que
// établissements/produits/commandes/partenaires. Construite sur `orders` dédupliquées (RPC
// list_clients), pas sur auth.users/partner_accounts (exclurait tout client invité). "Nom
// complet" seul, jamais prénom/nom séparés (orders.holder_name est un texte libre unique).
export default async function AdminClientsPage({
  searchParams,
}: PageProps<"/admin/clients">) {
  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: CLIENTS_SORT_WHITELIST,
      defaultSort: CLIENTS_DEFAULT_SORT,
      filters: CLIENTS_FILTER_DEFINITIONS,
    }
  );

  const supabase = await createClient();

  const { data: rpcRows } = checkedRead(
    await supabase.rpc("list_clients", {
      p_search: filters.q ?? null,
      p_status: filters.status ?? null,
      p_sort_key: sort.key,
      p_sort_desc: sort.direction === "desc",
      p_limit: pageSize,
      p_offset: from,
    }),
    "list_clients",
  );
  // Une panne LÈVE (lib/supabase/checkedRead.ts) : `error ? []` l'affichait comme une liste vide.
  const clients = rpcRows ?? [];
  const totalCount = clients[0]?.total_count ?? 0;

  // encodeURIComponent : client_key n'est pas un uuid systématique (email en minuscule ou numéro
  // de téléphone en repli, cf. client_key_for_order) — un caractère non trivial dans l'un ou
  // l'autre ne doit jamais casser le lien vers la fiche détail. Décodé une seule fois côté
  // [client_key]/page.tsx.
  const rows: ClientRow[] = clients.map((client) => ({
    id: encodeURIComponent(client.client_key),
    name: client.display_name,
    email: client.email,
    phone: client.phone,
    stage: client.client_stage,
    ordersCount: client.orders_count,
    lastOrderAt: client.last_order_at,
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Clientes</h1>
      <ClientsList
        rows={rows}
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        sort={sort}
        filterValues={filters}
        extraParams={extraParams}
      />
    </div>
  );
}
