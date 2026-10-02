import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { AvailabilityCalendar } from "@/components/availability-calendar";
import { ownerScope } from "@/lib/partnerOwnership";

export default async function PartnerProductAvailabilityPage({
  params,
}: PageProps<"/partner/products/[id]/availability">) {
  const { id } = await params;
  const supabase = await createClient();

  // Propriété (2026-10-01, lib/partnerOwnership.ts) : la RLS seule laissait passer toute fiche EN
  // VENTE d'un autre partenaire (products_select_public). Le filtre porte sur l'organisation de
  // l'ÉTABLISSEMENT de la fiche — le prédicat même de set_product_availability et set_date_rate —
  // et non sur `products.partner_id`, qui ne suit pas un transfert d'établissement. Une fiche hors
  // de l'organisation ressort « introuvable », jamais un refus explicite qui en révèlerait
  // l'existence. L'admin n'est pas restreint (`!inner` ne retire rien : establishment_id est not
  // null). La vraie
  // barrière d'écriture reste set_product_availability elle-même (feature 17, garde-fous
  // identité/propriété/capacité côté serveur), pas cette lecture.
  const scope = await ownerScope(supabase);
  let productQuery = supabase
    .from("products")
    .select("id, name, calendar_default_open, default_capacity, establishment:establishments!inner(partner_id)")
    .eq("id", id);
  if (scope.kind === "partner") {
    productQuery = productQuery.eq("establishment.partner_id", scope.partnerId);
  }
  // Une panne LÈVE (app/error.tsx) : lue comme une absence, elle répondait « introuvable ».
  const { data: product, error: productError } = await productQuery.maybeSingle();
  if (productError) {
    throw new Error(`Lecture du produit impossible (products) : ${productError.message}`);
  }
  if (!product) {
    notFound();
  }

  // Même service que l'écran admin (feature 5/17, cf. cahier des charges socio §3d) : lecture
  // publique de product_availability/product_calendar/product_date_rates, pas de filtre socio
  // nécessaire ici — la vraie barrière d'écriture reste set_date_rate elle-même (spec 17 §0
  // Tranche 2, garde-fous identité/propriété/capacité côté serveur), pas cette lecture.
  // Une panne lève aussi : un calendrier vide se lirait « aucune date fermée, aucun cupo réservé ».
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
  for (const [table, result] of [
    ["product_availability", availabilityResult],
    ["product_calendar", calendarResult],
    ["product_date_rates", ratesResult],
  ] as const) {
    if (result.error) {
      throw new Error(`Lecture du calendrier impossible (${table}) : ${result.error.message}`);
    }
  }
  const availability = availabilityResult.data;
  const calendar = calendarResult.data;
  const rates = ratesResult.data;

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
      />
    </div>
  );
}
