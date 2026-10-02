import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { asLocalizedField, resolveLocalizedField, resolveListParams } from "@hifago/domain";
import { buttonVariants } from "@hifago/ui";
import { EstablishmentsList, type EstablishmentRow } from "./EstablishmentsList";
import { ESTABLISHMENTS_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { ESTABLISHMENTS_DEFAULT_SORT, ESTABLISHMENTS_SORT_WHITELIST } from "@/lib/lists/sortable-columns";

// docs/specs/10-listes-standardisees-admin-socio.md (lot 4) — DataList, tri/filtres serveur.
export default async function AdminEstablishmentsPage({
  searchParams,
}: PageProps<"/admin/establishments">) {
  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: ESTABLISHMENTS_SORT_WHITELIST,
      defaultSort: ESTABLISHMENTS_DEFAULT_SORT,
      filters: ESTABLISHMENTS_FILTER_DEFINITIONS,
    }
  );

  const supabase = await createClient();

  // Revue admin établissements (Jérôme, 2026-08-19) — RPC list_establishments_admin remplace la
  // query .from("establishments") : recherche unifiée nom établissement + nom partenaire (un
  // or=() PostgREST ne peut pas combiner une colonne de la table de base avec une colonne d'une
  // relation embarquée), + establishments a perdu son GRANT SELECT table-large depuis
  // 20260819110000 (count(*) over() en dépend), + jointures propositions en attente/capacité
  // operator active. Lecture cross-partenaires de toute façon RPC-only par nature
  // (hifago/CLAUDE.md §3 critère 1). sort.key (pas sort.column) : la RPC fait son propre mapping
  // clé→colonne en interne (CASE statique), cf. migration.
  const { data: rpcRows } = checkedRead(
    await supabase.rpc("list_establishments_admin", {
      p_search: filters.q ?? null,
      p_status: filters.status ?? null,
      p_sort_key: sort.key,
      p_sort_desc: sort.direction === "desc",
      p_limit: pageSize,
      p_offset: from,
    }),
    "list_establishments_admin",
  );
  // Une panne LÈVE (lib/supabase/checkedRead.ts) : `error ? []` l'affichait comme une liste vide.
  const establishments = rpcRows ?? [];
  const count = establishments[0]?.total_count ?? 0;

  // Spec 17 §0 Tranche 0 — deuxième vague dépendante des id de la page courante (même idiome
  // qu'ailleurs, ex. photos/propositions en attente) : quels établissements de CETTE page portent
  // au moins un camp/evento, pour conditionner le lien "Recurso compartido" (EstablishmentsList).
  const establishmentIds = establishments.map((e) => e.id);
  const { data: sharedResourceProducts } = checkedRead(
    establishmentIds.length > 0
      ? await supabase
          .from("products")
          .select("establishment_id")
          .in("establishment_id", establishmentIds)
          .in("type", ["camp", "evento"])
      : { data: [] as { establishment_id: string }[], error: null },
    "products",
  );
  const establishmentIdsWithSharedResource = new Set(
    (sharedResourceProducts ?? []).map((p) => p.establishment_id)
  );

  const rows: EstablishmentRow[] = establishments.map((establishment) => ({
    id: establishment.id,
    name: resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id,
    partnerId: establishment.partner_id,
    partnerName: establishment.partner_display_name ?? "—",
    status: establishment.status,
    activitiesCount: establishment.activities_count ?? 0,
    hasSharedResourceProducts: establishmentIdsWithSharedResource.has(establishment.id),
    pendingProposal: establishment.pending_proposal_id
      ? {
          id: establishment.pending_proposal_id,
          kind: establishment.pending_proposal_kind as "edit" | "photos",
        }
      : null,
    operatorInactive: establishment.operator_inactive ?? false,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Establecimientos</h1>
        <Link href="/admin/establishments/new" className={buttonVariants()}>
          Nuevo establecimiento
        </Link>
      </div>
      <EstablishmentsList
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
