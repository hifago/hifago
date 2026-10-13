// Les sept colonnes `products` qui disent QUAND un evento a lieu — une seule définition, pour les
// deux chemins d'écriture (création et édition). Même patron qu'`eventoBookable.ts`.
//
// ⚠️ POURQUOI CE FICHIER EXISTE (2026-10-13). Ces colonnes n'étaient écrites qu'à la création :
// `productEditPayload.ts` ne les émettait pas, aucune page d'édition ne les relisait, et
// `submit_product_proposal` / `moderate_product_proposal` ne les connaissaient pas. Un socio qui
// rouvrait son evento voyait donc « Fecha » et « Hora de inicio » VIDES, les ressaisissait, et la
// proposition arrivait à l'admin sans elles (constaté par Jérôme sur « Exposición Mirarte »).
// Migration 20261013212500 pour l'autre moitié du chemin.
//
// Entrée STRUCTURELLE étroite, jamais `ProductTypeFieldsState` en entier : ce module reste lisible
// depuis un Server Component, sans traîner le hook `"use client"` dans son graphe.

export type EventoOccurrenceFields = {
  occurrenceType: "once" | "recurring";
  occurrenceDate: string;
  recurrenceFrequencyDays: string;
  recurrenceEndKind: "date" | "count" | "none";
  recurrenceEndDate: string;
  recurrenceEndCount: string;
  startTime: string;
  durationMinutes: string;
};

export function toEventoOccurrenceColumns(fields: EventoOccurrenceFields): {
  occurrence_type: "once" | "recurring";
  occurrence_date: string | null;
  recurrence_frequency_days: number | null;
  recurrence_end_date: string | null;
  recurrence_end_count: number | null;
  start_time: string | null;
  duration_minutes: number | null;
} {
  const recurrente = fields.occurrenceType === "recurring";

  return {
    occurrence_type: fields.occurrenceType,
    // Ancre des deux modes : sans elle, un evento récurrent ne dit pas sur quel jour il tombe.
    // Une saisie vide vaut `null`, jamais "" — une colonne `date` refuse la chaîne vide.
    occurrence_date: fields.occurrenceDate || null,
    recurrence_frequency_days:
      recurrente && fields.recurrenceFrequencyDays.trim() ? Number(fields.recurrenceFrequencyDays) : null,
    recurrence_end_date:
      recurrente && fields.recurrenceEndKind === "date" ? fields.recurrenceEndDate || null : null,
    recurrence_end_count:
      recurrente && fields.recurrenceEndKind === "count" && fields.recurrenceEndCount.trim()
        ? Number(fields.recurrenceEndCount)
        : null,
    start_time: fields.startTime || null,
    duration_minutes: fields.durationMinutes ? Number(fields.durationMinutes) : null,
  };
}

// Message de validation, ou `null`. Partagé par les QUATRE écrans qui envoient ces colonnes
// (création/édition admin, proposition socio, modération) : un evento sans date disparaît des
// listes (`next_event_occurrence` renvoie null), il ne doit pouvoir partir d'aucun d'eux.
export function eventoOccurrenceError(fields: {
  occurrenceType: "once" | "recurring";
  occurrenceDate: string;
  recurrenceFrequencyDays: string;
}): string | null {
  if (!fields.occurrenceDate) {
    return fields.occurrenceType === "once"
      ? "La fecha es obligatoria para un evento puntual."
      : "La fecha de la primera ocurrencia es obligatoria para un evento recurrente.";
  }
  if (fields.occurrenceType === "recurring" && !fields.recurrenceFrequencyDays) {
    return "La frecuencia es obligatoria para un evento recurrente.";
  }
  return null;
}
