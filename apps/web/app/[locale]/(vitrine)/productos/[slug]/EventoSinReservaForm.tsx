"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/atoms/Button";
import { DayPickerCalendar as Calendar, dateTaggedDayButtonComponents } from "@hifago/ui";
import {
  CLASSE_CADRE_CALENDRIER,
  CLASSE_CALENDRIER,
  CLASSNAMES_CALENDRIER,
  localeCalendrier,
} from "@/components/molecules/Calendar";
import { addDaysIso, startOfTodayInBogota } from "@hifago/domain";
import { useCart } from "@/lib/cart/CartContext";
import { useAddTripEvent } from "@/lib/cart/useAddToCart";
import { hrefAlojamientosParaEvento } from "@/lib/catalog/criterios";
import { leerUltimosCriterios } from "@/lib/catalog/ultimosCriterios";
import { mesPorDefecto, ultimoDiaReservable } from "@/lib/reservas/calendario";
import { usePrefillUltimosCriterios } from "@/lib/reservas/usePrefillUltimosCriterios";
import { Title } from "@/components/atoms/Title";

// Spec 42 — un evento NON réservable en ligne se note dans Mi viaje à une de ses dates, sans
// réservation : ni quantité, ni capacité, ni prix (rien n'est réservé, rien n'est payé). Le même
// calendrier que `EventoReservationForm` (mêmes bornes, même fuseau, même prédicat unique), réduit
// au choix de la date — Jérôme, 2026-10-19 : « le client choisit la date, étant donné que ça doit
// apparaître par ordre de date dans Mi viaje ».
export function EventoSinReservaForm({
  productId,
  fechas,
}: {
  productId: string;
  /** Ses occurrences à venir dans l'horizon, déjà calculées (`expand_event_occurrences`). */
  fechas: string[];
}) {
  const t = useTranslations("ProductPage");
  const locale = useLocale();
  const { tripEvents } = useCart();
  const addTripEvent = useAddTripEvent();
  const dernierJourReservable = useMemo(() => ultimoDiaReservable(), []);

  // Jamais pré-sélectionné : react-day-picker en `mode="single"` désélectionne au reclic (même
  // raison que les quatre autres formulaires).
  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined);
  const fechasConocidas = useMemo(() => new Set(fechas), [fechas]);

  // Les dates de CET evento déjà notées : marquées dans le calendrier, et le bouton le dit — un
  // second ajout serait accepté (doublon traité en succès) mais n'ajouterait rien.
  const yaAnotadas = useMemo(
    () => new Set(tripEvents.filter((evento) => evento.productId === productId).map((evento) => evento.date)),
    [tripEvents, productId]
  );
  const fechasAnotadas = useMemo(() => [...yaAnotadas].map((fecha) => parseISO(fecha)), [yaAnotadas]);
  const yaEnMiViaje = selectedDate !== undefined && yaAnotadas.has(selectedDate);

  // UN seul prédicat, au calendrier ET en tête du handler (le pré-remplissage l'appelle hors
  // calendrier) — bornes à Guatapé, jamais au navigateur.
  function fechaNoSeleccionable(date: Date): boolean {
    return (
      date < startOfTodayInBogota() ||
      date > dernierJourReservable ||
      !fechasConocidas.has(format(date, "yyyy-MM-dd"))
    );
  }

  function handleSelectDate(date: Date | undefined) {
    if (!date) {
      setSelectedDate(undefined);
      return;
    }
    if (fechaNoSeleccionable(date)) return;
    setSelectedDate(format(date, "yyyy-MM-dd"));
  }

  usePrefillUltimosCriterios(({ desde }) => {
    if (desde) handleSelectDate(parseISO(desde));
  });

  // Même retour que l'evento réservable (retour Gabriel, 2026-09-16) : la nuit de l'evento reste à
  // couvrir, `/alojamientos` s'ouvre sur elle. `addDaysIso`, jamais date-fns (piège fuseau).
  async function handleAdd() {
    if (!selectedDate || yaEnMiViaje) return;
    const hrefRetorno = hrefAlojamientosParaEvento({
      desde: selectedDate,
      hasta: addDaysIso(selectedDate, 1),
      personas: leerUltimosCriterios().personas,
    });
    await addTripEvent({ productId, date: selectedDate }, { hrefRetorno });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="evento-sin-reserva">
      <div className="flex flex-col gap-2">
        <Title as="h2" size="bloque">
          {t("eventoDatesTitle")}
        </Title>
        <Calendar
          className={`${CLASSE_CALENDRIER} ${CLASSE_CADRE_CALENDRIER}`}
          classNames={CLASSNAMES_CALENDRIER}
          locale={localeCalendrier(locale)}
          mode="single"
          defaultMonth={mesPorDefecto(fechas[0])}
          selected={selectedDate ? parseISO(selectedDate) : undefined}
          today={startOfTodayInBogota()}
          onSelect={handleSelectDate}
          disabled={[fechaNoSeleccionable]}
          modifiers={{ anotada: fechasAnotadas }}
          modifiersClassNames={{ anotada: "underline underline-offset-4" }}
          components={dateTaggedDayButtonComponents}
        />
      </div>

      <p className="text-sm text-muted" aria-live="polite" data-testid="evento-sin-reserva-nota">
        {!selectedDate ? t("eventoSelectDate") : yaEnMiViaje ? t("eventoAlreadyInTrip") : t("eventoNoBookingNeeded")}
      </p>

      <Button
        size="lg"
        width="full"
        testId="add-trip-event-button"
        onPress={handleAdd}
        isDisabled={!selectedDate || yaEnMiViaje}
      >
        {t("addToCart")}
      </Button>
    </div>
  );
}
