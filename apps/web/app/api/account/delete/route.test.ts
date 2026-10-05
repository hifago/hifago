// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Spec 35 Tranche 4 — CE FICHIER EXISTE POUR TROIS INVARIANTS QU'AUCUN ÉCRAN NE PEUT MONTRER :
//
//   1. La confirmation par email retapé est vérifiée CÔTÉ SERVEUR. Le jour où quelqu'un juge la
//      vérification de l'écran suffisante, ce test rougit — sinon un POST direct suffirait à
//      supprimer le compte d'autrui muni d'un simple cookie de session.
//   2. Un compte professionnel refusé par la RPC ne doit JAMAIS atteindre l'API Admin. Si l'ordre
//      se casse un jour, un référent perdrait sa connexion malgré la garde qui vient de le
//      protéger — et rien à l'écran ne le dirait.
//   3. `email_confirm: true` est passé à l'API Admin. Sans lui, GoTrue laisse le changement d'email
//      EN ATTENTE : l'ancienne adresse resterait occupée et la décision ⑤ (« l'email redevient
//      utilisable ») serait fausse, silencieusement. Invisible à tout e2e.

const USER_ID = "77777777-7777-4777-8777-777777777777";
const EMAIL = "cliente@test.local";

let utilisateur: { id: string; email: string; is_anonymous?: boolean } | null = null;
let reponseRpc: { data: unknown; error: unknown } = { data: { ok: true }, error: null };
let appelsRpc: string[] = [];
let appelsAdmin: Array<{ userId: string; attributs: Record<string, unknown> }> = [];
let erreurAdmin: unknown = null;

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: utilisateur } }) },
    rpc: async (nom: string) => {
      appelsRpc.push(nom);
      return reponseRpc;
    },
  }),
}));

vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => ({
    auth: {
      admin: {
        updateUserById: async (userId: string, attributs: Record<string, unknown>) => {
          appelsAdmin.push({ userId, attributs });
          return { error: erreurAdmin };
        },
      },
    },
  }),
}));

// `isRealAccount` n'est PAS mockée : c'est une fonction pure, et la laisser réelle fait de ce
// fichier une preuve que le refus d'une session anonyme tient vraiment.
const { POST } = await import("./route");

function requete(corps: unknown) {
  return new Request("https://hifago.test/api/account/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  });
}

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    utilisateur = { id: USER_ID, email: EMAIL };
    reponseRpc = { data: { ok: true }, error: null };
    appelsRpc = [];
    appelsAdmin = [];
    erreurAdmin = null;
  });

  it("refuse un email qui ne correspond pas, et n'appelle RIEN", async () => {
    const reponse = await POST(requete({ email: "otro@test.local" }));

    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toMatchObject({ reason: "email_mismatch" });
    expect(appelsRpc).toEqual([]);
    expect(appelsAdmin).toEqual([]);
  });

  // REJOUABLE (2026-10-05) : la suppression a réussi, mais la réponse s'est perdue (réseau, onglet
  // fermé). Le client retente avec l'email d'origine ; la session voit déjà l'adresse neutralisée.
  // Avant, la comparaison des emails bouclait sur `email_mismatch` sans fin.
  it("suppression déjà faite (réponse perdue) : rejouer répond ok, sans rien rappeler", async () => {
    utilisateur = { id: USER_ID, email: `deleted+${USER_ID}@hifago.invalid` };
    const reponse = await POST(requete({ email: EMAIL }));

    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toEqual({ ok: true });
    expect(appelsRpc).toEqual([]);
    expect(appelsAdmin).toEqual([]);
  });

  it("l'adresse neutralisée d'un AUTRE compte ne vaut pas suppression faite", async () => {
    utilisateur = { id: USER_ID, email: "deleted+88888888-8888-4888-8888-888888888888@hifago.invalid" };
    const reponse = await POST(requete({ email: EMAIL }));

    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toMatchObject({ reason: "email_mismatch" });
  });

  it("accepte l'email à la casse et aux espaces près — pas un piège pour le client", async () => {
    const reponse = await POST(requete({ email: "  CLIENTE@Test.Local  " }));

    expect(reponse.status).toBe(200);
    expect(appelsRpc).toEqual(["delete_my_account"]);
  });

  it("refuse une session anonyme sans jamais toucher au compte", async () => {
    utilisateur = { id: USER_ID, email: EMAIL, is_anonymous: true };

    const reponse = await POST(requete({ email: EMAIL }));

    expect(reponse.status).toBe(401);
    expect(appelsRpc).toEqual([]);
    expect(appelsAdmin).toEqual([]);
  });

  it("un compte professionnel refusé par la RPC n'atteint JAMAIS l'API Admin", async () => {
    reponseRpc = { data: { ok: false, reason: "professional_account" }, error: null };

    const reponse = await POST(requete({ email: EMAIL }));

    expect(reponse.status).toBe(409);
    expect(await reponse.json()).toMatchObject({ reason: "professional_account" });
    expect(appelsAdmin).toEqual([]);
  });

  it("neutralise l'identité avec une adresse .invalid ET email_confirm", async () => {
    const reponse = await POST(requete({ email: EMAIL }));

    expect(reponse.status).toBe(200);
    expect(appelsRpc).toEqual(["delete_my_account"]);
    expect(appelsAdmin).toHaveLength(1);
    expect(appelsAdmin[0].userId).toBe(USER_ID);
    expect(appelsAdmin[0].attributs.email).toBe(`deleted+${USER_ID}@hifago.invalid`);
    // Sans ça, l'ancien email resterait occupé — décision ⑤ cassée en silence.
    expect(appelsAdmin[0].attributs.email_confirm).toBe(true);
    expect(String(appelsAdmin[0].attributs.password ?? "")).not.toHaveLength(0);
  });

  it("dit honnêtement qu'il reste du travail si l'API Admin échoue après l'anonymisation", async () => {
    erreurAdmin = { message: "boom" };

    const reponse = await POST(requete({ email: EMAIL }));

    expect(reponse.status).toBe(500);
    expect(await reponse.json()).toMatchObject({ reason: "auth_update_failed" });
  });
});
