// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// La page de cupos par horario (admin ET socio) : une lecture en panne n'y est jamais « produit
// introuvable » (404) ni « ce produit n'a pas encore d'horaires » (grille vide). `null` reste réservé
// au produit absent ou sans règle de créneaux ; une erreur lève — l'écran d'erreur de l'app suit.

const state = vi.hoisted(() => ({
  produit: { id: "p1", type: "activity", name: { es: "Kayak" } } as unknown,
  nbRegles: 2,
  erreurs: {} as Record<string, { message: string }>,
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const resultat = () => {
        const error = state.erreurs[table] ?? null;
        if (error) return { data: null, count: null, error };
        return table === "products"
          ? { data: state.produit, error: null }
          : { data: null, count: state.nbRegles, error: null };
      };
      const requete: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) requete[m] = () => requete;
      requete.maybeSingle = async () => resultat();
      requete.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
        Promise.resolve(resultat()).then(ok, ko);
      return requete;
    },
    rpc: async (nom: string) => {
      const error = state.erreurs[nom] ?? null;
      return error ? { data: null, error } : { data: [], error: null };
    },
  }),
}));

const { loadSlotAvailabilityPageData } = await import("./slotAvailabilityPage");

describe("loadSlotAvailabilityPageData — panne ≠ absence", () => {
  beforeEach(() => {
    state.produit = { id: "p1", type: "activity", name: { es: "Kayak" } };
    state.nbRegles = 2;
    state.erreurs = {};
  });

  it("rend la page, grille vide comprise quand aucun créneau n'est publié", async () => {
    const page = await loadSlotAvailabilityPageData("p1", "2026-10-01");
    expect(page?.slots).toEqual([]);
    expect(page?.dates).toHaveLength(14);
  });

  it("rend null pour un produit absent ou sans règle de créneaux (404 voulu)", async () => {
    state.produit = null;
    expect(await loadSlotAvailabilityPageData("p1", undefined)).toBeNull();
    state.produit = { id: "p1", type: "activity", name: {} };
    state.nbRegles = 0;
    expect(await loadSlotAvailabilityPageData("p1", undefined)).toBeNull();
  });

  it.each([["products"], ["product_slot_rules"], ["get_product_slots"]])(
    "lève si la lecture %s échoue",
    async (cle) => {
      state.erreurs = { [cle]: { message: "panne" } };
      await expect(loadSlotAvailabilityPageData("p1", "2026-10-01")).rejects.toBeTruthy();
    }
  );
});
