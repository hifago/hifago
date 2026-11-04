// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Point d'atterrissage de TOUS les retours d'authentification de l'admin (OAuth Google, liens
// email) : la destination `next` y est lue depuis l'URL, donc fournie par quiconque a construit le
// lien. Ce fichier prouve qu'elle ne peut jamais sortir du site.

const ORIGIN = "http://localhost:3101";
const USER_ID = "11111111-1111-4111-8111-111111111111";

// Compte de retour par défaut : créé il y a longtemps, donc jamais concerné par le nettoyage des
// comptes fraîchement créés.
let utilisateur: { id: string; email?: string; created_at: string; last_sign_in_at: string } | null = null;
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

let garde: { action: "none" | "verify" } = { action: "none" };

vi.mock("@/lib/mfaGuard", () => ({
  checkMfaGuard: async () => garde,
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
    garde = { action: "none" };
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

  it.each([["//"], ["/.//"]])(
    "ramène une destination que l'analyse d'URL refuse (%j) à l'accueil, sans lever",
    async (next) => {
      const location = await atterrir(`code=ok&next=${encodeURIComponent(next)}`);
      expect(location).toBe(`${ORIGIN}/`);
    }
  );

  it("conserve une destination interne, query comprise", async () => {
    const location = await atterrir(
      `code=ok&next=${encodeURIComponent("/partner/join?token=abc")}`
    );
    expect(location).toBe(`${ORIGIN}/partner/join?token=abc`);
    expect(suppressions).toEqual([]);
    expect(deconnexions).toBe(0);
  });

  // 2FA (spec 07 §10) : un choix, jamais une obligation. Le retour Google ou e-mail d'un compte qui
  // l'a activé passe par le défi ; celui d'un compte qui n'a rien activé n'est JAMAIS détourné vers
  // l'enrôlement (c'est ce qui coinçait un admin sur une page sans sortie).
  it("envoie un compte qui a activé son 2FA vers le défi, destination conservée", async () => {
    garde = { action: "verify" };
    const location = await atterrir(`code=ok&next=${encodeURIComponent("/admin")}`);
    expect(location).toBe(`${ORIGIN}/mfa/verify?next=%2Fadmin`);
  });

  it("ne détourne jamais un compte sans facteur vers l'enrôlement", async () => {
    garde = { action: "none" };
    const location = await atterrir(`code=ok&next=${encodeURIComponent("/admin")}`);
    expect(location).toBe(`${ORIGIN}/admin`);
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

  // Invitation envoyée par e-mail : seul un compte à cette adresse pourra la consommer. Un compte
  // Google tout neuf à une autre adresse ne serait jamais rattaché (jamais de compte sans rôle).
  it("invitation liée à une autre adresse : supprime le compte et revient sur l'invitation avec le motif", async () => {
    utilisateur = { ...utilisateur!, email: "autre@gmail.com" };
    reponseCheck = { data: { ok: true, invited_email: "socio@ejemplo.co" }, error: null };
    expect(await atterrir(`code=ok&next=${encodeURIComponent("/partner/join?token=T")}`)).toBe(
      `${ORIGIN}/partner/join?token=T&error=email_mismatch`
    );
    expect(suppressions).toEqual([USER_ID]);
    expect(deconnexions).toBe(1);
  });

  it.each([
    ["même adresse, casse et espaces différents", " Socio@Ejemplo.co ", "socio@ejemplo.co"],
    ["invitation par simple lien (invited_email null)", "autre@gmail.com", null],
    ["base sans le champ (invited_email absent)", "autre@gmail.com", undefined],
  ])("garde le compte : %s", async (_cas, email, invited) => {
    utilisateur = { ...utilisateur!, email };
    reponseCheck = {
      data: invited === undefined ? { ok: true } : { ok: true, invited_email: invited },
      error: null,
    };
    expect(await atterrir(`code=ok&next=${encodeURIComponent("/partner/join?token=T")}`)).toBe(
      `${ORIGIN}/partner/join?token=T`
    );
    expect(suppressions).toEqual([]);
  });
});
