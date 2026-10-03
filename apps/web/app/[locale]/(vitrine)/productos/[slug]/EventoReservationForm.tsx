"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/atoms/Button";
import {
  DayPickerCalendar as Calendar,
  Input,
  Label,
  TextField,
  dateTaggedDayButtonComponents,
} from "@hifago/ui";
import {
  CLASSE_CADRE_CALENDRIER,
  CLASSE_CALENDRIER,
  CLASSNAMES_CALENDRIER,
  localeCalendrier,
} from "@/components/molecules/Calendar";
import { addDaysIso, startOfTodayInBogota } from "@hifago/domain";
import { useCart } from "@/lib/cart/CartContext";
import { useAddToCart } from "@/lib/cart/useAddToCart";
import { hrefAlojamientosParaEvento } from "@/lib/catalog/criterios";
import { mesPorDefecto, ultimoDiaReservable } from "@/lib/reservas/calendario";
import { limitarCantidad, pisoCantidad, topeCantidad } from "@/lib/reservas/cantidad";
import {
  CLAVE_PLAZAS,
  agregarEnCarrito,
  estadoDisponibilidad,
  plazasRestantes,
} from "@/lib/reservas/disponibilidad";
import { usePrefillUltimosCriterios } from "@/lib/reservas/usePrefillUltimosCriterios";
import { Title } from "@/components/atoms/Title";

// Evento réservable en ligne (2026-09-15) — colocalisé comme SlotReservationForm/
// LodgingReservationForm (un seul consommateur, FichaProducto.tsx), jamais dans components/.
//
// ⚠️ Calendrier react-day-picker, MÊME composant que ReservationForm.tsx (retour Gabriel,
// 2026-09-15) : un premier essai affichait une liste de cartes plutôt qu'un calendrier, au motif
// qu'un evento a peu de dates connues à l'avance — mais `ReservationForm.tsx` (camp) prouve déjà
// que ce même calendrier gère très bien des dates rares (départs à des mois d'écart, `disabled`
// exclut tout le reste) : aucune raison de diverger, même widget partout. La "liste d'éditions" de
// `ReservationForm.tsx` est un ajout SOUS le calendrier, réservé au camp — jamais un remplacement.
//
// Trois modes de capacité, jamais mélangés dans le même rendu :
//  - 'unlimited' : aucun badge, jamais de jour barré — rien à protéger, par construction.
//  - 'metered'   : badge places restantes + jour barré dans le calendrier si complet, EXACTEMENT le
//    même calcul que les trois autres formulaires (plazasRestantes/estadoDisponibilidad).
//  - 'rsvp'      : badge « X/Y inscritos » (compteur décidé explicitement par Jérôme, jamais
//    silencieux), JAMAIS de jour barré même au-delà de Y — un aforo informatif, pas un plafond.

type EventoOccurrence = {
  date: string;
  capacity: number | null;
  booked: number | null;
  registeredQty: number | null;
};

