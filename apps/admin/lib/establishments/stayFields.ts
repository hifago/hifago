// Séjour d'un établissement — check-in, check-out et « ¿Cómo se vende? » (spec 24 §4). Une seule
// définition pour le bloc admin à sauvegarde immédiate (EstablishmentStayBlock) et pour les deux
// formulaires de proposition du partenaire (migration 20261015004421).
// Pas de "use client" : lu par les pages (Server Components) comme par les formulaires.

export const STAY_MODE_LABELS: Record<string, string> = {
  rooms: "Habitaciones a elegir",
  whole_house: "Alojamiento completo",
};

export type StayValues = { checkIn: string; checkOut: string; mode: string };

/** "HH:MM:SS" (colonne time) → "HH:MM" (valeur attendue par <Input type="time">). */
export function toTimeInputValue(time: string | null | undefined): string {
  return time ? time.slice(0, 5) : "";
}

export function stayFromColumns(row: {
  check_in_time: string | null;
  check_out_time: string | null;
  mode: string | null;
}): StayValues {
  return {
    checkIn: toTimeInputValue(row.check_in_time),
    checkOut: toTimeInputValue(row.check_out_time),
    mode: row.mode ?? "",
  };
}

/** Les trois clés du payload, un champ vide valant `null` (l'effacer est une demande réelle). */
export function stayPayload(stay: StayValues): {
  check_in_time: string | null;
  check_out_time: string | null;
  mode: string | null;
} {
  return {
    check_in_time: stay.checkIn || null,
    check_out_time: stay.checkOut || null,
    mode: stay.mode || null,
  };
}

/**
 * Les trois clés n'entrent dans une proposition d'ÉDITION que si l'une d'elles a changé — et alors
 * toujours ensemble : update_establishment_stay_details les remplace d'un bloc, et la RPC de dépôt
 * refuse un séjour partiel (`stay_incomplete`).
 *
 * ⚠️ Ce n'est pas une optimisation. Une clé présente REMPLACE la valeur à l'approbation : l'envoyer
 * à chaque fois écraserait un horaire posé par un admin entre le dépôt et l'approbation.
 */
export function stayIfChanged(initial: StayValues, current: StayValues): Partial<ReturnType<typeof stayPayload>> {
  const inchange =
    initial.checkIn === current.checkIn && initial.checkOut === current.checkOut && initial.mode === current.mode;
  return inchange ? {} : stayPayload(current);
}

/** À la CRÉATION : les trois clés dès qu'un champ est rempli, rien sinon. */
export function stayIfFilled(stay: StayValues): Partial<ReturnType<typeof stayPayload>> {
  return stay.checkIn || stay.checkOut || stay.mode ? stayPayload(stay) : {};
}

/** Résumé lisible d'un séjour (colonnes ou payload), pour « Valor actual / Valor propuesto ». */
export function describeStay(row: {
  check_in_time?: string | null;
  check_out_time?: string | null;
  mode?: string | null;
}): string {
  const checkIn = toTimeInputValue(row.check_in_time) || "—";
  const checkOut = toTimeInputValue(row.check_out_time) || "—";
  const mode = row.mode ? (STAY_MODE_LABELS[row.mode] ?? row.mode) : "sin especificar";
  return `check-in ${checkIn} · check-out ${checkOut} · ${mode}`;
}
