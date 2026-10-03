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
  cn,
  dateTaggedDayButtonComponents,
} from "@hifago/ui";
import {
  CLASSE_CADRE_CALENDRIER,
  CLASSE_CALENDRIER,
  CLASSNAMES_CALENDRIER,
  localeCalendrier,
} from "@/components/molecules/Calendar";
import { startOfTodayInBogota } from "@hifago/domain";
import { useCart } from "@/lib/cart/CartContext";
import { useAddToCart } from "@/lib/cart/useAddToCart";
import { isoDeFecha, mesPorDefecto, ultimoDiaReservable } from "@/lib/reservas/calendario";
import { limitarCantidad, pisoCantidad, topeCantidad } from "@/lib/reservas/cantidad";
import {
  CLAVE_PLAZAS,
  agregarEnCarrito,
  estadoDisponibilidad,
  plazasRestantes,
} from "@/lib/reservas/disponibilidad";
import { usePrefillUltimosCriterios } from "@/lib/reservas/usePrefillUltimosCriterios";
import { Title } from "@/components/atoms/Title";

// Spec 18 §0 Tranche 1 : produit à créneaux horaires (product_slot_rules côté admin, ex. jetski —
// cf. hifago/docs/journal/2026-08.md entrée 2026-08-18, motivé par un produit réel bloqué faute de
// cet écran). Pendant de ReservationForm.tsx (capacité par date seule) mais capacité par
// (date, heure) : fichier neuf plutôt qu'un "mode" ajouté à ReservationForm, même pattern déjà
// établi par LodgingReservationForm.tsx/HotelReservationForm.tsx (une shape de réservation = un
// composant dédié).
type SlotRow = {
  slot_date: string;
  slot_start_time: string; // "HH:MM:SS" tel que renvoyé par get_product_slots (colonne Postgres time)
  capacity: number;
  booked: number;
  slot_duration_minutes: number;
};

// Normalise "HH:MM:SS" (ou déjà "HH:MM") → "HH:MM" — même convention que slotRules.ts côté admin
// (toTimeInputValue/slotRulesFromColumn) : le panier/create_order ne manipulent jamais les
// secondes, cf. CartLine.slotStartTime.
function toHHMM(time: string): string {
  return time.slice(0, 5);
}

function addMinutesToHHMM(time: string, minutes: number): string {
  const [h, m] = toHHMM(time).split(":").map(Number);
  const total = h * 60 + m + minutes;
  const endH = Math.floor(total / 60) % 24;
  const endM = total % 60;
  return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
}

// Fonction pure (comme resolveTierPrice dans Lodging/HotelReservationForm) plutôt qu'une closure
// interne au composant : évite tout piège de dépendances useMemo/useCallback, le seul état externe
// dont elle a besoin (inCartByKey) est passé explicitement. Ce qui lui reste en propre est la CLÉ
// composée ; le calcul lui-même vit dans lib/reservas (spec 30 §7a, duplication n°2).
function remainingForSlot(slot: SlotRow, inCartByKey: Map<string, number>): number {
  const key = `${slot.slot_date}|${toHHMM(slot.slot_start_time)}`;
  return plazasRestantes(slot, inCartByKey.get(key) ?? 0);
}

// « Plus une seule place de la journée entière ». Ce prédicat était écrit DEUX FOIS à l'identique
// dans ce fichier — une fois pour barrer la date, une fois pour la désactiver — et une troisième
// formulation du même « complet » vivait plus bas (`estadoDisponibilidad(…) === "completo"`).
//
// ⚠️ Les deux appelants doivent trancher PAREIL, sans quoi une date se retrouve barrée mais
// cliquable, ou cliquable mais barrée. Aucun test ne verrait cet écart : chacun des deux endroits
// est correct pris isolément. D'où une seule fonction, qui délègue à `estadoDisponibilidad` plutôt
// que de recomparer à zéro — « ce qu'il faut dire d'un nombre de places » n'a qu'une définition.
function diaCompleto(daySlots: SlotRow[] | undefined, inCartByKey: Map<string, number>): boolean {
  if (!daySlots) return false;
  return daySlots.every(
    (slot) => estadoDisponibilidad(remainingForSlot(slot, inCartByKey)) === "completo"
  );
}

