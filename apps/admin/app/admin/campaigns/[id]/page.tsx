import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { requireUuidParam } from "@/lib/routing/requireUuidParam";
import { ProcessBatchButton } from "./ProcessBatchButton";

const AUDIENCE_LABELS: Record<string, string> = {
  clients: "Clientes",
  referrers: "Referentes",
  providers: "Prestadores",
  partners: "Socios (referentes y prestadores)",
  all: "Todos",
};
const CHANNEL_LABELS: Record<string, string> = { whatsapp: "WhatsApp", email: "Correo electrónico" };
const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  sending: "Enviando",
  completed: "Completada",
};
// Ordre d'affichage fixe des compteurs — indépendant de l'ordre d'arrivée des cibles en base.
const TARGET_STATUS_ORDER = [
  "pending",
  "sent",
  "skipped_unreachable",
  "skipped_ineligible",
  "skipped_no_consent",
] as const;
const TARGET_STATUS_LABELS: Record<(typeof TARGET_STATUS_ORDER)[number], string> = {
  pending: "Pendientes",
  sent: "Enviados",
  skipped_unreachable: "Ignorados (sin contacto)",
  skipped_ineligible: "Ignorados (ya no elegibles)",
  skipped_no_consent: "Ignorados (sin consentimiento)",
};

export default async function CampaignDetailPage({
  params,
}: PageProps<"/admin/campaigns/[id]">) {
  const id = requireUuidParam((await params).id);
  const supabase = await createClient();

  // Une panne LÈVE (app/error.tsx) : lue comme une absence, elle répondait « introuvable », ou des
  // compteurs à zéro.
  const { data: campaign, error: campaignError } = await supabase
    .from("comm_campaigns")
    .select("id, audience, channel, status, message_template, created_at")
    .eq("id", id)
    .maybeSingle();
  if (campaignError) {
    throw new Error(`Lecture de la campagne impossible (comm_campaigns) : ${campaignError.message}`);
  }

  if (!campaign) {
    notFound();
  }

  // comm_campaign_targets_select_admin : lecture admin seule — pas de filtre supplémentaire ici.
  const { data: targets, error: targetsError } = await supabase
    .from("comm_campaign_targets")
    .select("status")
    .eq("campaign_id", id);
  if (targetsError) {
    throw new Error(`Lecture des destinataires impossible (comm_campaign_targets) : ${targetsError.message}`);
  }

  const counts = Object.fromEntries(TARGET_STATUS_ORDER.map((status) => [status, 0])) as Record<
    (typeof TARGET_STATUS_ORDER)[number],
    number
  >;
  for (const target of targets ?? []) {
    if (target.status in counts) {
      counts[target.status as (typeof TARGET_STATUS_ORDER)[number]] += 1;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Campaña — {AUDIENCE_LABELS[campaign.audience] ?? campaign.audience}
        </h1>
        <p className="text-sm text-muted">
          {CHANNEL_LABELS[campaign.channel] ?? campaign.channel} · Estado:{" "}
          <span data-testid="campaign-status">
            {CAMPAIGN_STATUS_LABELS[campaign.status] ?? campaign.status}
          </span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5" data-testid="target-counts">
        {TARGET_STATUS_ORDER.map((status) => (
          <div key={status} className="rounded-lg border bg-surface p-4">
            <p className="text-sm text-muted">{TARGET_STATUS_LABELS[status]}</p>
            <p className="text-lg font-semibold" data-testid={`count-${status}`}>
              {counts[status]}
            </p>
          </div>
        ))}
      </div>

      <ProcessBatchButton campaignId={campaign.id} isCompleted={campaign.status === "completed"} />
    </div>
  );
}
