// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Bouton « Probar conexión » (admin seul). Ce fichier prouve qu'un rôle illisible répond 503 —
// jamais 403 « pas admin » — et qu'aucun refus n'appelle LobbyPMS.

let utilisateur: { id: string } | null = { id: "u" };
let isAdmin: { data: unknown; error: { message: string } | null } = { data: true, error: null };
const appelLobby = vi.fn(async () => ({ status: 200, body: { data: [1, 2] } }));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: utilisateur } }) },
    rpc: async () => isAdmin,
  }),
}));

vi.mock("@hifago/domain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hifago/domain")>()),
  getLobbyRooms: () => appelLobby(),
}));

const { POST } = await import("./route");

async function tester() {
  const reponse = await POST(
    new Request("http://localhost:3101/api/pms/test-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiToken: "tok" }),
    })
  );
  return { statut: reponse.status, corps: (await reponse.json()) as Record<string, unknown> };
}

describe("POST /api/pms/test-connection — autorisation", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    utilisateur = { id: "u" };
    isAdmin = { data: true, error: null };
    appelLobby.mockClear();
  });

  it("admin : interroge Lobby et rend le nombre de catégories", async () => {
    expect(await tester()).toEqual({ statut: 200, corps: { ok: true, roomsCount: 2 } });
  });

  it("sans session → 401", async () => {
    utilisateur = null;
    expect((await tester()).statut).toBe(401);
    expect(appelLobby).not.toHaveBeenCalled();
  });

  it("non-admin → 403 not_admin", async () => {
    isAdmin = { data: false, error: null };
    expect(await tester()).toEqual({ statut: 403, corps: { ok: false, reason: "not_admin" } });
    expect(appelLobby).not.toHaveBeenCalled();
  });

  it("rôle illisible → 503 authorization_unavailable, pas 403", async () => {
    isAdmin = { data: null, error: { message: "connection refused" } };
    expect(await tester()).toEqual({
      statut: 503,
      corps: { ok: false, reason: "authorization_unavailable" },
    });
    expect(appelLobby).not.toHaveBeenCalled();
  });
});
