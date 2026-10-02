import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { resolveListParams } from "@hifago/domain";
import { buttonVariants } from "@hifago/ui";
import { PartnersTable, type PartnerRow } from "./PartnersTable";
import { PARTNERS_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { PARTNERS_DEFAULT_SORT, PARTNERS_SORT_WHITELIST } from "@/lib/lists/sortable-columns";

// docs/specs/10-listes-standardisees-admin-socio.md (lot 4) — DataList, tri/filtres serveur.
export default async function AdminPartnersPage({
  searchParams,
}: PageProps<"/admin/partners">) {
  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: PARTNERS_SORT_WHITELIST,
      defaultSort: PARTNERS_DEFAULT_SORT,
      filters: PARTNERS_FILTER_DEFINITIONS,
    }
  );

  const supabase = await createClient();

  // Revue admin partenaires (Jérôme, 2026-08-19) — RPC list_partners_admin remplace la query
  // .from("partners") + le 2e aller-retour count_partner_establishments (fusionné dans la RPC,
  // qui n'a pas besoin du grant SELECT table-large manquant sur establishments, security definer).
  // Recherche géographique : lat/lon/radius_km viennent de l'URL (potentiellement forgés) — jamais
  // transmis sans passer par Number.isFinite, contrairement à PartnerLocationBlock où ces valeurs
  // viennent d'un state contrôlé par le widget Google.
  const parsedLat = filters.lat ? Number(filters.lat) : undefined;
  const parsedLon = filters.lon ? Number(filters.lon) : undefined;
  const parsedRadius = filters.radius_km ? Number(filters.radius_km) : undefined;
  const p_lat = parsedLat !== undefined && Number.isFinite(parsedLat) ? parsedLat : undefined;
  const p_lon = parsedLon !== undefined && Number.isFinite(parsedLon) ? parsedLon : undefined;
  const p_radius_km = parsedRadius !== undefined && Number.isFinite(parsedRadius) ? parsedRadius : undefined;

  const { data: rpcRows } = checkedRead(
    await supabase.rpc("list_partners_admin", {
      p_search: filters.q ?? null,
      p_role: filters.role ?? null,
      p_city: filters.city ?? null,
      p_lat,
      p_lon,
      p_radius_km,
      p_sort_key: sort.key,
      p_sort_desc: sort.direction === "desc",
      p_limit: pageSize,
      p_offset: from,
    }),
    "list_partners_admin",
  );
  // Une panne LÈVE (lib/supabase/checkedRead.ts) : `error ? []` l'affichait comme une liste vide.
  const partners = rpcRows ?? [];
  const count = partners[0]?.total_count ?? 0;

  const rows: PartnerRow[] = partners.map((partner) => ({
    id: partner.id,
    displayName: partner.display_name,
    activeRoles: partner.active_roles,
    establishmentsCount: partner.establishments_count,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Partners</h1>
        <Link href="/admin/partners/new" className={buttonVariants()} data-testid="new-partner-link">
          Nuevo partner
        </Link>
      </div>
      <PartnersTable
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
