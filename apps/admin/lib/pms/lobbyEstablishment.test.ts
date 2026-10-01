// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Garde des routes LobbyPMS (sélecteur de chambres/services, import de photos). « Je n'ai pas pu le
// savoir » n'est jamais un refus ni une absence : une lecture d'autorisation OU de l'établissement
// en échec rend 503 `authorization_unavailable` — que le sélecteur traduit par « réessaie » —, jamais
// un 404 « établissement introuvable ».

const state = vi.hoisted(() => ({
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
    rpc: async (nom: string) => (nom === "is_admin" ? state.isAdmin : state.capability),
  }),
}));

vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => {
    const requete: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) requete[m] = () => requete;
    requete.maybeSingle = async () => state.establishment;
    return { from: () => requete };
  },
}));

const { resolveLobbyEstablishment } = await import("./lobbyEstablishment");

async function raison(acces: Awaited<ReturnType<typeof resolveLobbyEstablishment>>) {
  return acces.ok ? null : { statut: acces.response.status, corps: await acces.response.json() };
}

describe("resolveLobbyEstablishment — autorisation indéterminable = 503", () => {
  beforeEach(() => {
    state.isAdmin = { data: true, error: null };
    state.capability = { data: false, error: null };
    state.establishment = {
      data: { lobby_api_token: "tok", lobby_connector_active: true, lobby_has_token: true },
      error: null,
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("accorde l'accès à un admin sur un établissement connecté", async () => {
    expect((await resolveLobbyEstablishment("e1")).ok).toBe(true);
  });

  it("rend 404 pour un établissement réellement absent", async () => {
    state.establishment = { data: null, error: null };
    expect(await raison(await resolveLobbyEstablishment("e1"))).toEqual({
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
    expect(await raison(await resolveLobbyEstablishment("e1"))).toEqual({
      statut: 503,
      corps: { ok: false, reason: "authorization_unavailable" },
    });
  });
});
