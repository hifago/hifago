"use client";

import { startTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@hifago/ui";
import { useRouter } from "@/i18n/navigation";
import { hrefRetornoCarrito } from "@/lib/catalog/criterios";
import { leerUltimosCriterios } from "@/lib/catalog/ultimosCriterios";
import { useCart, type AddToCartInput } from "./CartContext";
import type { EventoDeViaje } from "./copiarEventosDeViaje";

// 2026-09-10 (/simplify) : les trois formulaires de réservation dupliquaient le même bloc après
// addLine() — spec 31 (Tranche 1), ok:false ne signifie jamais "capacité refusée" (la barrière de
// capacité reste exclusivement create_order, appelée uniquement depuis /pago), seulement
// "l'identité n'a pas pu être établie" (ou, depuis spec 32, un échec d'écriture dans cart_items).
// CartContext établit cette identité ; ce hook centralise ce qu'on en dit à l'utilisateur, pour que
// chaque formulaire n'ait plus à connaître ni `toast` ni la clé de traduction — seulement
// construire sa ligne et réagir à ok/échec.
//
// Spec 28 Tranche 3 (2026-09-13) : sur succès, LE geste de retour se branche ICI, pas dans chaque
// formulaire — c'est justement pour ça qu'il a été extrait dans ce hook unique. Cahier §2b.5 :
// retour immédiat à l'accueil, critères conservés (mémorisés par `BuscadorInicio` dans
// `ultimosCriterios.ts`, la fiche produit ne les portant jamais elle-même — spec 28 §4), sections
// réordonnées selon le panier (`desdeCarrito=1`, lu par `page.tsx`). `startTransition` plutôt que
// `useTransition()` : rien ici n'affiche d'état `isPending`, il n'y a donc rien à exposer à
// l'appelant.
//
// 2026-09-15 : `hrefRetorno` optionnel — un camp redirige vers `/alojamientos` (dates/personas déjà
// en filtre) plutôt que l'accueil, `ReservationForm.tsx` le calcule et le passe ici. Repli sur le
// comportement existant (`hrefRetornoCarrito`) quand absent : `LodgingReservationForm.tsx`/
// `SlotReservationForm.tsx` continuent d'appeler ce hook sans 2ᵉ argument, inchangés.
export function useAddToCart() {
  const { addLine } = useCart();
  const trasAgregar = useTrasAgregar();
  return async (line: AddToCartInput, opciones?: { hrefRetorno?: string }) =>
    trasAgregar(await addLine(line), opciones);
}

// Spec 42 : un evento non réservable noté dans Mi viaje — même toast, même retour que tout ajout,
// pour que le client ne voie aucune différence de geste entre un evento réservé et un evento noté.
export function useAddTripEvent() {
  const { addTripEvent } = useCart();
  const trasAgregar = useTrasAgregar();
  return async (evento: EventoDeViaje, opciones?: { hrefRetorno?: string }) =>
    trasAgregar(await addTripEvent(evento), opciones);
}

function useTrasAgregar() {
  const t = useTranslations("ProductPage");
  const router = useRouter();

  return (result: { ok: boolean }, opciones?: { hrefRetorno?: string }) => {
    if (!result.ok) {
      toast.danger(t("addToCartError"));
      return false;
    }
    toast.success(t("addedToCart"));
    const criterios = leerUltimosCriterios();
    startTransition(() => {
      router.push(opciones?.hrefRetorno ?? hrefRetornoCarrito(criterios));
    });
    return true;
  };
}
