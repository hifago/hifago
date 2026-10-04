import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { buttonVariants } from "@hifago/ui";
import { resolveListParams } from "@hifago/domain";
import { CampaignsList, type CampaignRow } from "./CampaignsList";
import { CAMPAIGNS_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { CAMPAIGNS_DEFAULT_SORT, CAMPAIGNS_SORT_WHITELIST } from "@/lib/lists/sortable-columns";

// docs/specs/02-admin-accueil-et-navigation.md §5.4 — même patron que /admin/proposals ou
// /admin/reconciliation, lien vers campaigns/new et campaigns/[id]. `comm_campaigns`
// (20260814230000_campaign_engine.sql) ne porte aucune colonne nom/libellé — seulement
// audience/channel/message_template/status — donc la recherche locale (`?q=`) porte sur
// `message_template`, seul champ texte libre de la campagne, en l'absence d'un vrai titre.
// docs/specs/10-listes-standardisees-admin-socio.md (lot 4) — DataList, tri/filtres serveur.
export default async function AdminCampaignsPage({
  searchParams,
}: PageProps<"/admin/campaigns">) {
  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: CAMPAIGNS_SORT_WHITELIST,
      defaultSort: CAMPAIGNS_DEFAULT_SORT,
      filters: CAMPAIGNS_FILTER_DEFINITIONS,
    }
  );

  const supabase = await createClient();

  // comm_campaigns_select_admin (feature 25) : lecture admin seule, RLS déjà en place — pas de RPC
  // nécessaire (spec 02 §7).
  let query = supabase
    .from("comm_campaigns")
    .select("id, audience, channel, status, message_template, created_at", { count: "exact" })
    .order(sort.column, { ascending: sort.direction === "asc" })
    .range(from, to);
  if (filters.q) {
    query = query.ilike("message_template", `%${filters.q}%`);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.audience) {
    query = query.eq("audience", filters.audience);
  }
  if (filters.channel) {
    query = query.eq("channel", filters.channel);
  }
  // Une panne LÈVE (app/error.tsx) : lue comme une absence, elle affichait « aucune campagne ».
  const { data: campaigns, count, error: campaignsError } = await query;
  if (campaignsError) {
    throw new Error(`Lecture des campagnes impossible (comm_campaigns) : ${campaignsError.message}`);
  }

  const campaignIds = (campaigns ?? []).map((campaign) => campaign.id);
  // Progression d'envoi par campagne : même donnée que campaigns/[id]/page.tsx, un seul appel pour
  // toute la page. Agrégée en SQL (admin_campaign_target_counts, 20261002155922) : une ligne par
  // (campagne, statut). L'ancienne lecture rendait une ligne par destinataire, comptée ici en JS et
  // tronquée par `max_rows` au-delà de 1000 — une campagne d'audience `all` suffisait à fausser les
  // compteurs sans aucun signal.
  const targetCounts: Record<string, { total: number; sent: number }> = {};
  if (campaignIds.length > 0) {
    const { data: counts, error: countsError } = await supabase.rpc("admin_campaign_target_counts", {
      p_campaign_ids: campaignIds,
    });
    if (countsError) {
      throw new Error(`Lecture des destinataires impossible (admin_campaign_target_counts) : ${countsError.message}`);
    }
    for (const row of counts) {
      const bucket = (targetCounts[row.campaign_id] ??= { total: 0, sent: 0 });
      bucket.total += row.n;
      if (row.status === "sent") bucket.sent += row.n;
    }
  }

  const rows: CampaignRow[] = (campaigns ?? []).map((campaign) => ({
    id: campaign.id,
    audience: campaign.audience,
    channel: campaign.channel,
    status: campaign.status,
    progress: targetCounts[campaign.id]
      ? `${targetCounts[campaign.id].sent}/${targetCounts[campaign.id].total}`
      : "—",
    createdAt: campaign.created_at,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Campañas</h1>
        <Link href="/admin/campaigns/new" className={buttonVariants()} data-testid="new-campaign-link">
          Nueva campaña
        </Link>
      </div>
      <CampaignsList
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
