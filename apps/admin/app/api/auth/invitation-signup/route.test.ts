// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Inscription par invitation : le compte est créé déjà confirmé (service_role). Ce fichier prouve
// que le jeton est consommé DANS LA MÊME REQUÊTE, sur la session qui vient d'être ouverte — jamais
// laissé réutilisable entre la création du compte et sa consommation — et qu'un échec de
// consommation ne laisse derrière lui aucun compte.

const NOUVEL_ID = "33333333-3333-4333-8333-333333333333";

let reponseCheck: { data: unknown; error: unknown } = { data: { ok: true }, error: null };
let reponseConsume: { data: unknown; error: unknown } = { data: { ok: true }, error: null };
let erreurSignIn: unknown = null;
let erreurCreation: unknown = null;
let erreurSuppression: unknown = null;
let consommations: Array<{ args: Record<string, unknown>; sessionOuverte: boolean }> = [];
let creations: unknown[] = [];
let suppressions: string[] = [];
let deconnexions = 0;
let verifications = 0;

vi.mock("@hifago/supabase/server", () => ({
  // Un client neuf à chaque appel, comme le vrai : seule l'instance qui a fait signInWithPassword
  // porte la session du nouveau compte.
  createClient: async () => {
    let sessionOuverte = false;
    return {
      auth: {
        signInWithPassword: async () => {
          if (!erreurSignIn) sessionOuverte = true;
          return { error: erreurSignIn };
        },
        signOut: async () => {
          deconnexions += 1;
          return { error: null };
        },
      },
      rpc: async (nom: string, args: Record<string, unknown>) => {
        if (nom === "check_partner_invitation") {
          verifications += 1;
          return reponseCheck;
        }
        if (nom === "consume_partner_invitation") {
          consommations.push({ args, sessionOuverte });
          return reponseConsume;
        }
        throw new Error(`rpc inattendue : ${nom}`);
      },
    };
  },
}));

vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => ({
    auth: {
      admin: {
        createUser: async (attributs: unknown) => {
          creations.push(attributs);
          return erreurCreation
            ? { data: { user: null }, error: erreurCreation }
            : { data: { user: { id: NOUVEL_ID } }, error: null };
        },
        deleteUser: async (id: string) => {
          suppressions.push(id);
          return { error: erreurSuppression };
        },
      },
    },
  }),
}));

const { POST } = await import("./route");

const CORPS = { token: "jeton", email: "socio@test.local", password: "secret1234", name: "Ana Pérez" };

async function inscrire(corps: Record<string, unknown> = CORPS) {
  const reponse = await POST(
    new Request("http://localhost:3101/api/auth/invitation-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corps),
    })
  );
  return { statut: reponse.status, corps: await reponse.json() };
}

describe("POST /api/auth/invitation-signup", () => {
  beforeEach(() => {
    reponseCheck = { data: { ok: true }, error: null };
    reponseConsume = { data: { ok: true, partner_id: "p-1", roles: ["operator"] }, error: null };
    erreurSignIn = null;
    erreurCreation = null;
    erreurSuppression = null;
    consommations = [];
    creations = [];
    suppressions = [];
    deconnexions = 0;
    verifications = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("consomme l'invitation sur la session du nouveau compte, dans la même requête", async () => {
    expect(await inscrire()).toEqual({ statut: 200, corps: { ok: true } });
    expect(consommations).toEqual([
      {
        args: { p_token: "jeton", p_signer_name: "Ana Pérez", p_document_version: "v1" },
        sessionOuverte: true,
      },
    ]);
    expect(suppressions).toEqual([]);
  });

  it.each([[""], ["   "], [undefined]])("refuse un nom vide (%j) sans créer de compte", async (name) => {
    expect(await inscrire({ ...CORPS, name })).toEqual({
      statut: 400,
      corps: { ok: false, reason: "invalid_request" },
    });
    expect(creations).toEqual([]);
  });

  it.each([["abc1234"], ["sinchiffres"], ["12345678"], [12345678]])(
    "refuse un mot de passe hors règle (%j) avant toute lecture, sans créer de compte",
    async (password) => {
      expect(await inscrire({ ...CORPS, password })).toEqual({
        statut: 400,
        corps: { ok: false, reason: "weak_password" },
      });
      expect(verifications).toBe(0);
      expect(creations).toEqual([]);
    }
  );

  it("ne crée aucun compte pour un jeton déjà invalide", async () => {
    reponseCheck = { data: { ok: false, reason: "already_consumed" }, error: null };
    expect((await inscrire()).statut).toBe(404);
    expect(creations).toEqual([]);
  });

  it("supprime le compte et ferme la session si l'invitation est refusée (409)", async () => {
    reponseConsume = { data: { ok: false, reason: "already_consumed" }, error: null };
    expect(await inscrire()).toEqual({
      statut: 409,
      corps: { ok: false, reason: "already_consumed" },
    });
    expect(suppressions).toEqual([NOUVEL_ID]);
    expect(deconnexions).toBe(1);
  });

  it("supprime le compte et ferme la session si la consommation échoue (503)", async () => {
    reponseConsume = { data: null, error: { message: "timeout" } };
    expect(await inscrire()).toEqual({
      statut: 503,
      corps: { ok: false, reason: "consume_failed" },
    });
    expect(suppressions).toEqual([NOUVEL_ID]);
    expect(deconnexions).toBe(1);
  });

  it("ferme la session et le signale si la suppression elle-même échoue", async () => {
    reponseConsume = { data: { ok: false, reason: "expired" }, error: null };
    erreurSuppression = { message: "boom" };
    expect(await inscrire()).toEqual({ statut: 409, corps: { ok: false, reason: "expired" } });
    expect(deconnexions).toBe(1);
    expect(console.error).toHaveBeenCalled();
  });

  it("supprime le compte si la session ne peut pas être ouverte", async () => {
    erreurSignIn = { message: "invalid" };
    expect(await inscrire()).toEqual({
      statut: 500,
      corps: { ok: false, reason: "session_failed" },
    });
    expect(consommations).toEqual([]);
    expect(suppressions).toEqual([NOUVEL_ID]);
  });
});
