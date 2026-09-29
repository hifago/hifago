// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Point d'atterrissage de TOUS les retours d'authentification de l'admin (OAuth Google, liens
// email) : la destination `next` y est lue depuis l'URL, donc fournie par quiconque a construit le
// lien. Ce fichier prouve qu'elle ne peut jamais sortir du site.

const ORIGIN = "http://localhost:3101";
const USER_ID = "11111111-1111-4111-8111-111111111111";

// Compte de retour par défaut : créé il y a longtemps, donc jamais concerné par le nettoyage des
// comptes fraîchement créés.
let utilisateur: { id: string; created_at: string; last_sign_in_at: string } | null = null;
let appelsRpc: Array<{ nom: string; args: unknown }> = [];
let reponseCheck: { data: unknown; error: unknown } = { data: { ok: true }, error: null };
let suppressions: string[] = [];
let deconnexions = 0;

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
      verifyOtp: async () => ({ error: null }),
      getUser: async () => ({ data: { user: utilisateur } }),
      signOut: async () => {
        deconnexions += 1;
        return { error: null };
      },
    },
    rpc: async (nom: string, args: unknown) => {
      appelsRpc.push({ nom, args });
      return reponseCheck;
    },
  }),
}));

vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => ({
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          suppressions.push(id);
          return { error: null };
        },
      },
    },
  }),
}));

vi.mock("@/lib/mfaGuard", () => ({
  checkMfaGuard: async () => ({ action: "none" }),
}));

const { GET } = await import("./route");

async function atterrir(query: string) {
  const reponse = await GET(new Request(`${ORIGIN}/auth/callback?${query}`));
  return reponse.headers.get("location");
}

describe("GET /auth/callback (admin) — destination de retour", () => {
  beforeEach(() => {
    utilisateur = {
      id: USER_ID,
      created_at: "2026-01-01T00:00:00Z",
      last_sign_in_at: "2026-09-29T12:00:00Z",
    };
    appelsRpc = [];
    reponseCheck = { data: { ok: true }, error: null };
    suppressions = [];
    deconnexions = 0;
  });

  it.each([
    ["//evil.com"],
    ["/\\evil.com"],
    ["/./\\evil.com"],
    ["/..//evil.com"],
  ])("ramène une destination hors du site (%j) à l'accueil du site", async (next) => {
    const location = await atterrir(`code=ok&next=${encodeURIComponent(next)}`);
    expect(location).toBe(`${ORIGIN}/`);
  });

  it("conserve une destination interne, query comprise", async () => {
    const location = await atterrir(
      `code=ok&next=${encodeURIComponent("/partner/join?token=abc")}`
    );
    expect(location).toBe(`${ORIGIN}/partner/join?token=abc`);
    expect(suppressions).toEqual([]);
    expect(deconnexions).toBe(0);
  });
});
