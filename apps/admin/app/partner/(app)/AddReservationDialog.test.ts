import { afterEach, describe, expect, it, vi } from "vitest";
import { describeFailure } from "./AddReservationDialog";

// Réservation manuelle : chaque refus métier de create_manual_order_line a son texte ; un refus
// inconnu ou une panne retombe sur le message générique, jamais le texte SQL.
afterEach(() => vi.restoreAllMocks());

describe("AddReservationDialog — describeFailure", () => {
  it.each([
    ["resource_unavailable", "El espacio compartido del establecimiento no está disponible en esa fecha."],
    ["invalid_occurrence_date", "Este evento no se realiza en esa fecha."],
    ["full", "No hay cupo disponible."],
  ])("motif %s : son texte", (reason, texte) => {
    expect(describeFailure(null, reason)).toBe(texte);
  });

  it("motif inconnu : le message générique", () => {
    expect(describeFailure(null, "motif_inconnu")).toBe("No se pudo crear la reserva.");
  });

  it("panne de la RPC : le message générique, jamais le texte SQL", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(describeFailure({ code: "P0001", message: "relation does not exist" }, undefined)).toBe(
      "No se pudo crear la reserva."
    );
  });
});
