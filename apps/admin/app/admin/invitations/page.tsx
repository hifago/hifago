import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { resolveListParams } from "@hifago/domain";
import { buttonVariants } from "@hifago/ui";
import { InvitationsList, type InvitationRow } from "./InvitationsList";
import { INVITATIONS_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { INVITATIONS_DEFAULT_SORT, INVITATIONS_SORT_WHITELIST } from "@/lib/lists/sortable-columns";
import { resolveMissingEstablishmentPartners } from "@/lib/invitations/resolveMissingEstablishment";

type InvitationQueryRow = {
  id: string;
  promo_code: string;
  onboarding_path: string;
  status: string;
  expires_at: string;
  consumed_at: string | null;
  consumed_by_account_id: string | null;
  partner_id: string | null;
  created_at: string;
};

// docs/specs/05-invitations-onboarding-dashboard-partenaire.md §5.3 — jusqu'ici seul
// /admin/invitations/new existait, aucun suivi de ce qui a été envoyé/consommé/expiré. Lecture
// directe (pas de RPC) : partner_invitations_select_admin et partner_capabilities_select
// (20260813163456_identity_rls.sql) accordent déjà le select admin sur les deux tables.
// docs/specs/10-listes-standardisees-admin-socio.md (lot 4) — DataList, tri/filtres serveur,
// nouvelle fiche détail /admin/invitations/[id].
export default async function AdminInvitationsPage({
  searchParams,
}: PageProps<"/admin/invitations">) {
  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: INVITATIONS_SORT_WHITELIST,
      defaultSort: INVITATIONS_DEFAULT_SORT,
      filters: INVITATIONS_FILTER_DEFINITIONS,
    }
  );

  const supabase = await createClient();

  let query = supabase
    .from("partner_invitations")
    .select(
      "id, promo_code, onboarding_path, status, expires_at, consumed_at, consumed_by_account_id, partner_id, created_at",
      { count: "exact" }
    )
    .order(sort.column, { ascending: sort.direction === "asc" })
    .range(from, to);

  if (filters.q) {
    query = query.ilike("promo_code", `%${filters.q}%`);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.path) {
    query = query.eq("onboarding_path", filters.path);
  }

  // Une panne LÈVE (lib/supabase/checkedRead.ts) : lue comme une absence, elle affichait « aucune
  // invitation ».
  const { data: invitations, count } = checkedRead(
    await query.returns<InvitationQueryRow[]>(),
    "partner_invitations",
  );
  const rows = invitations ?? [];

  const { missingEstablishmentByInvitation } = await resolveMissingEstablishmentPartners(supabase, rows);

  const listRows: InvitationRow[] = rows.map((row) => ({
    id: row.id,
    promoCode: row.promo_code,
    onboardingPath: row.onboarding_path,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    missingEstablishmentPartnerId: missingEstablishmentByInvitation.get(row.id) ?? null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invitaciones</h1>
        <Link href="/admin/invitations/new" className={buttonVariants()} data-testid="new-invitation-link">
          Nueva invitación
        </Link>
      </div>
      <InvitationsList
        rows={listRows}
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
