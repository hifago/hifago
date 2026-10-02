import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { asLocalizedField, resolveLocalizedField, resolveListParams } from "@hifago/domain";
import { LEDGER_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { LEDGER_DEFAULT_SORT, LEDGER_SORT_WHITELIST } from "@/lib/lists/sortable-columns";
import { LedgerTable, type LedgerRow } from "./LedgerTable";
import type { EstablishmentOption, ReferrerOption } from "./LedgerFilterBar";

// Refonte /admin/ledger (docs/specs/10-listes-standardisees-admin-socio.md) — remplace l'ancien
// fetch unique non filtré/non paginé par le même patron que admin/orders et partner/commissions :
// resolveListParams + requête paginée/triée côté serveur.
export default async function AdminLedgerPage({
  searchParams,
}: PageProps<"/admin/ledger">) {
  const supabase = await createClient();

  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: LEDGER_SORT_WHITELIST,
      defaultSort: LEDGER_DEFAULT_SORT,
      filters: LEDGER_FILTER_DEFINITIONS,
    }
  );

  // RPC admin_ledger_entries_list (20260930211348), jamais un embed `order_lines` : depuis le
  // revoke du 2026-09-22, une session n'a plus le droit de lire `order_lines`, et l'embed d'avant
  // rendait une erreur avalée en ledger vide (scripts/check-order-lines-access.sh l'interdit
  // désormais). Les filtres type/établissement sont résolus en SQL, plus par une pré-requête
  // `products`. L'erreur LÈVE au lieu de s'afficher comme une liste vide : c'est le silence de
  // `?? []` qui a laissé ce ledger vide une semaine sans que personne ne le voie.
  const { data: entries, error } = await supabase.rpc("admin_ledger_entries_list", {
    p_date_from: filters.date_from ?? null,
    p_date_to: filters.date_to ?? null,
    p_status: filters.status ?? null,
    p_type: filters.type ?? null,
    p_referrer_partner_id: filters.referrer_partner_id ?? null,
    p_establishment_id: filters.establishment_id ?? null,
    p_sort_key: sort.column,
    p_sort_desc: sort.direction === "desc",
    p_limit: to - from + 1,
    p_offset: from,
  });
  if (error) {
    throw new Error(`Lecture du ledger impossible (admin_ledger_entries_list) : ${error.message}`);
  }
  const count = entries.length === 0 ? 0 : entries[0].total_count;

  const rows: LedgerRow[] = entries.map((entry) => ({
    id: entry.id,
    referrerName: entry.referrer_display_name ?? "—",
    establishmentName: resolveLocalizedField(asLocalizedField(entry.establishment_name), "es") ?? "—",
    productType: entry.product_type,
    date: entry.date,
    status: entry.status,
    amountCop: entry.amount_cop,
  }));

  // Options des combobox de filtre — listes complètes (pas de plafond), chargées en une seule
  // requête chacune, jamais paginées : retour Jérôme, plus correct qu'un <select> plafonné pour un
  // écran de réconciliation financière (cf. plan).
  // Une panne LÈVE (lib/supabase/checkedRead.ts) : des listes de filtre vides cacheraient des
  // référents et des établissements à réconcilier.
  const { data: referrerCapabilities } = checkedRead(
    await supabase
      .from("partner_capabilities")
      .select("partner_id, partner:partners(display_name)")
      .eq("role", "referrer")
      .eq("status", "active")
      .returns<{ partner_id: string; partner: { display_name: string } | null }[]>(),
    "partner_capabilities",
  );

  const referrersById = new Map<string, string>();
  for (const capability of referrerCapabilities ?? []) {
    if (capability.partner?.display_name) {
      referrersById.set(capability.partner_id, capability.partner.display_name);
    }
  }
  const referrers: ReferrerOption[] = Array.from(referrersById, ([id, name]) => ({ id, name })).sort(
    (a, b) => a.name.localeCompare(b.name)
  );

  const { data: establishmentsRaw } = checkedRead(
    await supabase.from("establishments").select("id, name").returns<{ id: string; name: unknown }[]>(),
    "establishments",
  );
  const establishments: EstablishmentOption[] = (establishmentsRaw ?? [])
    .map((establishment) => ({
      id: establishment.id,
      name: resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Ledger de liquidación</h1>
      <LedgerTable
        rows={rows}
        page={page}
        pageSize={pageSize}
        totalCount={count}
        sort={sort}
        filterValues={filters}
        extraParams={extraParams}
        referrers={referrers}
        establishments={establishments}
      />
    </div>
  );
}
