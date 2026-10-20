import { createClient } from "@hifago/supabase/server";
import { resolveLocalizedField, asLocalizedField, todayInBogota } from "@hifago/domain";
import type { Locale } from "@/messages";

// Spec 42 — les eventos non réservables notés dans Mi viaje (`trip_events`), joints pour
// l'affichage, Server Components seulement — même patron que `getCartLines` : la table ne stocke
// que `product_id`, la jointure se fait ici, à l'affichage.
//
//   - À venir seulement : `date >= todayInBogota()` (décision de Jérôme, 2026-10-19 : « après la
//     date, un événement passé disparaît ») — un filtre de lecture, aucune purge ;
//   - produit encore visible seulement (`products!inner` : la RLS de products écarte un evento
//     dépublié) — mêmes deux règles que la pastille de l'en-tête (`CartContext.tsx`) ;
//   - `onOccurrence` : la date est-elle encore une occurrence (`trip_events_status`) ? `false`
//     quand l'admin a changé les dates après coup. Un confort : lecture en panne → `true` (aucune
//     ligne signalée à tort), jamais une levée.
export type TripEventForDisplay = {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  establishmentName: string;
  date: string;
  /** `products.start_time` (`HH:MM:SS`), `null` si l'evento n'en a pas. */
  startTime: string | null;
  onOccurrence: boolean;
};

export async function getTripEvents(locale: Locale): Promise<TripEventForDisplay[]> {
  const supabase = await createClient();
  const [{ data, error }, statuts] = await Promise.all([
    supabase
      .from("trip_events")
      .select(
        "id, product_id, date, created_at, products!inner(name, slug, start_time, establishment:establishments(name))"
      )
      .gte("date", todayInBogota())
      .order("date", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase.rpc("trip_events_status"),
  ]);

  // Visiteur sans session (lien direct, robot, connexion anonyme pas encore faite par
  // CartContext) : anon n'a aucun grant sur trip_events (migration 20261019190000), d'où 42501
  // avant même la RLS — il n'a rien noté, la liste est vide. Sans ce cas, /mi-viaje rendait 500
  // (constaté en prod le 2026-10-19). authenticated a son grant : 42501 ne vient que d'anon.
  if (error?.code === "42501") return [];
  // Comme le panier : une liste illisible n'est jamais une liste vide.
  if (error) throw error;
  if (!data) return [];

  const horsOccurrence = new Set(
    statuts.error ? [] : (statuts.data ?? []).filter((s) => !s.on_occurrence).map((s) => s.id)
  );

  return data.map((row) => ({
    id: row.id,
    productId: row.product_id,
    productName: resolveLocalizedField(asLocalizedField(row.products.name), locale) ?? row.products.slug,
    productSlug: row.products.slug,
    establishmentName:
      resolveLocalizedField(asLocalizedField(row.products.establishment?.name), locale) ?? "",
    date: row.date,
    startTime: row.products.start_time,
    onOccurrence: !horsOccurrence.has(row.id),
  }));
}