export function EventoReservationForm({
  productId,
  minQty = 1,
  maxQty,
  capacityMode,
  occurrences,
}: {
  productId: string;
  /** `products.min_qty`, replié à 1 — même convention que `ReservationForm`. */
  minQty?: number;
  /**
   * `products.max_qty`, déjà replié à 20 par la couche catalogue — le plafond que `create_order`
   * applique réellement (`qty_cap_exceeded`), et le seul que le champ quantité doive afficher.
   *
   * ⚠️ Il sert AUSSI de valeur « pas de contrainte » aux modes unlimited/rsvp, qui n'ont aucune
   * capacité à décompter : un champ quantité a besoin d'UN maximum pour exister. Une constante
   * locale inventée ici (99, première version) prétendait un plafond que la base ne connaît pas et
   * contredisait en silence le 20 appliqué partout ailleurs.
   */
  maxQty: number;
  capacityMode: "unlimited" | "metered" | "rsvp";
  occurrences: EventoOccurrence[];
}) {
  const t = useTranslations("ProductPage");
  // La langue de la page, pour la grille (plan 41, S10).
  const locale = useLocale();
  const { lines } = useCart();
  const addToCart = useAddToCart();
  // Même borne haute que les trois autres formulaires (six mois, décidé le 2026-08-28) — purement
  // défensive ici : `occurrences` est déjà bornée par cette même fenêtre côté requête
  // (`get_event_occurrence_availability`, `producto.ts`), le prédicat `disabled` ci-dessous exclut
  // de toute façon tout jour hors de l'ensemble connu.
  const dernierJourReservable = useMemo(() => ultimoDiaReservable(), []);

  // ⚠️ Jamais pré-sélectionné (contrairement à l'ancienne liste de cartes) : react-day-picker en
  // `mode="single"` DÉSÉLECTIONNE un jour déjà sélectionné au reclic — une date choisie d'office
  // ferait donc que le premier clic visible du visiteur sur ce jour l'efface au lieu de le confirmer.
  // Même comportement "vide au départ" que `ReservationForm.tsx`.
  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined);
  const [qty, setQty] = useState(minQty);

  const byDate = useMemo(() => new Map(occurrences.map((row) => [row.date, row])), [occurrences]);

  // Cupos déjà occupés par CE produit/CETTE date dans le panier en cours (pas encore en base) —
  // même garde-fou que les trois autres formulaires, mode 'metered' seulement (les deux autres
  // n'ont rien à protéger).
  const inCartByDate = useMemo(
    () => agregarEnCarrito(lines, (line) => line.productId === productId, (line) => line.date),
    [lines, productId]
  );

  function remainingFor(row: EventoOccurrence | undefined): number {
    if (capacityMode !== "metered" || !row || row.capacity == null) return maxQty;
    return plazasRestantes(
      { capacity: row.capacity, booked: row.booked ?? 0 },
      inCartByDate.get(row.date) ?? 0
    );
  }

  const fullDates = useMemo(() => {
    if (capacityMode !== "metered") return [];
    const full: Date[] = [];
    for (const row of occurrences) {
      if (estadoDisponibilidad(remainingFor(row)) === "completo") full.push(parseISO(row.date));
    }
    return full;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remainingFor referme sur inCartByDate, déjà dans les deps
  }, [occurrences, capacityMode, inCartByDate]);

  const selectedRow = selectedDate ? byDate.get(selectedDate) : undefined;
  const remaining = remainingFor(selectedRow);
  // Pas de test sur `capacityMode` : `remainingFor` rend déjà `maxQty` (> 0) hors mode 'metered',
  // donc « completo » y est inatteignable par construction. Le garder faisait croire à deux règles
  // là où il n'y en a qu'une.
  const isFull = Boolean(selectedRow) && estadoDisponibilidad(remaining) === "completo";

  // Même repli que les trois autres formulaires : ouvrir sur le mois de la première occurrence,
  // jamais `undefined` (react-day-picker retomberait sur le mois du NAVIGATEUR).
  const defaultMonth = mesPorDefecto(occurrences[0]?.date);

  // UN SEUL prédicat « cette date est-elle refusée ? », passé tel quel au `disabled` du calendrier
  // ET appelé en tête de `handleSelectDate` — le pré-remplissage (spec 28 §4 point 3) appelle ce
  // handler HORS du calendrier. Écrire les conditions deux fois, à cinquante lignes d'écart, les
  // laissait diverger en silence : ce formulaire n'en portait aucune dans son handler.
  //
  // Bornes : minuit à GUATAPÉ, jamais l'heure du NAVIGATEUR (lot fuseau, 2026-08-28) — un visiteur
  // européen ouvrant la fiche le 1er du mois à 2 h du matin voyait le dernier jour du mois
  // précédent barré, alors qu'à Guatapé il était encore réservable. Borne HAUTE : au-delà de
  // l'horizon produit rien n'est vendable, sans elle ces dates paraissaient sélectionnables et
  // n'étaient refusées qu'après coup.
  function fechaNoSeleccionable(date: Date): boolean {
    return (
      date < startOfTodayInBogota() ||
      date > dernierJourReservable ||
      !byDate.has(format(date, "yyyy-MM-dd"))
    );
  }

  function handleSelectDate(date: Date | undefined) {
    if (!date) {
      setSelectedDate(undefined);
      setQty(minQty);
      return;
    }
    if (fechaNoSeleccionable(date)) return;
    setSelectedDate(format(date, "yyyy-MM-dd"));
    setQty(minQty);
  }

  // Spec 28 §4 point 3 : la date filtrée dans la recherche, si elle correspond à une occurrence
  // réelle de CE produit, est déjà posée en arrivant sur la fiche — `handleSelectDate` porte déjà
  // la garde, aucune condition à recopier ici.
  usePrefillUltimosCriterios(({ desde }) => {
    if (desde) handleSelectDate(parseISO(desde));
  });

  // Retour Gabriel (2026-09-16) : contrairement au camp (`durationDays > 1` seulement), TOUT evento
  // redirige vers /alojamientos après l'ajout — un evento n'a pas de notion de durée, la nuit à
  // couvrir est systématiquement celle de l'occurrence choisie (`desde` = date, `hasta` = date + 1
  // jour via `addDaysIso`, jamais `date-fns` — piège fuseau déjà connu de ce fichier).
  async function handleAddToCart() {
    if (!selectedDate || isFull) return;
    const hrefRetorno = hrefAlojamientosParaEvento({
      desde: selectedDate,
      hasta: addDaysIso(selectedDate, 1),
      personas: qty,
    });
    await addToCart({ productId, date: selectedDate, qty }, { hrefRetorno });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Title as="h2" size="bloque">
          {t("availabilityTitle")}
        </Title>
        {/* Plan 41, S10 : la grille de la charte (cases à la largeur du panneau, mois en Anton,
            jour choisi or et marine), dans son cadre, et dans la langue de la page — libellés
            d'accessibilité compris. Purement visuel : prédicats et modificateurs inchangés. */}
        <Calendar
          className={`${CLASSE_CALENDRIER} ${CLASSE_CADRE_CALENDRIER}`}
          classNames={CLASSNAMES_CALENDRIER}
          locale={localeCalendrier(locale)}
          mode="single"
          defaultMonth={defaultMonth}
          selected={selectedDate ? parseISO(selectedDate) : undefined}
          // Même piège fuseau que les trois autres formulaires (lot du 2026-08-28) : le jour
          // "aujourd'hui" et la borne basse doivent venir de GUATAPÉ, jamais du navigateur.
          today={startOfTodayInBogota()}
          onSelect={handleSelectDate}
          disabled={[fechaNoSeleccionable]}
          modifiers={{ full: fullDates }}
          modifiersClassNames={{ full: "line-through opacity-60" }}
          // data-date (ISO) : cible stable pour les tests, indépendante de la locale d'affichage.
          components={dateTaggedDayButtonComponents}
        />
      </div>

      {capacityMode === "metered" && selectedRow ? (
        <p className="text-sm text-muted" aria-live="polite">
          {t(CLAVE_PLAZAS[estadoDisponibilidad(remaining)], { count: remaining })}
        </p>
      ) : capacityMode === "rsvp" && selectedRow?.capacity != null ? (
        <p className="text-sm text-muted" aria-live="polite" data-testid="evento-rsvp-count">
          {t("rsvpCount", { registered: selectedRow.registeredQty ?? 0, max: selectedRow.capacity })}
        </p>
      ) : !selectedRow ? (
        <p className="text-sm text-muted">{t("selectDate")}</p>
      ) : null}

      <TextField
        className="max-w-32"
        name="qty"
        value={String(qty)}
        isDisabled={!selectedDate}
        onChange={(value) => setQty(limitarCantidad(Number(value), minQty, remaining))}
      >
        <Label>{t("quantityLabel")}</Label>
        <Input id="qty" type="number" min={pisoCantidad(minQty, remaining)} max={topeCantidad(remaining)} />
      </TextField>
      {minQty > 1 ? (
        <p className="text-xs text-muted" data-testid="min-qty-hint">
          {t("minQtyHint", { count: minQty })}
        </p>
      ) : null}

      <Button size="lg" testId="add-to-cart-button" onPress={handleAddToCart} isDisabled={!selectedDate || isFull}>
        {t("addToCart")}
      </Button>
    </div>
  );
}
