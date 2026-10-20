"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@hifago/supabase/client";
import { todayInBogota } from "@hifago/domain";
import { copiarEventosDeViaje, type EventoDeViaje } from "./copiarEventosDeViaje";

// Spec 32 (panier en base) — réécrit le 2026-09-10 : les lignes ne vivent plus dans `useState`
// (perdues à tout rechargement, cf. l'ancien commentaire de tête) mais dans `cart_items`,
// rattachées à l'identité posée par la spec 31. `CartLine` perd `productName`/`establishmentName`/
// `priceCop` (décision ② — `cart_items` ne stocke que `product_id`, jamais dénormalisé) : ce
// contexte ne porte plus que la forme BRUTE de la ligne, celle dont `lib/reservas/disponibilidad.ts`
// et `reservationRange.ts` ont besoin pour marquer une date/un créneau déjà présent dans le panier
// en cours (jamais la vraie barrière, qui reste `create_order`). L'affichage RICHE d'une ligne
// (nom, établissement, prix) est désormais une jointure côté serveur (`lib/cart/getCartLines.ts`),
// consommée par `/mi-viaje` et `/pago` — jamais recalculée ici.
export type CartLine = {
  id: string;
  productId: string;
  date: string;
  endDate?: string;
  slotStartTime?: string;
  qty: number;
};

export type AddToCartInput = Omit<CartLine, "id">;

// Spec 42 : un evento non réservable noté dans Mi viaje (`trip_events`) — jamais une ligne de
// panier, jamais lu par create_order. Seuls les eventos À VENIR (date de Guatapé) et encore visibles
// (produit publié) : ce que Mi viaje affiche, donc ce que la pastille de l'en-tête compte.
export type TripEvent = { id: string } & EventoDeViaje;

// Retour Jérôme (2026-09-14) : un panier ajouté en visiteur (session anonyme) disparaissait après
// connexion — corrigé pour signInWithPassword directement dans LoginForm.tsx (lecture AVANT/
// réécriture APRÈS par le MÊME client, aucun état ne traverse la bascule d'identité). `signInWithOAuth`
// (GoogleButton.tsx) ne peut PAS faire pareil : le navigateur quitte réellement la page pour un
// domaine tiers (accounts.google.com) — aucun état React/JS ne survit à cette navigation complète
// (cf. son propre commentaire). `sessionStorage` SURVIT en revanche à une redirection pleine page
// (scopé par origine + onglet, jamais par navigation) : GoogleButton y dépose le panier anonyme
// juste avant de partir, cette clé le consomme au premier montage suivant, quelle que soit la page
// d'atterrissage (CartProvider vit dans le layout racine, donc sur CHAQUE page).
export const PENDING_CART_MERGE_KEY = "hifago_pending_cart_merge";

type CartContextValue = {
  lines: CartLine[];
  // Async depuis spec 31 (invariant 1/2) : le premier ajout crée une session anonyme Supabase
  // avant que la ligne rejoigne le panier. `{ ok: false }` si la session n'a pas pu être établie —
  // JAMAIS une ligne ajoutée sans identité derrière (create_order refuse tout appel sans
  // auth.uid(), spec 31 Tranche 1) — ou si l'insertion elle-même échoue.
  addLine: (input: AddToCartInput) => Promise<{ ok: boolean }>;
  // Spec 42 : les eventos non réservables notés dans Mi viaje, et leur ajout — même identité, même
  // déclencheur de session anonyme que `addLine`. Un doublon (déjà noté à cette date) est un succès.
  tripEvents: TripEvent[];
  addTripEvent: (input: EventoDeViaje) => Promise<{ ok: boolean }>;
  // Resynchronise `lines` et `tripEvents` depuis la base — après un retrait (CartSummary) ou une commande créée
  // (CheckoutForm, cart_items déjà vidée côté serveur par create_order à ce moment-là).
  refresh: () => Promise<void>;
};

const CartContext = createContext<CartContextValue | null>(null);

