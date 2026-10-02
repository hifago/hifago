import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { requireUuidParam } from "@/lib/routing/requireUuidParam";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { AvailabilityCalendar } from "@/components/availability-calendar";
import { AvailabilityBlocksTable } from "./AvailabilityBlocksTable";

type BlockQueryRow = {
  id: string;
  start_date: string;
  end_date: string;
  source_order_line_id: string;
};

export default async function EstablishmentResourcePage({
  params,
}: PageProps<"/admin/establishments/[id]/resource">) {
  const id = requireUuidParam((await params).id);
  const supabase = await createClient();

  // RLS (establishments_select) : l'admin voit n'importe quel établissement.
  // Chaque lecture LÈVE sur une panne (lib/supabase/checkedRead.ts) : lue comme une absence, elle
  // répondait « introuvable », ou un calendrier sans cupos ni blocages.
  const { data: establishment } = checkedRead(
    await supabase.from("establishments").select("id, name").eq("id", id).maybeSingle(),
    "establishments",
  );

  if (!establishment) {
    notFound();
  }

  // provider_resource_calendar_select_public : lecture publique, comme product_availability —
  // aucun filtre admin nécessaire ici, RPC-only seulement en écriture.
  // availability_blocks_select_admin : lecture admin seule (« voir la cause du blocage », admin
  // §3c) — jamais publique, révélerait des données de commande.
  const [availabilityResult, blocksResult] = await Promise.all([
    supabase
      .from("provider_resource_calendar")
      .select("slot_date, capacity, booked")
      .eq("establishment_id", id),
    supabase
      .from("availability_blocks")
      .select("id, start_date, end_date, source_order_line_id")
      .eq("establishment_id", id)
      .order("start_date", { ascending: false })
      .returns<BlockQueryRow[]>(),
  ]);
  const { data: availability } = checkedRead(availabilityResult, "provider_resource_calendar");
  const { data: blocks } = checkedRead(blocksResult, "availability_blocks");

  // Identité du produit/titulaire : jamais un embed PostgREST direct vers order_lines (fuite des
  // colonnes de commission, docs/backlog.md) — même RPC admin que la page réconciliation
  // (admin_order_line_summaries, 20260922140000).
  const blockLineIds = [...new Set((blocks ?? []).map((block) => block.source_order_line_id))];
  const { data: blockSummaries } = checkedRead(
    await supabase.rpc("admin_order_line_summaries", { p_order_line_ids: blockLineIds }),
    "admin_order_line_summaries",
  );
  const blockSummaryByLineId = new Map(
    (blockSummaries ?? []).map((summary) => [summary.order_line_id, summary])
  );
  const blockRows = (blocks ?? []).map((block) => {
    const summary = blockSummaryByLineId.get(block.source_order_line_id);
    return {
      id: block.id,
      startDate: block.start_date,
      endDate: block.end_date,
      productName: resolveLocalizedField(asLocalizedField(summary?.product_name), "es") ?? "—",
      holderName: summary?.holder_name ?? "—",
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/admin/establishments/${establishment.id}`}
          className="text-sm text-muted hover:underline"
        >
          ← {resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id}
        </Link>
        <h1 className="text-2xl font-semibold">Recurso compartido del establecimiento</h1>
        <p className="text-sm text-muted">
          Capacidad de la ressource compartida entre campamentos/eventos reservables de este
          establecimiento — distinta de la capacidad propia de cada actividad.
        </p>
      </div>

      <AvailabilityCalendar
        entityId={establishment.id}
        mode="resource"
        availability={(availability ?? []).map((row) => ({
          date: row.slot_date,
          capacity: row.capacity,
          booked: row.booked,
        }))}
      />

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Causa de los bloqueos</h2>
        <AvailabilityBlocksTable blocks={blockRows} />
      </div>
    </div>
  );
}
