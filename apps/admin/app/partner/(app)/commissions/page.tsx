import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField, resolveListParams } from "@hifago/domain";
import { COMMISSIONS_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { COMMISSIONS_DEFAULT_SORT, COMMISSIONS_SORT_WHITELIST } from "@/lib/lists/sortable-columns";
import { CommissionsTable, type CommissionRow, type CommissionTotals } from "./CommissionsTable";

// Spec 19 §0 Tranche 0 — lit désormais le vrai ledger_entries (RLS ledger_entries_select_referrer,
// 20260818120000) au lieu de dériver un état depuis order_lines.status (deriveLedgerEntry,
// pis-aller documenté comme tel avant que le ledger existe : « aucune colonne payée, le mécanisme
// de paiement n'existe pas dans ce backlog »). C'est le SEUL écran capable de montrer "Pagada" —
// un statut que la dérivation ne pouvait structurellement jamais produire.
// Refonte vue référent (2026-08-20, docs/specs/22-vue-referent-restreinte.md) : nom d'établissement
// (holder_name/referrer_pct déjà des colonnes de order_lines, establishment via la même
// double-jointure product→establishment que reservations/page.tsx) — rien de nouveau côté schéma,
// seulement des colonnes déjà présentes jamais sélectionnées jusqu'ici.
//
// Filtres date/état + pagination/tri serveur (retour Jérôme, 2026-08-20), migré vers DataList
// (spec 10) — même patron que admin/orders/page.tsx/reservations/page.tsx, y compris la fiche
// détail `[id]/page.tsx` (le lien de ligne par défaut de DataList a besoin d'une vraie page à
// pointer).
//
// Lectures par RPC (partner_commissions_list, partner_commission_totals — 20260930211348),
// jamais par un embed `order_lines` : depuis le revoke du 2026-09-22, une session n'a plus le
// droit de lire `order_lines`, et l'embed d'avant rendait une erreur avalée en liste vide et
// totaux à 0 (scripts/check-order-lines-access.sh l'interdit désormais). Le périmètre (le
// partenaire du compte connecté, entrées `referrer` seulement) est calculé DANS les RPC depuis
// `auth.uid()` : la page ne le passe plus, elle ne peut donc plus le fausser.
export default async function PartnerCommissionsPage({
  searchParams,
}: PageProps<"/partner/commissions">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/partner/commissions");
  }

  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: COMMISSIONS_SORT_WHITELIST,
      defaultSort: COMMISSIONS_DEFAULT_SORT,
      filters: COMMISSIONS_FILTER_DEFINITIONS,
    }
  );

  // Totaux agrégés sur TOUTES les entrées correspondant aux filtres actifs, pas seulement la page
  // affichée (DataList pagine réellement côté serveur) — une ligne par statut, sommée en SQL :
  // l'ancienne requête rendait une ligne par entrée, tronquée par `max_rows` au-delà de 1000.
  // Mêmes filtres que la liste, indépendante d'elle, donc parallélisée.
  const [listResult, totalsResult] = await Promise.all([
    supabase.rpc("partner_commissions_list", {
      p_date_from: filters.date_from ?? null,
      p_date_to: filters.date_to ?? null,
      p_status: filters.status ?? null,
      p_sort_key: sort.column,
      p_sort_desc: sort.direction === "desc",
      p_limit: to - from + 1,
      p_offset: from,
    }),
    supabase.rpc("partner_commission_totals", {
      p_date_from: filters.date_from ?? null,
      p_date_to: filters.date_to ?? null,
      p_status: filters.status ?? null,
    }),
  ]);
  if (listResult.error) {
    throw new Error(`Lecture des commissions impossible (partner_commissions_list) : ${listResult.error.message}`);
  }
  if (totalsResult.error) {
    throw new Error(`Lecture des totaux impossible (partner_commission_totals) : ${totalsResult.error.message}`);
  }
  const entries = listResult.data;
  const count = entries.length === 0 ? 0 : entries[0].total_count;

  // amount_cop = referrer_commission_cop snapshoté à la création (create_order), jamais recalculé
  // par les transitions ultérieures (seul status change) — la table montre donc toujours le
  // montant d'origine, y compris sur une ligne void/reversed (« ce qui aurait été dû »), pas 0.
  const rows: CommissionRow[] = entries.map((entry) => ({
    id: entry.id,
    date: entry.date,
    productName: resolveLocalizedField(asLocalizedField(entry.product_name), "es") ?? "—",
    establishmentName: resolveLocalizedField(asLocalizedField(entry.establishment_name), "es") ?? "—",
    holderName: entry.holder_name,
    referrerPct: entry.referrer_pct,
    totalCop: entry.total_cop,
    referrerCommissionCop: entry.amount_cop,
    state: entry.status as CommissionRow["state"],
  }));

  const totals: CommissionTotals = totalsResult.data.reduce(
    (acc, row) => {
      if (row.status === "estimated") acc.estimated += row.amount_cop;
      if (row.status === "due") acc.due += row.amount_cop;
      if (row.status === "paid") acc.paid += row.amount_cop;
      if (row.status === "void") acc.void += row.amount_cop;
      return acc;
    },
    { estimated: 0, due: 0, paid: 0, void: 0 }
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Mis comisiones</h1>
      <CommissionsTable
        rows={rows}
        page={page}
        pageSize={pageSize}
        totalCount={count}
        sort={sort}
        filterValues={filters}
        extraParams={extraParams}
        totals={totals}
      />
    </div>
  );
}
