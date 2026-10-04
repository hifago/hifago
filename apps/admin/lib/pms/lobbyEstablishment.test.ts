// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Garde des routes LobbyPMS (sélecteur de chambres/services, import de photos). « Je n'ai pas pu le
// savoir » n'est jamais un refus ni une absence : une lecture d'autorisation OU de l'établissement
// en échec rend 503 `authorization_unavailable` — que le sélecteur traduit par « réessaie » —, jamais
// un 404 « établissement introuvable ».

const state = vi.hoisted(() => ({
  lectures: 0,
  isAdmin: { data: true as unknown, error: null as unknown },
  capability: { data: false as unknown, error: null as unknown },
  establishment: {
    data: { lobby_api_token: "tok", lobby_connector_active: true, lobby_has_token: true } as unknown,
    error: null as unknown,
  },
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc: async (nom: string) => {
      state.lectures += 1;
      return nom === "is_admin" ? state.isAdmin : state.capability;
    },
  }),
}));

vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => {
    const requete: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) requete[m] = () => requete;
    requete.maybeSingle = async () => {
      state.lectures += 1;
      return state.establishment;
    };
    return { from: () => requete };
  },
}));

const { resolveLobbyEstablishment } = await import("./lobbyEstablishment");

async function raison(acces: Awaited<ReturnType<typeof resolveLobbyEstablishment>>) {
  return acces.ok ? null : { statut: acces.response.status, corps: await acces.response.json() };
}

const E1 = "b0000000-0000-4000-8000-000000000004";

describe("resolveLobbyEstablishment — autorisation indéterminable = 503", () => {
  beforeEach(() => {
    state.lectures = 0;
    state.isAdmin = { data: true, error: null };
    state.capability = { data: false, error: null };
    state.establishment = {
      data: { lobby_api_token: "tok", lobby_connector_active: true, lobby_has_token: true },
      error: null,
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("accorde l'accès à un admin sur un établissement connecté", async () => {
    expect((await resolveLobbyEstablishment(E1)).ok).toBe(true);
  });

  it.each([["abc"], [""], [null]])(
    "rend 400 invalid_params pour un identifiant qui n'est pas un UUID (%j), sans aucune lecture",
    async (identifiant) => {
      expect(await raison(await resolveLobbyEstablishment(identifiant))).toEqual({
        statut: 400,
        corps: { ok: false, reason: "invalid_params" },
      });
      expect(state.lectures).toBe(0);
    }
  );

  it("rend 404 pour un établissement réellement absent", async () => {
    state.establishment = { data: null, error: null };
    expect(await raison(await resolveLobbyEstablishment(E1))).toEqual({
      statut: 404,
      corps: { ok: false, reason: "establishment_not_found" },
    });
  });

  it.each([
    ["is_admin", () => (state.isAdmin = { data: null, error: { message: "panne" } })],
    ["has_capability", () => (state.capability = { data: null, error: { message: "panne" } })],
    ["establishments", () => (state.establishment = { data: null, error: { message: "panne" } })],
  ])("rend 503 si la lecture %s échoue", async (_cle, panne) => {
    panne();
    expect(await raison(await resolveLobbyEstablishment(E1))).toEqual({
      statut: 503,
      corps: { ok: false, reason: "authorization_unavailable" },
    });
  });
});
