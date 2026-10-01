import { createClient } from "@hifago/supabase/server";
import { todayInBogota } from "@hifago/domain";
import { addDays } from "./dates";
import type { SlotAvailabilityRow } from "@/components/slot-availability-grid";

export const SLOT_AVAILABILITY_WINDOW_DAYS = 14;

export type SlotAvailabilityPageData = {
  productName: unknown;
  from: string;
  windowEnd: string;
  dates: string[];
  slots: SlotAvailabilityRow[];
};

// Chargement complet de la page de cupos par horario — même requêtage pour l'écran admin
// (/admin/products/[id]/slot-availability) et l'écran socio (/partner/products/[id]/slot-
// availability), désormais unifié ici : les deux page.tsx restent de fins wrappers qui gardent
// chacun leur propre commentaire RLS (la sûreté de ce select non filtré dépend du RÔLE de
// l'appelant — admin vs socio — pas de la requête elle-même, donc documentée au point d'appel,
// pas ici). `null` = fiche introuvable OU sans aucune règle de créneaux (product_slot_rules) :
// cet écran n'a de sens que pour un produit qui en porte au moins une. Au page.tsx d'appeler
// notFound() dans les deux cas. Une lecture en ÉCHEC, elle, lève (frontière app/error.tsx) : une
// panne n'est jamais « produit introuvable », ni une grille vide « sans horaires définis ».
export async function loadSlotAvailabilityPageData(
  productId: string,
  fromParam: string | string[] | undefined,
): Promise<SlotAvailabilityPageData | null> {
  const supabase = await createClient();

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, type, name")
    .eq("id", productId)
    .maybeSingle();

  if (productError) throw productError;
  if (!product) {
    return null;
  }

  const { count: slotRulesCount, error: slotRulesError } = await supabase
    .from("product_slot_rules")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);

  if (slotRulesError) throw slotRulesError;
  if (!slotRulesCount) {
    return null;
  }

  const from =
    typeof fromParam === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)
      ? fromParam
      // Lot fuseau (2026-08-28) : sans ?from= explicite, la grille de disponibilité s'ouvrait sur
      // la date UTC — donc sur DEMAIN passé 19 h à Guatapé, la journée en cours disparaissant de
      // la fenêtre de 14 jours.
      : todayInBogota();
  const dates = Array.from({ length: SLOT_AVAILABILITY_WINDOW_DAYS }, (_, i) => addDays(from, i));
  const windowEnd = addDays(from, SLOT_AVAILABILITY_WINDOW_DAYS - 1);

  const { data: slots, error: slotsError } = await supabase.rpc("get_product_slots", {
    p_product_id: productId,
    p_from: from,
    p_to: windowEnd,
  });
  if (slotsError) throw slotsError;

  return {
    productName: product.name,
    from,
    windowEnd,
    dates,
    slots: slots ?? [],
  };
}
