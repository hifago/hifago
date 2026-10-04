// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Liste des étiquettes. Ce fichier prouve que la recherche saisie entre dans le filtre PostgREST
// comme une VALEUR (entre guillemets), jamais comme un morceau de sa grammaire, et qu'une panne
// lève au lieu d'afficher un catalogue vide.

let reponse: { data: unknown; count: number | null; error: { message: string } | null } = {
  data: [],
  count: 0,
  error: null,
};
let filtreOr: string | null = null;

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => {
    const requete = {
      select: () => requete,
      order: () => requete,
      range: () => requete,
      or: (filtre: string) => ((filtreOr = filtre), requete),
      then: (resoudre: (r: typeof reponse) => unknown) => resoudre(reponse),
    };
    return { from: () => requete };
  },
}));
vi.mock("./NewTagForm", () => ({ NewTagForm: () => null }));
vi.mock("./TagsList", () => ({ TagsList: () => null }));

const { default: AdminTagsPage } = await import("./page");

function ouvrir(q?: string) {
  return AdminTagsPage({ searchParams: Promise.resolve(q === undefined ? {} : { q }) } as never);
}

describe("/admin/tags", () => {
  beforeEach(() => {
    filtreOr = null;
    reponse = { data: [], count: 0, error: null };
  });

  it("la saisie entre dans le filtre entre guillemets, virgule et parenthèse comprises", async () => {
    await ouvrir("a,b)");
    expect(filtreOr).toBe('label->>es.ilike."%a,b)%",slug.ilike."%a,b)%"');
  });

  it("sans recherche : aucun filtre", async () => {
    await ouvrir();
    expect(filtreOr).toBeNull();
  });

  it("panne de la lecture : la page lève, jamais un catalogue vide", async () => {
    reponse = { data: null, count: null, error: { message: "connection refused" } };
    await expect(ouvrir()).rejects.toThrow(/catalog_tags/);
  });
});
