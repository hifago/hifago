import { isoDateToLocalMidnight } from "@hifago/domain";
import { ultimoDiaCampIso } from "@/lib/cart/campMissingLodging";

// La date (ou la plage, ou le créneau) d'une ligne, rendue de la même façon partout.
//
// Extrait le 2026-09-10 (spec 33) : les six mêmes lignes de ternaires vivaient à l'identique dans
// `CartSummary.tsx` et dans le nouvel écran de résultat. C'est de la PRÉSENTATION PURE — aucun
// prix, aucun statut — donc l'interdiction de fusionner les deux composants (prix vivant vs prix
// figé, spec 32 invariant 3) ne s'y applique pas : c'est justement ce qu'ils ont en commun.
//
// Même forme que `lib/products/formatOccurrenceLabel.ts` : une fonction pure, testable, qui ne
// connaît ni React ni Supabase.
//
// ⚠️ Rend les dates telles qu'elles viennent de la base (ISO `2026-11-01`), ce qui est le
// comportement actuel des deux écrans — extraire ne change rien à l'affichage, c'est voulu.
// `formatDateInBogota` de `@hifago/domain` existe et rend une date lisible (il sert déjà dans
// `cuenta/reservas/OrdersList.tsx`) : basculer dessus est une amélioration réelle, mais qui change
// le rendu de deux écrans et leurs e2e — un geste à part, pas un effet de bord d'une extraction.

export type LineSchedule = {
  date: string;
  endDate?: string | null;
  slotStartTime?: string | null;
  /** `products.duration_days` — non nul seulement pour un camp, qui ne porte jamais `endDate`
   * (contrainte `products_duration_days_required_for_camp`). Sert à reconstituer sa date de fin. */
  durationDays?: number | null;
};

/**
 * La date de fin à AFFICHER : `endDate` si la ligne en porte une (hébergement), sinon calculée
 * depuis `duration_days` pour un camp multi-jours (MÊME formule que `create_order`,
 * `ultimoDiaCampIso`), sinon absente. Exportée pour `computeTripRange` (`tripRange.ts`), qui a
 * besoin de la même résolution pour la plage globale, pas seulement pour le texte d'une ligne.
 */
export function resolveDisplayEndDate({ date, endDate, durationDays }: LineSchedule): string | null {
  if (endDate) return endDate;
  if (durationDays && durationDays > 1) return ultimoDiaCampIso(date, durationDays);
  return null;
}

/**
 * Date d'une ligne. Sans locale, conserve la forme ISO historique des écrans qui n'ont pas encore
 * migré vers la charte. Avec locale, rend la forme courte et lisible du tunnel (plan 41, P5/P6).
 */
export function formatLineSchedule(line: LineSchedule, locale?: string): string {
  const resolvedEndDate = resolveDisplayEndDate(line);
  if (!locale) {
    if (resolvedEndDate) return `${line.date} → ${resolvedEndDate}`;
    if (line.slotStartTime) return `${line.date} · ${line.slotStartTime}`;
    return line.date;
  }

  const date = (iso: string, weekday = false) =>
    new Intl.DateTimeFormat(locale, {
      ...(weekday ? { weekday: "short" as const } : {}),
      day: "numeric",
      month: "short",
    })
      .format(isoDateToLocalMidnight(iso))
      .replace(/\.$/, "");

  if (resolvedEndDate) {
    const start = isoDateToLocalMidnight(line.date);
    const end = isoDateToLocalMidnight(resolvedEndDate);
    const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
    const startLabel = sameMonth
      ? new Intl.DateTimeFormat(locale, { day: "numeric" }).format(start)
      : date(line.date);
    return `${startLabel} → ${date(resolvedEndDate)}`;
  }
  if (line.slotStartTime) return `${date(line.date, true)} · ${line.slotStartTime}`;
  return date(line.date, true);
}

/**
 * La même date, LISIBLE (plan 41, constat T13, défaut connu n° 7) : `jue, 15 oct`,
 * `15 oct → 17 oct`, `jue, 15 oct · 10:00` — `Thu, Oct 15`… en anglais.
 *
 * ⚠️ À CÔTÉ de `formatLineSchedule`, pas à sa place : P5 à P7 utilisent désormais la surcharge
 * localisée de la fonction historique, tandis que Mis reservas (P8) conserve cette variante qui
 * répète le mois sur une plage et tronque explicitement l'heure à `HH:MM`. Mêmes trois formes,
 * même priorité (une plage ne porte pas d'heure). Le jour de la semaine seulement sur une date
 * seule : sur une plage, deux jours de semaine alourdiraient la ligne pour rien.
 *
 * Sans année, comme le titre « Tu viaje del… » (`formatTripLabel`) : une réservation se lit dans
 * l'année, et le détail (`/reserva/<jeton>`) reste à un clic. L'heure garde `HH:MM` (la base rend
 * `10:00:00`). `isoDateToLocalMidnight` et jamais `new Date(iso)`, lu en UTC (voir `tripRange.ts`).
 */
export function formatLineScheduleLisible(line: LineSchedule, locale: string): string {
  const jour = (iso: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, options).format(isoDateToLocalMidnight(iso));
  const resolvedEndDate = resolveDisplayEndDate(line);
  if (resolvedEndDate) {
    const court: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
    return `${jour(line.date, court)} → ${jour(resolvedEndDate, court)}`;
  }
  const avecJour = jour(line.date, { weekday: "short", day: "numeric", month: "short" });
  if (line.slotStartTime) return `${avecJour} · ${line.slotStartTime.slice(0, 5)}`;
  return avecJour;
}
