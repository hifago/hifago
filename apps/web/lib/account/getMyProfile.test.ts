// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Un profil illisible n'est JAMAIS un profil vide : sur `/cuenta/perfil`, des champs pré-remplis à
// vide puis enregistrés écraseraient le vrai profil ; sur `/pago`, un nom vide y passe pour « profil
// jamais édité » et ferait retomber sur une ancienne commande. Chaque lecture en erreur lève.

const state = vi.hoisted(() => ({
  viewer: { id: "u1", email: "ana@test.local" } as { id: string; email: string } | null,
  erreurs: {} as Record<string, { message: string }>,
}));

vi.mock("@/lib/auth/viewer", () => ({ getViewerAccount: async () => state.viewer }));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const resultat = () => {
        const error = state.erreurs[table] ?? null;
        if (error) return { data: null, error };
        return table === "partner_accounts"
          ? { data: { full_name: "Ana", phone: "+573001234567" }, error: null }
          : { data: [], error: null };
      };
      const requete: Record<string, unknown> = {};
      for (const m of ["select", "eq", "limit"]) requete[m] = () => requete;
      requete.maybeSingle = async () => resultat();
      requete.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
        Promise.resolve(resultat()).then(ok, ko);
      return requete;
    },
  }),
}));

const { getMyProfile, getPartnerAccountProfileFields } = await import("./getMyProfile");
const { createClient } = await import("@hifago/supabase/server");

describe("getMyProfile — panne ≠ profil vide", () => {
  beforeEach(() => {
    state.viewer = { id: "u1", email: "ana@test.local" };
    state.erreurs = {};
  });

  it("rend le profil", async () => {
    expect(await getMyProfile()).toEqual({
      email: "ana@test.local",
      fullName: "Ana",
      phone: "+573001234567",
      hasProfessionalCapability: false,
    });
  });

  it("rend null sans compte", async () => {
    state.viewer = null;
    expect(await getMyProfile()).toBeNull();
  });

  it.each([["partner_accounts"], ["partner_capabilities"]])(
    "lève si la lecture %s échoue",
    async (table) => {
      state.erreurs = { [table]: { message: "panne" } };
      await expect(getMyProfile()).rejects.toBeTruthy();
    }
  );

  it("getPartnerAccountProfileFields (repli de /pago) lève aussi sur erreur", async () => {
    state.erreurs = { partner_accounts: { message: "panne" } };
    await expect(getPartnerAccountProfileFields(await createClient(), "u1")).rejects.toBeTruthy();
  });
});
