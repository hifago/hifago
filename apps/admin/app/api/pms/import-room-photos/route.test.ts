// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mode « attach » (admin seul, produit existant) : le rôle, le produit, son établissement et sa
// galerie sont relus en base avant tout appel à LobbyPMS. Ce fichier prouve qu'une lecture en
// échec répond 503 — « je n'ai pas pu le savoir » —, jamais un faux refus (403), un faux
// « produit introuvable » (404), un faux « établissement non connecté », ni une galerie crue vide.

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";

type Reponse = { data?: unknown; count?: number | null; error: { message: string } | null };

let isAdmin: Reponse = { data: true, error: null };
let tables: Record<string, Reponse> = {};
let lectures: string[] = [];

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
    rpc: async () => isAdmin,
  }),
}));

vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      lectures.push(table);
      const chaine = {
        select: () => chaine,
        eq: () => chaine,
        maybeSingle: async () => tables[table],
        then: (resoudre: (r: Reponse) => unknown) => resoudre(tables[table]),
      };
      return chaine;
    },
  }),
}));

// Aucun téléchargement ni écriture n'est atteint par ces cas : le pipeline d'image est remplacé
// pour ne pas charger sharp.
vi.mock("@/lib/media/catalogImage", () => ({
  CATALOG_MEDIA_BUCKET: "catalog-media",
  toCatalogWebp: async () => ({ ok: false, reason: "unused" }),
  uploadCatalogWebp: async () => ({ ok: false, reason: "unused" }),
}));

// Jamais d'appel sortant depuis un test : si une lecture en panne laissait la route continuer
// jusqu'à Lobby, ce faux le dirait (502) au lieu de partir sur le réseau.
vi.mock("@/lib/pms/lobbyEstablishment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pms/lobbyEstablishment")>()),
  fetchLobbyRoomsCached: async () => {
    throw new Error("appel Lobby inattendu");
  },
}));

const { POST } = await import("./route");

async function attacher(productId: unknown = PRODUCT_ID) {
  const reponse = await POST(
    new Request("http://localhost:3101/api/pms/import-room-photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    })
  );
  return { statut: reponse.status, corps: (await reponse.json()) as { ok: boolean; reason?: string } };
}

const PANNE = { message: "connection refused" };

describe("POST /api/pms/import-room-photos (attach) — une panne n'est jamais un refus ni une absence", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    isAdmin = { data: true, error: null };
    lectures = [];
    tables = {
      products: {
        data: { id: PRODUCT_ID, type: "lodging", lobby_category_id: 7, establishment_id: "e-1" },
        error: null,
      },
      establishments: {
        data: { lobby_api_token: "tok", lobby_connector_active: true, lobby_has_token: true },
        error: null,
      },
      // Galerie pleine : la route s'arrête juste après ses lectures, avant tout appel à Lobby.
      product_media: { count: 6, error: null },
    };
  });

  it("toutes les lectures réussies : la route va jusqu'au plafond de la galerie", async () => {
    expect(await attacher()).toEqual({
      statut: 200,
      corps: { ok: true, imported: 0, skipped: [], reason: "gallery_full" },
    });
  });

  it("rôle illisible → 503 authorization_unavailable, pas 403", async () => {
    isAdmin = { data: null, error: PANNE };
    expect(await attacher()).toEqual({
      statut: 503,
      corps: { ok: false, reason: "authorization_unavailable" },
    });
    expect(lectures).toEqual([]);
  });

  it("non-admin → 403 not_authorized", async () => {
    isAdmin = { data: false, error: null };
    expect((await attacher()).statut).toBe(403);
  });

  it("produit illisible → 503 catalog_unavailable, pas 404", async () => {
    tables.products = { data: null, error: PANNE };
    expect(await attacher()).toEqual({ statut: 503, corps: { ok: false, reason: "catalog_unavailable" } });
  });

  it("produit réellement absent → 404 product_not_found", async () => {
    tables.products = { data: null, error: null };
    expect(await attacher()).toEqual({ statut: 404, corps: { ok: false, reason: "product_not_found" } });
  });

  it("établissement illisible → 503 catalog_unavailable, pas un défaut de connexion Lobby", async () => {
    tables.establishments = { data: null, error: PANNE };
    expect(await attacher()).toEqual({ statut: 503, corps: { ok: false, reason: "catalog_unavailable" } });
  });

  it("galerie illisible → 503 catalog_unavailable, jamais comptée vide", async () => {
    tables.product_media = { count: null, error: PANNE };
    expect(await attacher()).toEqual({ statut: 503, corps: { ok: false, reason: "catalog_unavailable" } });
  });

  it.each([["pas-un-uuid"], [""], [42]])(
    "productId mal formé (%j) → 400 invalid_body, sans aucune lecture",
    async (productId) => {
      expect(await attacher(productId)).toEqual({ statut: 400, corps: { ok: false, reason: "invalid_body" } });
      expect(lectures).toEqual([]);
    }
  );
});
