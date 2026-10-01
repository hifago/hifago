// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadSlotOptions } from "./slotOptions";

// Le sélecteur d'horaire de la réservation manuelle (agenda socio). Sur une panne, il restait VIDE
// sans un mot — l'opérateur croyait le produit sans créneau ce jour-là. `{ ok: false }` force le
// dialogue à le dire ; une liste vide reste « aucun créneau ».

function client(reponse: { data: unknown; error: unknown }) {
  return { rpc: async () => reponse } as unknown as Parameters<typeof loadSlotOptions>[0];
}

describe("loadSlotOptions", () => {
  it("rend les horaires avec leur remplissage", async () => {
    const resultat = await loadSlotOptions(
      client({ data: [{ slot_start_time: "09:00:00", capacity: 8, booked: 3 }], error: null }),
      "p1",
      "2026-10-01"
    );
    expect(resultat).toEqual({ ok: true, options: [{ slotStartTime: "09:00:00", label: "09:00 (3/8)" }] });
  });

  it("rend une liste vide quand aucun créneau n'existe", async () => {
    expect(await loadSlotOptions(client({ data: [], error: null }), "p1", "2026-10-01")).toEqual({
      ok: true,
      options: [],
    });
  });

  it("signale l'échec de lecture au lieu d'une liste vide", async () => {
    expect(
      await loadSlotOptions(client({ data: null, error: { message: "panne" } }), "p1", "2026-10-01")
    ).toEqual({ ok: false });
  });
});
