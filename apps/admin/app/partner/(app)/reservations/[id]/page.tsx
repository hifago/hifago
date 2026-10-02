import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, formatCop, formatDateTimeInBogota, resolveLocalizedField } from "@hifago/domain";
import { Card, Chip } from "@hifago/ui";
import { ContactClientButton } from "@/components/ContactClientButton";
import { isRealClientEmail } from "@/lib/whatsapp";
import { STATUS_LABELS, STATUS_CHIP_COLOR } from "@/app/admin/orders/statusLabels";
import { ReservationActions } from "./ReservationActions";

// Spec 20 §0/§5 — fiche de réservation individuelle, jamais construite avant côté socio (seul
// /admin/orders/[id] existait, au niveau `orders`, admin-only). id = order_lines.id, pas orders.id.
// Téléphone/email désormais affichés (refonte vue prestataire, 2026-08-19, migration
// 20260819180000) — lève la restriction "PII minimale" documentée jusqu'ici ; les colonnes de
// commission internes (referrer_commission_cop, app_commission_cop, commission_case) restent, elles,
// hors périmètre socio.
//
// ⚠️ partner_reservation_detail (20260922200000) : le scope has_capability(auth.uid(),'operator',
// establishment_id) qu'elle applique EST le rempart — cette page n'a aucun autre filtre, jamais un
// establishment_id à comparer ici. Ne jamais revenir à un `.from("order_lines")` direct.
export default async function PartnerReservationDetailPage({
  params,
}: PageProps<"/partner/reservations/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  // La page LÈVE sur une panne (app/error.tsx, 2026-10-01) : seul `[]` est « introuvable » — la
  // RPC le rend pour une ligne inexistante comme pour une ligne hors de ses établissements, sans
  // distinguer les deux, ce qui ne révèle rien.
  const { data: lines, error: detailError } = await supabase.rpc("partner_reservation_detail", {
    p_order_line_id: id,
  });
  if (detailError) {
    throw new Error(`Lecture de la réservation impossible (partner_reservation_detail) : ${detailError.message}`);
  }
  const line = lines?.[0];

  if (!line) {
    notFound();
  }

  // Durée du créneau : un COMPLÉMENT, lu au mieux et explicitement. La RPC ne rend pas le produit
  // de la ligne, si bien que cette lecture se fait sur la date et l'heure seules : deux produits au
  // même créneau la rendent ambiguë (`maybeSingle()` répond alors une erreur PGRST116). Dans ce cas
  // comme sur une panne, la fiche s'affiche sans durée — jamais un écran d'erreur pour un détail —,
  // et seule une vraie panne est journalisée. Le correctif durable (la durée rendue par la RPC
  // elle-même) relève de la base.
  let slotDurationMinutes: number | null = null;
  if (line.slot_start_time) {
    const { data: slot, error: slotError } = await supabase
      .from("product_slot_availability")
      .select("slot_duration_minutes")
      .eq("slot_date", line.date)
      .eq("slot_start_time", line.slot_start_time)
      .maybeSingle();
    if (slotError && slotError.code !== "PGRST116") {
      console.error(`Durée du créneau illisible (réservation ${line.id})`, slotError.message);
    }
    slotDurationMinutes = slot?.slot_duration_minutes ?? null;
  }

  const productName = resolveLocalizedField(asLocalizedField(line.product_name), "es") ?? "—";
  const establishmentName = resolveLocalizedField(asLocalizedField(line.establishment_name), "es") ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reserva</h1>
        <Chip variant="soft" color={STATUS_CHIP_COLOR[line.status] ?? "default"} data-testid="reservation-detail-status">
          {STATUS_LABELS[line.status] ?? line.status}
        </Chip>
      </div>

      <Card data-testid="reservation-detail-card">
        <Card.Content className="flex flex-col gap-3">
          <Field label="Producto" value={productName} />
          <Field label="Establecimiento" value={establishmentName} />
          <Field label="Titular" value={line.holder_name} />
          {line.holder_phone ? <Field label="Teléfono" value={line.holder_phone} /> : null}
          {isRealClientEmail(line.holder_email) ? <Field label="Email" value={line.holder_email} /> : null}
          <Field label="Fecha" value={formatDate(line)} />
          {line.slot_start_time ? (
            <Field label="Horario" value={formatSlot(line.slot_start_time, slotDurationMinutes)} />
          ) : null}
          <Field label="Cantidad" value={`${line.qty} pers.`} />
          <Field label="Monto total" value={formatCop(line.total_cop)} />
          <Field label="Creada el" value={formatDateTimeInBogota(line.created_at, "es-CO")} />
        </Card.Content>
      </Card>

      <ContactClientButton
        holderName={line.holder_name}
        holderPhone={line.holder_phone}
        holderEmail={line.holder_email}
      />

      <ReservationActions
        orderLineId={line.id}
        status={line.status}
        hasSlot={line.slot_start_time !== null}
        initialDate={line.date}
        initialEndDate={line.end_date}
        initialQty={line.qty}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-none">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function formatDate(line: { date: string; end_date: string | null }): string {
  if (line.end_date) {
    return `${line.date} → ${line.end_date}`;
  }
  return line.date;
}

function formatSlot(slotStartTime: string, durationMinutes: number | null): string {
  const time = slotStartTime.slice(0, 5);
  if (durationMinutes === null) {
    return time;
  }
  return `${time} (${durationMinutes} min)`;
}
