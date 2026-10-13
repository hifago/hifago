import { describe, expect, it } from "vitest";
import {
  eventoOccurrenceError,
  toEventoOccurrenceColumns,
  type EventoOccurrenceFields,
} from "./eventoOccurrence";

function fields(overrides: Partial<EventoOccurrenceFields> = {}): EventoOccurrenceFields {
  return {
    occurrenceType: "once",
    occurrenceDate: "2026-10-15",
    recurrenceFrequencyDays: "",
    recurrenceEndKind: "none",
    recurrenceEndDate: "",
    recurrenceEndCount: "",
    startTime: "16:00",
    durationMinutes: "",
    ...overrides,
  };
}

describe("toEventoOccurrenceColumns", () => {
  it("evento ponctuel : date et heure, aucune colonne de récurrence", () => {
    expect(toEventoOccurrenceColumns(fields())).toEqual({
      occurrence_type: "once",
      occurrence_date: "2026-10-15",
      recurrence_frequency_days: null,
      recurrence_end_date: null,
      recurrence_end_count: null,
      start_time: "16:00",
      duration_minutes: null,
    });
  });

  it("une saisie vide vaut null, jamais une chaîne vide ni 0", () => {
    const columns = toEventoOccurrenceColumns(
      fields({ occurrenceType: "recurring", occurrenceDate: "", startTime: "", recurrenceEndKind: "count" }),
    );
    expect(columns.occurrence_date).toBeNull();
    expect(columns.start_time).toBeNull();
    expect(columns.recurrence_frequency_days).toBeNull();
    expect(columns.recurrence_end_count).toBeNull();
  });

  it("récurrent borné par un nombre : la date de fin reste null, et inversement", () => {
    const parNombre = toEventoOccurrenceColumns(
      fields({
        occurrenceType: "recurring",
        recurrenceFrequencyDays: "7",
        recurrenceEndKind: "count",
        recurrenceEndCount: "4",
        recurrenceEndDate: "2026-12-31",
      }),
    );
    expect(parNombre).toMatchObject({
      occurrence_type: "recurring",
      recurrence_frequency_days: 7,
      recurrence_end_count: 4,
      recurrence_end_date: null,
    });

    const parDate = toEventoOccurrenceColumns(
      fields({
        occurrenceType: "recurring",
        recurrenceFrequencyDays: "14",
        recurrenceEndKind: "date",
        recurrenceEndCount: "4",
        recurrenceEndDate: "2026-12-31",
        durationMinutes: "90",
      }),
    );
    expect(parDate).toMatchObject({
      recurrence_frequency_days: 14,
      recurrence_end_date: "2026-12-31",
      recurrence_end_count: null,
      duration_minutes: 90,
    });
  });

  it("un evento ponctuel n'emporte jamais une récurrence restée dans l'état du formulaire", () => {
    const columns = toEventoOccurrenceColumns(
      fields({ recurrenceFrequencyDays: "7", recurrenceEndKind: "count", recurrenceEndCount: "4" }),
    );
    expect(columns.recurrence_frequency_days).toBeNull();
    expect(columns.recurrence_end_count).toBeNull();
  });
});

describe("eventoOccurrenceError", () => {
  it("accepte un evento ponctuel daté et un récurrent avec sa fréquence", () => {
    expect(eventoOccurrenceError(fields())).toBeNull();
    expect(
      eventoOccurrenceError(fields({ occurrenceType: "recurring", recurrenceFrequencyDays: "7" })),
    ).toBeNull();
  });

  it("refuse un evento sans date, avec le message de son mode", () => {
    expect(eventoOccurrenceError(fields({ occurrenceDate: "" }))).toBe(
      "La fecha es obligatoria para un evento puntual.",
    );
    expect(eventoOccurrenceError(fields({ occurrenceType: "recurring", occurrenceDate: "" }))).toBe(
      "La fecha de la primera ocurrencia es obligatoria para un evento recurrente.",
    );
  });

  it("refuse un evento récurrent sans fréquence", () => {
    expect(eventoOccurrenceError(fields({ occurrenceType: "recurring" }))).toBe(
      "La frecuencia es obligatoria para un evento recurrente.",
    );
  });
});