function toCartLine(row: {
  id: string;
  product_id: string;
  date: string;
  end_date: string | null;
  slot_start_time: string | null;
  qty: number;
}): CartLine {
  return {
    id: row.id,
    productId: row.product_id,
    date: row.date,
    endDate: row.end_date ?? undefined,
    slotStartTime: row.slot_start_time ?? undefined,
    qty: row.qty,
  };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [tripEvents, setTripEvents] = useState<TripEvent[]>([]);
  // Un seul client pour toute la durée de vie du provider (jamais un par appel) : chaque
  // createClient() ouvre son propre GoTrueClient (BroadcastChannel + listener), jamais fermé —
  // un par clic sur "Ajouter au panier" fuirait un client à chaque ajout.
  const supabase = useMemo(() => createClient(), []);

  // Volontairement séparée de `refresh` ci-dessous : `fetchLines` ne pose aucun état elle-même,
  // seulement `refresh` (exposée aux appelants externes) le fait. Un `useEffect` qui appellerait
  // directement une fonction posant l'état déclenche `react-hooks/set-state-in-effect` — cette
  // séparation est ce qui permet au montage de peupler `lines` sans jamais y référencer `refresh`.
  const fetchLines = useCallback(async (): Promise<CartLine[]> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return [];
    // RLS directe (cart_items_select, account_id = auth.uid()) : ne lit jamais que les lignes du
    // compte courant, sans filtre explicite à répéter ici.
    const { data } = await supabase
      .from("cart_items")
      .select("id, product_id, date, end_date, slot_start_time, qty")
      .order("created_at", { ascending: true });
    return (data ?? []).map(toCartLine);
  }, [supabase]);

  // Spec 42 : mêmes règles d'affichage que `getTripEvents` (Mi viaje) — à venir à Guatapé, produit
  // encore visible (`products!inner` : la RLS de products écarte un evento dépublié) — pour que la
  // pastille ne compte jamais une ligne que Mi viaje n'affiche pas.
  const fetchTripEvents = useCallback(async (): Promise<TripEvent[]> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return [];
    const { data } = await supabase
      .from("trip_events")
      .select("id, product_id, date, products!inner(id)")
      .gte("date", todayInBogota())
      .order("date", { ascending: true });
    return (data ?? []).map((row) => ({ id: row.id, productId: row.product_id, date: row.date }));
  }, [supabase]);

  const refresh = useCallback(async () => {
    const [nuevasLineas, nuevosEventos] = await Promise.all([fetchLines(), fetchTripEvents()]);
    setLines(nuevasLineas);
    setTripEvents(nuevosEventos);
  }, [fetchLines, fetchTripEvents]);

  useEffect(() => {
    fetchLines().then(setLines);
    fetchTripEvents().then(setTripEvents);
  }, [fetchLines, fetchTripEvents]);

  // Consomme un panier anonyme déposé par GoogleButton.tsx juste avant une redirection OAuth —
  // voir le commentaire de PENDING_CART_MERGE_KEY ci-dessus. Tourne à CHAQUE montage (donc sur
  // chaque page, `CartProvider` étant dans le layout racine) mais ne fait rien en l'absence de
  // clé : `getItem` répond `null` sur l'immense majorité des chargements.
  //
  // ⚠️ AUCUNE GARDE D'ANNULATION AU DÉMONTAGE (contrairement à un premier essai, 2026-09-14) — et
  // ce n'est pas un oubli, c'est ce qui CASSAIT la fusion en dev. `CartProvider` vit dans le layout
  // racine et ne démonte jamais réellement en pratique (comme `fetchLines`/`addLine`/`refresh`
  // ci-dessus, qui n'ont eux non plus aucune garde) — mais React StrictMode (actif par défaut en
  // dev sur l'App Router) MONTE/DÉMONTE/REMONTE ce composant une fois au premier rendu de chaque
  // page. Une garde `annule` posée au démontage passait donc à `true` avant même que
  // `getSession()` ait le temps de se résoudre, et la fusion entière retombait silencieusement dans
  // le premier `if` sans jamais écrire en base — reproduit en réel (retour Jérôme : le panier
  // restait sur l'ancienne identité anonyme après connexion Google, sans la moindre erreur visible).
  // La clé sessionStorage est de toute façon retirée AVANT tout `await` : un second passage de
  // StrictMode ne duplique jamais rien, la garde n'apportait donc rien qu'une panne silencieuse.
  useEffect(() => {
    async function consommer() {
      let brut: string | null = null;
      try {
        brut = sessionStorage.getItem(PENDING_CART_MERGE_KEY);
      } catch {
        return; // sessionStorage indisponible (navigation privée stricte) — jamais bloquant.
      }
      if (!brut) return;

      // Retirée IMMÉDIATEMENT, avant toute tentative de fusion : un échec plus bas ne doit jamais
      // la faire retenter au prochain chargement (elle dupliquerait les lignes déjà fusionnées).
      try {
        sessionStorage.removeItem(PENDING_CART_MERGE_KEY);
      } catch {
        /* best-effort */
      }

      // `events` (spec 42) : absent d'un dépôt antérieur à la spec — d'où le repli sur [].
      let payload: { fromAccountId: string; lines: CartLine[]; events?: EventoDeViaje[] } | null = null;
      try {
        payload = JSON.parse(brut);
      } catch {
        return;
      }
      const lineasPendientes = payload?.lines ?? [];
      const eventosPendientes = payload?.events ?? [];
      if (!payload || (lineasPendientes.length === 0 && eventosPendientes.length === 0)) return;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      // Ne fusionne QUE si l'identité a réellement changé (redirection OAuth réussie vers un AUTRE
      // compte) — sinon (échec silencieux avant même le départ vers Google, ou re-consommation
      // impossible de toute façon vu le removeItem ci-dessus) on ne duplique jamais une ligne déjà
      // en place sous la même identité anonyme.
      if (!session || session.user.id === payload.fromAccountId) return;

      if (lineasPendientes.length > 0) {
        await supabase.from("cart_items").insert(
          lineasPendientes.map((line) => ({
            account_id: session.user.id,
            product_id: line.productId,
            date: line.date,
            end_date: line.endDate ?? null,
            slot_start_time: line.slotStartTime ?? null,
            qty: line.qty,
          }))
        );
      }
      await copiarEventosDeViaje(supabase, session.user.id, eventosPendientes);
      setLines(await fetchLines());
      setTripEvents(await fetchTripEvents());
    }

    void consommer();
  }, [supabase, fetchLines, fetchTripEvents]);

  // L'identité derrière tout ajout (spec 31 inv. 1 et 2), partagée par `addLine` et
  // `addTripEvent` : la session déjà posée (connectée ou anonyme), sinon une session anonyme créée
  // ICI et nulle part ailleurs. `null` = échec fermé, rien n'est ajouté.
  const obtenerSesion = useCallback(async () => {
    // Invariant 2 (spec 31) : vérifier AVANT tout qu'aucune session n'existe déjà —
    // signInAnonymously() n'est PAS idempotent (POST /signup inconditionnel + remplacement de
    // la session locale). Appelé sans cette garde, il créerait une identité à CHAQUE ajout et
    // déconnecterait un client réellement connecté dès son premier clic sur « Ajouter au
    // panier ». getSession() lit la session déjà posée (connectée ou déjà anonyme) sans
    // aller-retour réseau dans le cas courant.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) return session;
    // Invariant 1 : c'est LE seul déclencheur du projet — jamais à la simple visite, jamais
    // sur un ?ref=. Échec fermé (cahier §0/CLAUDE.md §4.4) : si la session ne peut pas être
    // créée, rien n'entre dans Mi viaje.
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.session) return null;
    return data.session;
  }, [supabase]);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      addLine: async (input) => {
        const session = await obtenerSesion();
        if (!session) {
          return { ok: false };
        }

        // Attribution (spec 32) : best-effort, ne bloque jamais l'ajout — le cookie hifago_ref est
        // httpOnly (illisible ici), seul un Route Handler peut le lire et poser carts.attribution_code.
        void fetch("/api/cart/attribution", { method: "POST" }).catch(() => {});

        const { error: insertError } = await supabase.from("cart_items").insert({
          account_id: session.user.id,
          product_id: input.productId,
          date: input.date,
          end_date: input.endDate ?? null,
          slot_start_time: input.slotStartTime ?? null,
          qty: input.qty,
        });
        if (insertError) {
          return { ok: false };
        }
        await refresh();
        return { ok: true };
      },
      tripEvents,
      addTripEvent: async (input) => {
        const session = await obtenerSesion();
        if (!session) {
          return { ok: false };
        }
        // Même attribution best-effort qu'un ajout au panier : c'est le même voyage.
        void fetch("/api/cart/attribution", { method: "POST" }).catch(() => {});
        const { error: insertError } = await supabase.from("trip_events").insert({
          account_id: session.user.id,
          product_id: input.productId,
          date: input.date,
        });
        // 23505 : déjà noté à cette date (`trip_events_account_product_date_key`) — le client
        // obtient ce qu'il demandait, jamais un message d'échec.
        if (insertError && insertError.code !== "23505") {
          return { ok: false };
        }
        await refresh();
        return { ok: true };
      },
      refresh,
    }),
    [lines, tripEvents, supabase, refresh, obtenerSesion]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart doit être utilisé sous CartProvider");
  }
  return context;
}
