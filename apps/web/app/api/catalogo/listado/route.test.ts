// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Le pont du défilement infini, appelable directement sans passer par la page. Ce fichier prouve
// ses trois garanties : un type inconnu est refusé (jamais « toutes les offres »), le plafond de
// pages est reposé à cette porte aussi, et une panne ne prend jamais la forme d'une fin de liste.

const state = vi.hoisted(() => ({
  appels: [] as Array<{ tipo: string; opciones: Record<string, unknown> }>,
  echec: false,
}));

vi.mock("@/lib/catalog/buscar", () => ({
  buscarTipo: async (tipo: string, _criterios: unknown, opciones: Record<string, unknown>) => {
    state.appels.push({ tipo, opciones });
    if (state.echec) throw new Error('relation "public.products" does not exist');
    return { tarjetas: [{ clave: "producto-1" }], hayMas: true };
  },
}));

const { GET } = await import("./route");

async function appeler(query: string) {
  const reponse = await GET(new Request(`http://localhost:3200/api/catalogo/listado?${query}`));
  return { statut: reponse.status, corps: await reponse.json() };
}

describe("GET /api/catalogo/listado", () => {
  beforeEach(() => {
    state.appels = [];
    state.echec = false;
  });

  it.each([[""], ["tipo=inexistant"]])("refuse un type absent ou inconnu (%j) sans lire le catalogue", async (query) => {
    expect(await appeler(query)).toEqual({ statut: 400, corps: { ok: false, reason: "tipo_desconocido" } });
    expect(state.appels).toEqual([]);
  });

  it("rend une tranche de la page demandée", async () => {
    expect(await appeler("tipo=activity&pagina=3&locale=en")).toEqual({
      statut: 200,
      corps: { tarjetas: [{ clave: "producto-1" }], hayMas: true },
    });
    expect(state.appels[0]).toMatchObject({
      tipo: "activity",
      opciones: { limite: 24, desplazamiento: 48, locale: "en", sinTag: false },
    });
  });

  it("repose le plafond de pages et la locale par défaut à cette porte", async () => {
    await appeler("tipo=activity&pagina=99999&locale=pt&sinTag=1");
    expect(state.appels[0].opciones).toMatchObject({ desplazamiento: 0, locale: "es", sinTag: true });
  });

  it("sur une panne : 500 avec un motif stable, jamais une liste vide ni le message Postgres", async () => {
    state.echec = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { statut, corps } = await appeler("tipo=activity");
    expect(statut).toBe(500);
    expect(corps).toEqual({ ok: false, reason: "catalogo_no_disponible" });
    expect(JSON.stringify(corps)).not.toContain("public.products");
    vi.restoreAllMocks();
  });
});
