// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// La route enchaîne la RPC (session admin), puis l'API Admin et Storage (service_role). Ce fichier
// prouve qu'un refus de la base n'atteint jamais service_role, et qu'un compte non supprimé est
// rendu à l'écran au lieu d'être tu.

const PARTNER_ID = "11111111-1111-4111-8111-111111111111";

type Rpc = { data: unknown; error: { code?: string; message: string } | null };

let rpcResult: Rpc;
let deleteUserErrors: Record<string, { message: string } | null>;
let deletedUsers: string[];
let removedPaths: string[][];
let serviceUsed: boolean;

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({ rpc: async () => rpcResult }),
}));

vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => {
    serviceUsed = true;
    return {
      auth: {
        admin: {
          deleteUser: async (id: string) => {
            deletedUsers.push(id);
            return { error: deleteUserErrors[id] ?? null };
          },
        },
      },
      storage: {
        from: () => ({
          remove: async (paths: string[]) => {
            removedPaths.push(paths);
            return { error: null };
          },
        }),
      },
    };
  },
}));

vi.mock("@/lib/media/catalogImage", () => ({ CATALOG_MEDIA_BUCKET: "catalog-media" }));

const { DELETE } = await import("./route");

async function supprimer(id: string = PARTNER_ID) {
  const reponse = await DELETE(new Request(`http://localhost:3101/api/partners/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
  return { statut: reponse.status, corps: (await reponse.json()) as Record<string, unknown> };
}

describe("DELETE /api/partners/[id]", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcResult = { data: { ok: true, account_ids: [], storage_paths: [] }, error: null };
    deleteUserErrors = {};
    deletedUsers = [];
    removedPaths = [];
    serviceUsed = false;
  });

  it("refuse un identifiant qui n'est pas un UUID sans rien appeler", async () => {
    const { statut } = await supprimer("pas-un-uuid");
    expect(statut).toBe(404);
    expect(serviceUsed).toBe(false);
  });

  it("un non-admin reçoit 403, service_role jamais atteint", async () => {
    rpcResult = { data: null, error: { code: "42501", message: "réservé au rôle admin" } };
    const { statut } = await supprimer();
    expect(statut).toBe(403);
    expect(serviceUsed).toBe(false);
  });

  it("un partenaire qui a des commandes est refusé (409), service_role jamais atteint", async () => {
    rpcResult = { data: { ok: false, reason: "has_orders" }, error: null };
    const { statut, corps } = await supprimer();
    expect(statut).toBe(409);
    expect(corps).toEqual({ ok: false, reason: "has_orders" });
    expect(serviceUsed).toBe(false);
  });

  it("une panne de la RPC répond 503, jamais un succès", async () => {
    rpcResult = { data: null, error: { message: "connection refused" } };
    const { statut } = await supprimer();
    expect(statut).toBe(503);
    expect(serviceUsed).toBe(false);
  });

  it("supprime chaque compte et les photos orphelines", async () => {
    rpcResult = {
      data: { ok: true, account_ids: ["a-1", "a-2"], storage_paths: ["establishments/x.webp"] },
      error: null,
    };
    const { statut, corps } = await supprimer();
    expect(statut).toBe(200);
    expect(corps).toEqual({ ok: true, accountsNotDeleted: [] });
    expect(deletedUsers).toEqual(["a-1", "a-2"]);
    expect(removedPaths).toEqual([["establishments/x.webp"]]);
  });

  it("un compte que l'API Admin refuse est rendu à l'écran, les autres partent quand même", async () => {
    rpcResult = { data: { ok: true, account_ids: ["a-1", "a-2"], storage_paths: [] }, error: null };
    deleteUserErrors = { "a-1": { message: "boom" } };
    const { statut, corps } = await supprimer();
    expect(statut).toBe(200);
    expect(corps).toEqual({ ok: true, accountsNotDeleted: ["a-1"] });
    expect(deletedUsers).toEqual(["a-1", "a-2"]);
    expect(removedPaths).toEqual([]);
  });
});
