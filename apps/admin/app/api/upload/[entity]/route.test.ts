// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Cette route écrit en service_role dans un bucket PUBLIC : l'écriture contourne les policies
// Storage, donc l'autorisation se décide ENTIÈREMENT ici. Ce fichier prouve qu'elle est réservée
// à un compte réel porteur d'un rôle (admin, ou organisation partenaire), que `tag` reste réservé à
// l'admin, qu'une autorisation indéterminable ferme la porte, et qu'aucun refus n'écrit rien.

const USER_ID = "22222222-2222-4222-8222-222222222222";

let utilisateur: { id: string; is_anonymous?: boolean } | null = null;
let reponsesRpc: Record<string, { data: unknown; error: unknown }> = {};
let ecritures: string[] = [];

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: utilisateur } }) },
    rpc: async (nom: string) => reponsesRpc[nom] ?? { data: null, error: null },
  }),
}));

vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => ({}),
}));

// Pipeline d'image remplacé (pas de sharp réel) : seul l'ordre des décisions est testé ici.
vi.mock("@/lib/media/catalogImage", () => ({
  MAX_IMAGE_BYTES: 8 * 1024 * 1024,
  toCatalogWebp: async () => ({ ok: true, buffer: Buffer.from("webp") }),
  uploadCatalogWebp: async (_service: unknown, dossier: string) => {
    ecritures.push(dossier);
    return { ok: true, path: `${dossier}/x.webp` };
  },
}));

const { POST } = await import("./route");

function envoyer(entity: string, init?: RequestInit) {
  const corps = new FormData();
  corps.set("file", new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" }));
  return POST(
    new Request(`http://localhost:3101/api/upload/${entity}`, {
      method: "POST",
      body: corps,
      ...init,
    }),
    { params: Promise.resolve({ entity }) } as never
  );
}

function roles({ admin, partenaire }: { admin: boolean; partenaire: boolean }) {
  reponsesRpc = {
    is_admin: { data: admin, error: null },
    partner_id_for_account: { data: partenaire ? "p-1" : null, error: null },
  };
}

describe("POST /api/upload/[entity] — autorisation", () => {
  beforeEach(() => {
    utilisateur = { id: USER_ID };
    roles({ admin: false, partenaire: false });
    ecritures = [];
  });

  it("refuse sans session (401)", async () => {
    utilisateur = null;
    expect((await envoyer("product")).status).toBe(401);
    expect(ecritures).toEqual([]);
  });

  it("refuse une session anonyme, même si elle portait un rôle (403)", async () => {
    utilisateur = { id: USER_ID, is_anonymous: true };
    roles({ admin: true, partenaire: true });
    const reponse = await envoyer("product");
    expect(reponse.status).toBe(403);
    expect(await reponse.json()).toEqual({ ok: false, reason: "anonymous_not_allowed" });
    expect(ecritures).toEqual([]);
  });

  it("refuse un compte réel sans rôle (403)", async () => {
    const reponse = await envoyer("product");
    expect(reponse.status).toBe(403);
    expect(await reponse.json()).toEqual({ ok: false, reason: "not_authorized" });
    expect(ecritures).toEqual([]);
  });

  it("refuse `tag` à un partenaire (403)", async () => {
    roles({ admin: false, partenaire: true });
    expect((await envoyer("tag")).status).toBe(403);
    expect(ecritures).toEqual([]);
  });

  it("accepte un partenaire sur product et establishment", async () => {
    roles({ admin: false, partenaire: true });
    expect((await envoyer("product")).status).toBe(200);
    expect((await envoyer("establishment")).status).toBe(200);
    expect(ecritures).toEqual(["products", "establishments"]);
  });

  it("accepte un admin sur tag", async () => {
    roles({ admin: true, partenaire: false });
    const reponse = await envoyer("tag");
    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toEqual({ ok: true, storage_path: "tags/x.webp" });
  });

  it("ferme la porte si l'autorisation est indéterminable (503)", async () => {
    reponsesRpc = {
      is_admin: { data: null, error: { message: "timeout" } },
      partner_id_for_account: { data: "p-1", error: null },
    };
    const reponse = await envoyer("product");
    expect(reponse.status).toBe(503);
    expect(await reponse.json()).toEqual({ ok: false, reason: "authorization_unavailable" });
    expect(ecritures).toEqual([]);
  });

  it("refuse un corps annoncé trop lourd avant de le lire (413)", async () => {
    roles({ admin: true, partenaire: false });
    const reponse = await POST(
      new Request("http://localhost:3101/api/upload/product", {
        method: "POST",
        headers: { "content-length": String(9 * 1024 * 1024) },
        body: "corps-illisible-en-formdata",
      }),
      { params: Promise.resolve({ entity: "product" }) } as never
    );
    expect(reponse.status).toBe(413);
    expect(ecritures).toEqual([]);
  });
});
