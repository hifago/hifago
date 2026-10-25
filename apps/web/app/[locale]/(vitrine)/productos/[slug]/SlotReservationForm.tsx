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
import { startOfTodayInBogota, startTimeHasPassed, type PricingUnit } from "@hifago/domain";
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
import { finDePlage, heuresLibresDepuis, ocupacionCarritoPorHora } from "@/lib/reservas/horas";
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

// Spec 43 — à l'heure, un jour est « plein » quand aucune heure de début n'offre le minimum d'heures
// consécutives libres (une heure libre isolée ne suffit pas à une réservation de 2 h minimum).
function diaSinPlaga(daySlots: SlotRow[], libres: Map<string, number> | undefined, minHoras: number): boolean {
  return !daySlots.some((slot) => (libres?.get(toHHMM(slot.slot_start_time)) ?? 0) >= minHoras);
}

export function SlotReservationForm({
  productId,
  slots,
  minQty = 1,
  maxQty,
  modoPrecio = null,
}: {
  productId: string;
  slots: SlotRow[];
  /** `products.min_qty`, replié à 1 — cf. `lib/reservas/cantidad.ts`. */
  minQty?: number;
  /**
   * Le plafond par réservation calculé par la couche catalogue (`public.product_qty_cap` de
   * `create_order`). `null` pour une activité (migration 20261025120000) : seule la place restante
   * du créneau borne le champ — un client peut prendre tout le créneau d'un coup.
   */
  maxQty: number | null;
  /**
   * Spec 43 — `per_hour` : la quantité compte des HEURES consécutives à partir du créneau choisi
   * (créneaux d'une heure, 1 place prise sur chacun) ; `per_activity` : l'activité entière, quantité 1.
   */
  modoPrecio?: PricingUnit | null;
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
  const porHora = modoPrecio === "per_hour";
  const ventaEntera = modoPrecio === "per_activity";
  const qtyInicial = ventaEntera ? 1 : minQty;
  // À l'heure : une plage doit offrir au moins ce nombre d'heures consécutives.
  const minHoras = Math.max(1, minQty);
  const [qty, setQty] = useState(qtyInicial);

  // Le jour même, un créneau déjà commencé à Guatapé n'est plus proposé (demande du 2026-10-24 : à
  // 17 h 10, le yoga de 10 h 30 du jour ne se réserve plus) — retiré ici, à la source, pour que
  // la date elle-même soit barrée quand plus aucun créneau du jour ne reste. create_order refuse de
  // toute façon (`start_time_passed`, migration 20261024130000) un créneau passé entre-temps.
  // Filtré dans le navigateur et pas dans `producto.ts` : la fiche serveur peut être servie depuis
  // un cache, l'heure doit être celle de l'ouverture de la page.
  const byDate = useMemo(() => {
    const map = new Map<string, SlotRow[]>();
    for (const slot of slots) {
      if (startTimeHasPassed(slot.slot_date, slot.slot_start_time)) continue;
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
  // Spec 43 : une ligne à l'heure de 3 h occupe 1 place sur chacune de ses 3 heures.
  const inCartByKey = useMemo(
    () =>
      porHora
        ? ocupacionCarritoPorHora(lines, productId)
        : agregarEnCarrito(
            lines,
            (line) => line.productId === productId && Boolean(line.slotStartTime),
            (line) => `${line.date}|${line.slotStartTime}`
          ),
    [lines, productId, porHora]
  );

  // Spec 43 — à l'heure : pour chaque date, les heures consécutives libres depuis chaque début.
  const heuresLibresParDate = useMemo(() => {
    const out = new Map<string, Map<string, number>>();
    if (!porHora) return out;
    for (const [date, daySlots] of byDate) {
      out.set(
        date,
        heuresLibresDepuis(
          daySlots.map((slot) => ({
            debut: slot.slot_start_time,
            dureeMinutes: slot.slot_duration_minutes,
            restantes: remainingForSlot(slot, inCartByKey),
          }))
        )
      );
    }
    return out;
  }, [porHora, byDate, inCartByKey]);

  const fullDates = useMemo(() => {
    const full: Date[] = [];
    for (const [date, daySlots] of byDate) {
      if (
        porHora
          ? diaSinPlaga(daySlots, heuresLibresParDate.get(date), minHoras)
          : diaCompleto(daySlots, inCartByKey)
      ) {
        full.push(parseISO(date));
      }
    }
    return full;
  }, [byDate, inCartByKey, porHora, heuresLibresParDate, minHoras]);

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
  // Borne haute du champ : la place restante du créneau, jamais au-delà du plafond par ligne quand
  // le produit en a un (aucun pour une activité).
  // Spec 43 — à l'heure : les heures consécutives libres depuis le début choisi bornent le champ.
  const horasLibres =
    porHora && selectedIso && selectedSlot
      ? (heuresLibresParDate.get(selectedIso)?.get(toHHMM(selectedSlot.slot_start_time)) ?? 0)
      : 0;
  const disponible = porHora ? horasLibres >= minHoras : slotRemaining >= 1;
  const capacidad = porHora ? horasLibres : slotRemaining;
  const qtyTope = maxQty === null ? capacidad : Math.min(capacidad, maxQty);

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
      (porHora
        ? diaSinPlaga(daySlotsForDate, heuresLibresParDate.get(format(date, "yyyy-MM-dd")), minHoras)
        : diaCompleto(daySlotsForDate, inCartByKey))
    );
  }

  function handleSelectDate(date: Date | undefined) {
    // Un clic réel ne peut jamais être refusé ici (déjà exclu par le même prédicat côté
    // `disabled`) : la garde ne sert qu'au pré-remplissage.
    if (date && fechaNoSeleccionable(date)) return;
    setSelectedDate(date);
    setSelectedSlotStartTime(undefined);
    setQty(qtyInicial);
  }

  // Spec 28 §4 point 3 : la date filtrée dans la recherche, si elle porte des créneaux réels de CE
  // produit, est déjà posée en arrivant sur la fiche — même garde que le clic (ci-dessus).
  usePrefillUltimosCriterios(({ desde }) => {
    if (desde) handleSelectDate(parseISO(desde));
  });

  // À l'heure (spec 43), un début n'est choisissable que s'il offre le minimum d'heures libres.
  function horasDesde(slot: SlotRow): number {
    return heuresLibresParDate.get(slot.slot_date)?.get(toHHMM(slot.slot_start_time)) ?? 0;
  }

  function handleSelectSlot(slot: SlotRow) {
    if (porHora ? horasDesde(slot) < minHoras : remainingForSlot(slot, inCartByKey) < 1) return;
    setSelectedSlotStartTime(toHHMM(slot.slot_start_time));
    setQty(qtyInicial);
  }

  // Spec 28 Tranche 3 : sur succès, `useAddToCart` redirige déjà vers l'accueil — il n'y a plus
  // rien à faire ici avec la valeur de retour (ni toast, ni reset local : le composant est sur le
  // point de se démonter).
  async function handleAddToCart() {
    if (!selectedIso || !selectedSlot || !disponible) return;
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
        {/* Retour Jérôme (2026-10-19) : un bouton pour repartir d'une grille vide, sous chacun des
            quatre calendriers de réservation. Passe par l'unique point d'écriture de la date. */}
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            color="neutral"
            testId="calendar-clear"
            isDisabled={!selectedDate}
            onPress={() => handleSelectDate(undefined)}
          >
            {t("clearCalendar")}
          </Button>
        </div>
      </div>

      {selectedSlot ? (
        <p className="text-sm text-muted" aria-live="polite" data-testid="slot-summary">
          {porHora
            ? t("hourRangeSummary", {
                desde: toHHMM(selectedSlot.slot_start_time),
                hasta: finDePlage(selectedSlot.slot_start_time, qty),
                count: qty,
              })
            : t(CLAVE_PLAZAS[estadoDisponibilidad(slotRemaining)], { count: slotRemaining })}
        </p>
      ) : selectedIso ? (
        <p className="text-sm text-muted">{t(porHora ? "selectStartTime" : "selectSlotTime")}</p>
      ) : (
        <p className="text-sm text-muted">{t("selectSlotDate")}</p>
      )}

      {selectedIso ? (
        <div className="flex flex-wrap gap-2">
          {daySlots.map((slot) => {
            const slotStart = toHHMM(slot.slot_start_time);
            const slotEnd = addMinutesToHHMM(slot.slot_start_time, slot.slot_duration_minutes);
            const slotRemainingCount = remainingForSlot(slot, inCartByKey);
            // À l'heure (spec 43) : la puce est une heure de DÉBUT, pleine si elle n'offre pas le
            // minimum d'heures consécutives libres.
            const isFull = porHora
              ? horasDesde(slot) < minHoras
              : estadoDisponibilidad(slotRemainingCount) === "completo";
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
                <span className="font-medium">{porHora ? slotStart : `${slotStart}–${slotEnd}`}</span>
                <span className="text-muted">
                  {porHora
                    ? isFull
                      ? t("full")
                      : t("hourSlotFree")
                    : t(CLAVE_PLAZAS[estadoDisponibilidad(slotRemainingCount)], {
                        count: slotRemainingCount,
                      })}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {ventaEntera ? null : (
        <TextField
          className="max-w-32"
          name="qty"
          value={String(qty)}
          isDisabled={!selectedSlot}
          onChange={(value) => setQty(limitarCantidad(Number(value), minQty, qtyTope))}
        >
          <Label>{t(porHora ? "hoursLabel" : "quantityLabel")}</Label>
          <Input
            id="qty"
            type="number"
            min={pisoCantidad(minQty, qtyTope)}
            max={topeCantidad(qtyTope)}
          />
        </TextField>
      )}
      {!ventaEntera && minQty > 1 ? (
        <p className="text-xs text-muted" data-testid="min-qty-hint">
          {porHora ? t("minHoursHint", { count: minQty }) : t("minQtyHint", { count: minQty })}
        </p>
      ) : null}

      <Button
        size="lg"
        width="full"
        testId="add-to-cart-button"
        onPress={handleAddToCart}
        isDisabled={!selectedSlot || !disponible}
      >
        {t("addToCart")}
      </Button>
    </div>
  );
}
