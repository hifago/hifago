import { describe, expect, it } from "vitest";
import { eventoChangeRefusal } from "./eventoChangeRefusal";

describe("eventoChangeRefusal", () => {
  it("HF002 : le détail rédigé par la base, tel quel", () => {
    expect(
      eventoChangeRefusal({
        code: "HF002",
        message: "occurrence_change_orphans_reservations",
        details: "2 reservas en curso quedarían fuera de las nuevas fechas: 12/11/2026, 19/11/2026",
      })
    ).toBe(
      "No se puede guardar el cambio de fecha — 2 reservas en curso quedarían fuera de las nuevas fechas: 12/11/2026, 19/11/2026."
    );
  });

  it("HF002 sans détail : une phrase complète quand même", () => {
    expect(eventoChangeRefusal({ code: "HF002", message: "occurrence_change_orphans_reservations" })).toBe(
      "No se puede guardar el cambio de fecha: algunas reservas en curso quedarían fuera de las nuevas fechas."
    );
  });

  it("drapeaux de capacité gelés : la date n'y figure plus", () => {
    const text = eventoChangeRefusal({ code: "P0001", message: "capacity_flags_frozen_while_reserved" });
    expect(text).toContain("modo de cupo");
    expect(text).not.toContain("fecha");
  });

  it.each([null, undefined, { code: "23514", message: "new row violates check constraint" }])(
    "%s : aucun de ces refus",
    (error) => {
      expect(eventoChangeRefusal(error)).toBeNull();
    }
  );
});
