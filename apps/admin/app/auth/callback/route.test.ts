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

// Un compte que GoTrue vient de créer silencieusement (premier retour Google) n'est gardé que s'il
// arrive pour accepter une invitation ENCORE valide : la destination seule vient de l'URL, elle ne
// prouve rien — le jeton qu'elle porte est revérifié par check_partner_invitation.
describe("GET /auth/callback (admin) — compte fraîchement créé", () => {
  beforeEach(() => {
    utilisateur = {
      id: USER_ID,
      created_at: "2026-09-29T12:00:00Z",
      last_sign_in_at: "2026-09-29T12:00:01Z",
    };
    appelsRpc = [];
    reponseCheck = { data: { ok: true }, error: null };
    suppressions = [];
    deconnexions = 0;
  });

  const BLOQUE = `${ORIGIN}/login?error=google_signup_blocked`;

  it("garde le compte qui arrive avec une invitation valide", async () => {
    const location = await atterrir(`code=ok&next=${encodeURIComponent("/partner/join?token=T")}`);
    expect(location).toBe(`${ORIGIN}/partner/join?token=T`);
    expect(appelsRpc).toEqual([{ nom: "check_partner_invitation", args: { p_token: "T" } }]);
    expect(suppressions).toEqual([]);
  });

  it.each([
    ["hors invitation", "/partner", { data: { ok: true }, error: null }],
    ["invitation sans jeton", "/partner/join", { data: { ok: true }, error: null }],
    ["autre chemin au même préfixe", "/partner/join-x?token=T", { data: { ok: true }, error: null }],
    ["jeton refusé", "/partner/join?token=T", { data: { ok: false, reason: "expired" }, error: null }],
    ["vérification en erreur", "/partner/join?token=T", { data: null, error: { message: "x" } }],
  ])("supprime le compte : %s", async (_cas, next, check) => {
    reponseCheck = check;
    expect(await atterrir(`code=ok&next=${encodeURIComponent(next)}`)).toBe(BLOQUE);
    expect(suppressions).toEqual([USER_ID]);
    expect(deconnexions).toBe(1);
  });
});
