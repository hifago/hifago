import type { createClient } from "@hifago/supabase/client";

export type SlotOption = { slotStartTime: string; label: string };

/**
 * Les créneaux d'un produit à une date, pour le sélecteur d'horaire de la réservation manuelle
 * (`AddReservationDialog`, spec 20). `{ ok: false }` sur une erreur de lecture — jamais une liste
 * vide, qui se lirait « aucun créneau ce jour-là » alors que la base n'a simplement pas répondu.
 */
export async function loadSlotOptions(
  supabase: ReturnType<typeof createClient>,
  productId: string,
  date: string
): Promise<{ ok: true; options: SlotOption[] } | { ok: false }> {
  const { data, error } = await supabase.rpc("get_product_slots", {
    p_product_id: productId,
    p_from: date,
    p_to: date,
  });
  if (error) return { ok: false };
  const rows = (data ?? []) as { slot_start_time: string; capacity: number; booked: number }[];
  return {
    ok: true,
    options: rows.map((row) => ({
      slotStartTime: row.slot_start_time,
      label: `${row.slot_start_time.slice(0, 5)} (${row.booked}/${row.capacity})`,
    })),
  };
}
