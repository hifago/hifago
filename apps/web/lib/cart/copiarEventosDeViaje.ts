import type { createClient } from "@hifago/supabase/client";

// Spec 42 — un evento non réservable noté dans Mi viaje (`trip_events`), sous sa forme brute.
export type EventoDeViaje = { productId: string; date: string };

// Recopie des eventos notés vers une autre identité, après une connexion (LoginForm.tsx, et la
// fusion post-OAuth de CartContext.tsx) — le pendant de la recopie de `cart_items` faite aux deux
// mêmes endroits. UN insert par evento, jamais un insert groupé : un seul evento devenu invalide
// entre-temps (réservable en ligne, dépublié) ferait échouer tout le lot, et un doublon (23505,
// evento déjà noté sous ce compte) aussi. Best-effort, comme la recopie du panier : aucune erreur
// ne bloque la connexion.
export async function copiarEventosDeViaje(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
  eventos: EventoDeViaje[]
): Promise<void> {
  await Promise.all(
    eventos.map((evento) =>
      supabase
        .from("trip_events")
        .insert({ account_id: accountId, product_id: evento.productId, date: evento.date })
    )
  );
}
