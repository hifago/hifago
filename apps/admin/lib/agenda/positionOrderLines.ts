// Spec 20 §0 (docs/specs/20-agenda-reservations-socio.md §2) — positionne chaque order_line dans
// l'agenda socio. Fonction pure, testable sans DB ni navigateur (cf. hifago/CLAUDE.md §6) : la page
// Server Component fait le fetch (order_lines + products embarqué + product_slot_availability
// ciblée), cette fonction fait uniquement le calcul de placement. Un événement = une order_line,
// jamais un agrégat — plusieurs réservations simultanées produisent simplement plusieurs événements
// avec le même start/end, à charge du composant calendrier de les juxtaposer (comportement standard
// de tout calendrier type Google Calendar). Champs (id/text/start/end/allDay) alignés sur
// `CalendarEvent` de @svar-ui/react-calendar (spec 20 §10 point 1) — status ajouté en extra (le
// type SVAR autorise des champs libres via son index signature).
//
// Trois formes, jamais d'heure fabriquée pour une ligne qui n'en a structurellement aucune (spec 20
// §0 invariants) :
//   - slot_start_time non nul → bloc horodaté réel (durée via product_slot_availability, seule
//     source de durée exploitable dans le modèle de données actuel).
//   - end_date non nul (hôtel/lodging) OU products.type='camp' (fin calculée via duration_days, pas
//     de colonne end_date pour ce type) → bandeau "toute la journée" multi-jours.
//   - sinon → chip "toute la journée" sur le seul jour.
//
// `end` en borne EXCLUSIVE pour tout événement allDay (constaté en lisant le bundle réel de
// @svar-ui/calendar-store, pas seulement ses types : MonthViewModel.mapToPrimitive calcule
// `new Date(chunk.end.getTime() - 1)` pour trouver la dernière cellule occupée — un `end` égal à
// `start` retombe donc sur la VEILLE, largeur nulle/négative, événement invisible). `end_date`
// (hôtel/lodging) est déjà exclusif tel quel dans notre modèle (jour de départ, jamais compté comme
// nuit occupée) — seuls le cas "un seul jour" et la branche camp doivent ajouter +1 jour à `end`.
//
// Construction des Date : jamais `new Date("YYYY-MM-DDTHH:MM:SS")` (interprété UTC par le moteur JS
// puis reprojeté dans le fuseau du navigateur visiteur) ni une concaténation ISO combinée — mêmes
// composants numériques passés un par un au constructeur local `new Date(year, month, day, ...)`,
// qui ne réinterprète jamais un fuseau (cf. commentaire d'origine de order_lines.slot_start_time,
// migration 20260818100000 : "time without time zone est la bonne primitive, un objet Date combiné
// serait interprété dans le fuseau du navigateur visiteur, pas celui de Bogota"). Cohérent avec
// apps/admin n'étant pas localisé (hifago/CLAUDE.md §2) : le socio consulte depuis son propre
// fuseau, présumé Bogota.
import { lineQtyLabel } from "@/lib/products/activityPricing";

export type OrderLineForAgenda = {
  id: string;
  productId: string;
  productName: string;
  productType: string;
  productDurationDays: number | null; // camp uniquement — null pour tout autre type
  holderName: string;
  qty: number;
  status: string;
  date: string; // "YYYY-MM-DD"
  endDate: string | null; // "YYYY-MM-DD", hôtel/lodging uniquement
  slotStartTime: string | null; // "HH:MM:SS", null pour toute ligne sans créneau
  // Spec 43 : instantané du mode de prix — une ligne à l'heure couvre qty créneaux d'une heure.
  pricingUnit?: string | null;
};

export type SlotDuration = {
  productId: string;
  slotDate: string; // "YYYY-MM-DD"
  slotStartTime: string; // "HH:MM:SS"
  slotDurationMinutes: number;
};

export type AgendaEvent = {
  id: string; // order_lines.id
  text: string;
  start: Date;
  end: Date;
  allDay: boolean;
  status: string;
};

const DEFAULT_SLOT_DURATION_MINUTES = 60;

function parseDateParts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function parseTimeParts(time: string): { hour: number; minute: number; second: number } {
  const [hour, minute, second] = time.split(":").map(Number);
  return { hour, minute, second: second ?? 0 };
}

function localDate(date: string, time?: string): Date {
  const { year, month, day } = parseDateParts(date);
  if (!time) {
    return new Date(year, month - 1, day);
  }
  const { hour, minute, second } = parseTimeParts(time);
  return new Date(year, month - 1, day, hour, minute, second);
}

function slotDurationKey(productId: string, date: string, slotStartTime: string): string {
  return `${productId}|${date}|${slotStartTime}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function positionOrderLines(
  lines: OrderLineForAgenda[],
  slotDurations: SlotDuration[]
): AgendaEvent[] {
  const durationByKey = new Map<string, number>();
  for (const slot of slotDurations) {
    durationByKey.set(
      slotDurationKey(slot.productId, slot.slotDate, slot.slotStartTime),
      slot.slotDurationMinutes
    );
  }

  return lines.map((line) => {
    const text = `${line.productName} - ${line.holderName} - ${lineQtyLabel(line.qty, line.pricingUnit)}`;

    if (line.slotStartTime) {
      const start = localDate(line.date, line.slotStartTime);
      // Une ligne à l'heure (spec 43) occupe qty créneaux consécutifs d'une heure : un seul bloc.
      const durationMinutes =
        line.pricingUnit === "per_hour"
          ? line.qty * 60
          : (durationByKey.get(slotDurationKey(line.productId, line.date, line.slotStartTime)) ??
            DEFAULT_SLOT_DURATION_MINUTES);
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      return { id: line.id, text, start, end, allDay: false, status: line.status };
    }

    if (line.endDate) {
      return {
        id: line.id,
        text,
        start: localDate(line.date),
        end: localDate(line.endDate),
        allDay: true,
        status: line.status,
      };
    }

    if (line.productType === "camp" && line.productDurationDays) {
      const start = localDate(line.date);
      return {
        id: line.id,
        text,
        start,
        end: addDays(start, line.productDurationDays), // exclusif : jour APRÈS le dernier jour du camp
        allDay: true,
        status: line.status,
      };
    }

    const day = localDate(line.date);
    return { id: line.id, text, start: day, end: addDays(day, 1), allDay: true, status: line.status };
  });
}
