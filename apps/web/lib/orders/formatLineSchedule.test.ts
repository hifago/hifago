import { describe, expect, it } from "vitest";
import { formatLineSchedule } from "./formatLineSchedule";

// Extrait de `CartSummary`/`OrderResult` (spec 33) — ces trois formes de ligne sont les trois
// formes de réservation du catalogue : produit à date, hébergement par plage, produit à créneau.
describe("formatLineSchedule", () => {
  it("rend la date seule pour un produit à date", () => {
    expect(formatLineSchedule({ date: "2026-11-01" })).toBe("2026-11-01");
  });

  it("rend une plage quand la ligne porte une date de fin", () => {
    expect(formatLineSchedule({ date: "2026-11-01", endDate: "2026-11-03" })).toBe(
      "2026-11-01 → 2026-11-03"
    );
  });

  it("rend la date et l'heure pour un produit à créneau", () => {
    expect(formatLineSchedule({ date: "2026-11-01", slotStartTime: "09:00" })).toBe(
      "2026-11-01 · 09:00"
    );
  });

  it("préfère la plage au créneau si les deux sont présents — une plage ne porte pas d'heure", () => {
    expect(
      formatLineSchedule({ date: "2026-11-01", endDate: "2026-11-03", slotStartTime: "09:00" })
    ).toBe("2026-11-01 → 2026-11-03");
  });

  it("traite null comme absent (forme rendue par la base)", () => {
    expect(formatLineSchedule({ date: "2026-11-01", endDate: null, slotStartTime: null })).toBe(
      "2026-11-01"
    );
  });

  it("reconstitue la date de fin d'un camp depuis durationDays — endDate est toujours null pour lui", () => {
    expect(
      formatLineSchedule({ date: "2026-10-01", endDate: null, durationDays: 7 })
    ).toBe("2026-10-01 → 2026-10-07");
  });

  it("ne montre pas de plage pour un camp d'un seul jour (durationDays <= 1)", () => {
    expect(formatLineSchedule({ date: "2026-10-01", endDate: null, durationDays: 1 })).toBe(
      "2026-10-01"
    );
  });

  it("préfère endDate à durationDays si les deux sont présents (ne devrait pas arriver en pratique)", () => {
    expect(
      formatLineSchedule({ date: "2026-10-01", endDate: "2026-10-03", durationDays: 7 })
    ).toBe("2026-10-01 → 2026-10-03");
  });

  it("rend une date et un créneau lisibles dans la locale du tunnel", () => {
    expect(formatLineSchedule({ date: "2026-10-14", slotStartTime: "10:00" }, "es")).toBe(
      "mié, 14 oct · 10:00"
    );
  });

  it("ne répète pas le mois pour une plage lisible dans le même mois", () => {
    expect(formatLineSchedule({ date: "2026-10-14", endDate: "2026-10-16" }, "es")).toBe(
      "14 → 16 oct"
    );
  });
});
