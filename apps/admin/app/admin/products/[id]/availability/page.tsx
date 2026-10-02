import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { requireUuidParam } from "@/lib/routing/requireUuidParam";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { AvailabilityCalendar } from "@/components/availability-calendar";

export default async function ProductAvailabilityPage({
  params,
}: PageProps<"/admin/products/[id]/availability">) {
  const id = requireUuidParam((await params).id);
  const supabase = await createClient();

  // RLS (products_select_public) : l'admin voit aussi les activités non publiées.
  // Chaque lecture LÈVE sur une panne (lib/supabase/checkedRead.ts) : lue comme une absence, elle
  // répondait « introuvable », ou un calendrier vide — « aucune date fermée, aucun cupo réservé ».
  const { data: product } = checkedRead(
    await supabase
      .from("products")
      .select("id, name, calendar_default_open, default_capacity, group_discount_threshold_qty")
      .eq("id", id)
      .maybeSingle(),
    "products",
  );

  if (!product) {
    notFound();
  }

  // product_availability/product_calendar/product_date_rates : lecture publique (RLS), pas de
  // filtre admin nécessaire — RPC-only seulement en écriture (correctif Tranche 2/3, set_date_rate
  // spec 17 §0 Tranche 2).
  const [availabilityResult, calendarResult, ratesResult] = await Promise.all([
    supabase
      .from("product_availability")
      .select("date, capacity, booked")
      .eq("product_id", id),
    supabase
      .from("product_calendar")
      .select("date, open")
      .eq("product_id", id),
    supabase
      .from("product_date_rates")
      .select("date, price_cop")
      .eq("product_id", id),
  ]);
  const { data: availability } = checkedRead(availabilityResult, "product_availability");
  const { data: calendar } = checkedRead(calendarResult, "product_calendar");
  const { data: rates } = checkedRead(ratesResult, "product_date_rates");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Calendario y cupos —{" "}
        {resolveLocalizedField(asLocalizedField(product.name), "es") ?? product.id}
      </h1>
      <AvailabilityCalendar
        entityId={product.id}
        calendarDefaultOpen={product.calendar_default_open}
        availability={availability ?? []}
        calendar={calendar ?? []}
        rates={rates ?? []}
        defaultCapacity={product.default_capacity}
        groupDiscountThresholdQty={product.group_discount_threshold_qty}
      />
    </div>
  );
}
