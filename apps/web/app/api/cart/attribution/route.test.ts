// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Le cookie `hifago_ref` revient du navigateur tel quel : il peut avoir été forgé sans passer par
// `proxy.ts`. Ce fichier prouve que la route applique la MÊME borne que le proxy avant de recopier
// la valeur dans `carts.attribution_code`, qu'elle n'agit qu'avec la session du visiteur, et qu'un
// cookie absent ne coûte aucun appel Supabase.

const state = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  user: { id: "u1" } as { id: string } | null,
  erreurUpsert: null as unknown,
  upserts: [] as Array<{ ligne: unknown; options: unknown }>,
  clients: 0,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nom: string) => (nom === "hifago_ref" && state.cookie !== undefined ? { value: state.cookie } : undefined),
  }),
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => {
    state.clients += 1;
    return {
      auth: { getUser: async () => ({ data: { user: state.user } }) },
      from: () => ({
        upsert: async (ligne: unknown, options: unknown) => {
          state.upserts.push({ ligne, options });
          return { error: state.erreurUpsert };
        },
      }),
    };
  },
}));

const { POST } = await import("./route");

async function appeler() {
  const reponse = await POST();
  return { statut: reponse.status, corps: await reponse.json() };
}

describe("POST /api/cart/attribution", () => {
  beforeEach(() => {
    state.cookie = undefined;
    state.user = { id: "u1" };
    state.erreurUpsert = null;
    state.upserts = [];
    state.clients = 0;
  });

  it("sans cookie : rien à capturer, aucun appel Supabase", async () => {
    expect(await appeler()).toEqual({ statut: 200, corps: { ok: true, captured: false } });
    expect(state.clients).toBe(0);
  });

  it("ignore un cookie trop long (forgé hors du proxy) sans rien écrire", async () => {
    state.cookie = "x".repeat(65);
    expect(await appeler()).toEqual({ statut: 200, corps: { ok: true, captured: false } });
    expect(state.upserts).toEqual([]);
  });

  it("enregistre le code nettoyé sur le panier du visiteur", async () => {
    state.cookie = "  SEED-REFACTIVE  ";
    expect(await appeler()).toEqual({ statut: 200, corps: { ok: true, captured: true } });
    expect(state.upserts).toEqual([
      {
        ligne: { account_id: "u1", attribution_code: "SEED-REFACTIVE", attribution_source: "link" },
        options: { onConflict: "account_id" },
      },
    ]);
  });

  it("refuse sans session (401)", async () => {
    state.cookie = "SEED-REFACTIVE";
    state.user = null;
    expect((await appeler()).statut).toBe(401);
    expect(state.upserts).toEqual([]);
  });

  it("rend 500 si l'écriture échoue", async () => {
    state.cookie = "SEED-REFACTIVE";
    state.erreurUpsert = { message: "panne" };
    expect(await appeler()).toEqual({ statut: 500, corps: { ok: false } });
  });
});