export function SlotReservationForm({
  productId,
  slots,
  minQty = 1,
}: {
  productId: string;
  slots: SlotRow[];
  /** `products.min_qty`, replié à 1 — cf. `lib/reservas/cantidad.ts`. */
  minQty?: number;
}) {
  const t = useTranslations("ProductPage");
  // La langue de la page, pour la grille (plan 41, S10).
  const locale = useLocale();
  const { lines } = useCart();
  const addToCart = useAddToCart();
  // Borne HAUTE de l'horizon produit (six mois, décidé le 2026-08-28). Le `useMemo` reste ici et
  // n'est pas décoratif : react-day-picker doit recevoir la MÊME référence d'un rendu à l'autre.
  const dernierJourReservable = useMemo(() => ultimoDiaReservable(), []);

  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlotStartTime, setSelectedSlotStartTime] = useState<string | undefined>();
  const [qty, setQty] = useState(minQty);

  const byDate = useMemo(() => {
    const map = new Map<string, SlotRow[]>();
    for (const slot of slots) {
      const list = map.get(slot.slot_date);
      if (list) list.push(slot);
      else map.set(slot.slot_date, [slot]);
    }
    return map;
  }, [slots]);

  // Cupos déjà occupés par CE produit/CETTE date/CE créneau dans le panier en cours (pas encore en
  // base) — même raisonnement que ReservationForm.tsx (avertissement indicatif, jamais la vraie
  // barrière, qui reste create_order au moment du checkout). Clé composée (date + heure) plutôt que
  // date seule : deux créneaux différents la même date sont deux cupos indépendants.
  const inCartByKey = useMemo(
    () =>
      agregarEnCarrito(
        lines,
        (line) => line.productId === productId && Boolean(line.slotStartTime),
        (line) => `${line.date}|${line.slotStartTime}`
      ),
    [lines, productId]
  );

  const fullDates = useMemo(() => {
    const full: Date[] = [];
    for (const [date, daySlots] of byDate) {
      if (diaCompleto(daySlots, inCartByKey)) {
        full.push(parseISO(date));
      }
    }
    return full;
  }, [byDate, inCartByKey]);

  // Ouvre le calendrier sur le mois du premier créneau configuré plutôt que sur le mois courant —
  // même raisonnement que ReservationForm.tsx.
  // Même repli que ReservationForm.tsx : `undefined` renverrait react-day-picker sur le mois du
  // navigateur (cf. le commentaire détaillé là-bas).
  const defaultMonth = mesPorDefecto(slots[0]?.slot_date);

  const selectedIso = isoDeFecha(selectedDate);
  const daySlots = selectedIso ? (byDate.get(selectedIso) ?? []) : [];
  const selectedSlot = selectedSlotStartTime
    ? daySlots.find((slot) => toHHMM(slot.slot_start_time) === selectedSlotStartTime)
    : undefined;
  const slotRemaining = selectedSlot ? remainingForSlot(selectedSlot, inCartByKey) : 0;

  // UN SEUL prédicat « cette date est-elle refusée ? », passé tel quel au `disabled` du calendrier
  // ET appelé en tête de `handleSelectDate` — le pré-remplissage (spec 28 §4 point 3) appelle ce
  // handler HORS du calendrier. Écrire les conditions deux fois, à cinquante lignes d'écart, les
  // laissait diverger en silence : ce formulaire n'avait recopié qu'une des trois dans son handler.
  //
  // Bornes : minuit à GUATAPÉ, jamais l'heure du NAVIGATEUR (lot fuseau, 2026-08-28) — un visiteur
  // européen ouvrant la fiche le 1er du mois à 2 h du matin voyait le dernier jour du mois
  // précédent barré, alors qu'à Guatapé il était encore réservable. Borne HAUTE : au-delà de
  // l'horizon produit rien n'est vendable, sans elle ces dates paraissaient sélectionnables et
  // n'étaient refusées qu'après coup.
  function fechaNoSeleccionable(date: Date): boolean {
    const daySlotsForDate = byDate.get(format(date, "yyyy-MM-dd"));
    // ⚠️ Une date SANS créneau du tout est refusée, alors qu'elle n'est pas « complète » : rien n'y
    // est vendable, il n'y a simplement rien. `diaCompleto` répond `false` dans ce cas — c'est la
    // bonne réponse à SA question, et le distinguer ici plutôt que dans le prédicat.
    if (!daySlotsForDate) return true;
    return (
      date < startOfTodayInBogota() ||
      date > dernierJourReservable ||
      diaCompleto(daySlotsForDate, inCartByKey)
    );
  }

  function handleSelectDate(date: Date | undefined) {
    // Un clic réel ne peut jamais être refusé ici (déjà exclu par le même prédicat côté
    // `disabled`) : la garde ne sert qu'au pré-remplissage.
    if (date && fechaNoSeleccionable(date)) return;
    setSelectedDate(date);
    setSelectedSlotStartTime(undefined);
    setQty(minQty);
  }

  // Spec 28 §4 point 3 : la date filtrée dans la recherche, si elle porte des créneaux réels de CE
  // produit, est déjà posée en arrivant sur la fiche — même garde que le clic (ci-dessus).
  usePrefillUltimosCriterios(({ desde }) => {
    if (desde) handleSelectDate(parseISO(desde));
  });

  function handleSelectSlot(slot: SlotRow) {
    if (remainingForSlot(slot, inCartByKey) < 1) return;
    setSelectedSlotStartTime(toHHMM(slot.slot_start_time));
    setQty(minQty);
  }

  // Spec 28 Tranche 3 : sur succès, `useAddToCart` redirige déjà vers l'accueil — il n'y a plus
  // rien à faire ici avec la valeur de retour (ni toast, ni reset local : le composant est sur le
  // point de se démonter).
  async function handleAddToCart() {
    if (!selectedIso || !selectedSlot || slotRemaining < 1) return;
    await addToCart({
      productId,
      date: selectedIso,
      slotStartTime: toHHMM(selectedSlot.slot_start_time),
      qty,
    });
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
          selected={selectedDate}
          // Le jour « aujourd'hui » mis en avant par react-day-picker vient sinon de son propre
          // `dateLib.today()` = `new Date()` du runtime (DayPicker.js:167), donc du NAVIGATEUR.
          // Sans cette prop, le correctif de `disabled` ci-dessous et le surlignage se
          // contrediraient pour un visiteur hors Colombie : le 27 resterait cliquable mais le 28
          // serait peint comme « aujourd'hui ».
          today={startOfTodayInBogota()}
          onSelect={handleSelectDate}
          disabled={[fechaNoSeleccionable]}
          modifiers={{ full: fullDates }}
          modifiersClassNames={{ full: "line-through opacity-60" }}
          // data-date (ISO, indépendant de la locale) : cible stable pour les tests e2e, même
          // convention que ReservationForm.tsx. Référence module-scope (packages/ui), jamais
          // reconstruite ici à chaque rendu — cf. sa doc.
          components={dateTaggedDayButtonComponents}
        />
      </div>

      {selectedSlot ? (
        <p className="text-sm text-muted" aria-live="polite" data-testid="slot-summary">
          {t(CLAVE_PLAZAS[estadoDisponibilidad(slotRemaining)], { count: slotRemaining })}
        </p>
      ) : selectedIso ? (
        <p className="text-sm text-muted">{t("selectSlotTime")}</p>
      ) : (
        <p className="text-sm text-muted">{t("selectSlotDate")}</p>
      )}

      {selectedIso ? (
        <div className="flex flex-wrap gap-2">
          {daySlots.map((slot) => {
            const slotStart = toHHMM(slot.slot_start_time);
            const slotEnd = addMinutesToHHMM(slot.slot_start_time, slot.slot_duration_minutes);
            const slotRemainingCount = remainingForSlot(slot, inCartByKey);
            const isFull = estadoDisponibilidad(slotRemainingCount) === "completo";
            const isSelected = selectedSlotStartTime === slotStart;
            return (
              <button
                key={slotStart}
                type="button"
                data-testid={`slot-chip-${selectedIso}-${slotStart}`}
                onClick={() => handleSelectSlot(slot)}
                disabled={isFull}
                aria-pressed={isSelected}
                className={cn(
                  "flex flex-col rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  isFull
                    ? "cursor-not-allowed border-border opacity-50 line-through"
                    : isSelected
                      ? "border-accent bg-surface-secondary"
                      : "border-border hover:bg-surface-secondary"
                )}
              >
                <span className="font-medium">
                  {slotStart}–{slotEnd}
                </span>
                <span className="text-muted">
                  {t(CLAVE_PLAZAS[estadoDisponibilidad(slotRemainingCount)], {
                    count: slotRemainingCount,
                  })}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <TextField
        className="max-w-32"
        name="qty"
        value={String(qty)}
        isDisabled={!selectedSlot}
        onChange={(value) => setQty(limitarCantidad(Number(value), minQty, slotRemaining))}
      >
        <Label>{t("quantityLabel")}</Label>
        <Input
          id="qty"
          type="number"
          min={pisoCantidad(minQty, slotRemaining)}
          max={topeCantidad(slotRemaining)}
        />
      </TextField>
      {minQty > 1 ? (
        <p className="text-xs text-muted" data-testid="min-qty-hint">
          {t("minQtyHint", { count: minQty })}
        </p>
      ) : null}

      <Button
        size="lg"
        testId="add-to-cart-button"
        onPress={handleAddToCart}
        isDisabled={!selectedSlot || slotRemaining < 1}
      >
        {t("addToCart")}
      </Button>
    </div>
  );
}
