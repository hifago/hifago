// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock du seul client que le sitemap utilise. Même forme que les mocks déjà en place dans
// app/api/pms/*/route.test.ts : un builder chaînable, thenable en bout de chaîne.
const state = vi.hoisted(() => ({
  products: [] as unknown[],
  establishments: [] as unknown[],
  // Erreur PAR TABLE : une erreur commune aux deux masquerait l'absence de garde sur l'une d'elles.
  erreurs: {} as Record<string, { message: string }>,
  // Catégories rendues par `buscarCategorias`, par type — le sitemap CONSOMME son contrat
  // (`slug`, `localesNativas`, le prédicat déjà appliqué aux métadonnées), il ne le recalcule pas.
  categorias: {} as Record<string, Array<{ slug: string; localesNativas: string[] }>>,
  appelsCategorias: [] as Array<{ tipo: string; criterios: unknown; opciones: unknown }>,
  categoriasEnPanne: false,
}));

vi.mock("@/lib/supabase/publicClient", () => ({
  createPublicClient: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data: table === "products" ? state.products : state.establishments,
            error: state.erreurs[table] ?? null,
          }).then(resolve),
      });
      return builder;
    },
  }),
}));

vi.mock("@/lib/catalog/buscar", () => ({
  buscarCategorias: async (tipo: string, criterios: unknown, opciones: unknown) => {
    state.appelsCategorias.push({ tipo, criterios, opciones });
    if (state.categoriasEnPanne) throw new Error("search_catalog_categorias injoignable");
    return state.categorias[tipo] ?? [];
  },
}));

import sitemap from "./sitemap";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_WEB_APP_URL = "https://hifago.co";
  state.products = [];
  state.establishments = [];
  state.erreurs = {};
  state.categorias = {};
  state.appelsCategorias = [];
  state.categoriasEnPanne = false;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

const urls = (entries: Awaited<ReturnType<typeof sitemap>>) => entries.map((e) => e.url);

describe("sitemap — accueil", () => {
  it("liste l'accueil en tête, dans les deux locales, en URL absolues", async () => {
    expect(urls(await sitemap()).slice(0, 2)).toEqual(["https://hifago.co/es", "https://hifago.co/en"]);
  });

  it("porte x-default sur l'accueil, pointé vers l'espagnol", async () => {
    const [es] = await sitemap();
    expect(es.alternates?.languages).toMatchObject({
      es: "https://hifago.co/es",
      en: "https://hifago.co/en",
      "x-default": "https://hifago.co/es",
    });
  });
});

describe("sitemap — une entrée par locale réellement traduite", () => {
  it("produit deux entrées pour une fiche bilingue, chacune avec la carte complète", async () => {
    state.products = [
      { slug: "tour-lancha", name: { es: "Tour en lancha", en: "Boat tour" }, updated_at: "2026-08-30T10:00:00Z" },
    ];
    const entries = await sitemap();
    expect(urls(entries)).toContain("https://hifago.co/es/productos/tour-lancha");
    expect(urls(entries)).toContain("https://hifago.co/en/productos/tour-lancha");

    const en = entries.find((e) => e.url.includes("/en/productos/"));
    expect(en?.alternates?.languages).toMatchObject({
      es: "https://hifago.co/es/productos/tour-lancha",
      en: "https://hifago.co/en/productos/tour-lancha",
      "x-default": "https://hifago.co/es/productos/tour-lancha",
    });
  });

  it("n'émet QUE la locale traduite quand la fiche n'existe que dans une langue", async () => {
    // La page /es serait servie en repli, donc noindex (§5.3) : elle n'a rien à faire au sitemap.
    state.products = [
      { slug: "boat-only", name: { en: "Boat tour" }, updated_at: "2026-08-30T10:00:00Z" },
    ];
    const entries = await sitemap();
    expect(urls(entries)).toContain("https://hifago.co/en/productos/boat-only");
    expect(urls(entries)).not.toContain("https://hifago.co/es/productos/boat-only");
  });

  it("fait pointer x-default vers la langue servie quand l'espagnol n'est pas traduit", async () => {
    state.products = [
      { slug: "boat-only", name: { en: "Boat tour" }, updated_at: "2026-08-30T10:00:00Z" },
    ];
    const entry = (await sitemap()).find((e) => e.url.includes("boat-only"));
    // Jamais une URL qu'on vient de déclarer non indexable.
    expect(entry?.alternates?.languages?.["x-default"]).toBe("https://hifago.co/en/productos/boat-only");
  });

  it("écarte une fiche sans aucune locale d'interface traduite", async () => {
    // Contenu saisi en français : aucune route publique dédiée, aucune entrée (§5.4).
    state.products = [
      { slug: "seulement-fr", name: { fr: "Tour en bateau" }, updated_at: "2026-08-30T10:00:00Z" },
    ];
    expect(urls(await sitemap()).some((u) => u.includes("seulement-fr"))).toBe(false);
  });

  it("écarte une fiche dont le champ JSONB est un scalaire", async () => {
    state.products = [{ slug: "casse", name: "Tour", updated_at: "2026-08-30T10:00:00Z" }];
    expect(urls(await sitemap()).some((u) => u.includes("casse"))).toBe(false);
  });
});

describe("sitemap — établissements et métadonnées d'entrée", () => {
  it("liste les établissements sous leur propre chemin", async () => {
    state.establishments = [
      { slug: "casa-kayam", name: { es: "Casa Kayam", en: "Casa Kayam" }, updated_at: "2026-08-29T08:00:00Z" },
    ];
    expect(urls(await sitemap())).toContain("https://hifago.co/es/establecimientos/casa-kayam");
  });

  it("reporte updated_at en lastModified", async () => {
    state.products = [
      { slug: "tour-lancha", name: { es: "Tour" }, updated_at: "2026-08-30T10:00:00Z" },
    ];
    const entry = (await sitemap()).find((e) => e.url.includes("tour-lancha"));
    expect(entry?.lastModified).toBe("2026-08-30T10:00:00Z");
  });

});

// Une panne n'est jamais une absence : un sitemap réduit serait indiscernable d'un catalogue réduit.
// La lecture en échec LÈVE — la route répond 500 et le moteur réessaie (décision du 2026-10-01).
describe("sitemap — panne", () => {
  it.each([["products"], ["establishments"]])("lève si la lecture de %s échoue", async (table) => {
    state.erreurs = { [table]: { message: "connexion refusée" } };
    await expect(sitemap()).rejects.toBeTruthy();
  });

  it("lève si la lecture des catégories échoue", async () => {
    state.categoriasEnPanne = true;
    await expect(sitemap()).rejects.toBeTruthy();
  });
});

// Spec 29 §8.3 : les pages de listing et de catégorie entrent au sitemap.
describe("sitemap — listings et catégories", () => {
  const LISTINGS = ["actividades", "alojamientos", "transportes", "camps", "eventos"];

  it("liste les cinq listings dans les deux locales (libellés d'interface, toujours indexables)", async () => {
    const liste = urls(await sitemap());
    for (const segmento of LISTINGS) {
      expect(liste).toContain(`https://hifago.co/es/${segmento}`);
      expect(liste).toContain(`https://hifago.co/en/${segmento}`);
    }
    const listing = (await sitemap()).find((e) => e.url === "https://hifago.co/en/camps");
    expect(listing?.alternates?.languages).toEqual({
      es: "https://hifago.co/es/camps",
      en: "https://hifago.co/en/camps",
      "x-default": "https://hifago.co/es/camps",
    });
  });

  it("liste une catégorie dans chacune de ses locales natives, jamais ailleurs", async () => {
    state.categorias = {
      activity: [
        { slug: "kayak", localesNativas: ["es", "en"] },
        { slug: "solo-es", localesNativas: ["es"] },
        { slug: "sin-nativa", localesNativas: [] },
      ],
      lodging: [{ slug: "otras", localesNativas: ["es", "en"] }],
    };
    const liste = urls(await sitemap());
    expect(liste).toContain("https://hifago.co/es/actividades/kayak");
    expect(liste).toContain("https://hifago.co/en/actividades/kayak");
    expect(liste).toContain("https://hifago.co/es/actividades/solo-es");
    // Servie en repli sous /en, donc noindex (§5.3) : rien à faire au sitemap.
    expect(liste).not.toContain("https://hifago.co/en/actividades/solo-es");
    expect(liste.some((u) => u.includes("sin-nativa"))).toBe(false);
    expect(liste).toContain("https://hifago.co/en/alojamientos/otras");
  });

  it("interroge les catégories de chaque type sans critère, une carte par catégorie", async () => {
    await sitemap();
    expect(state.appelsCategorias.map((a) => a.tipo).sort()).toEqual(
      ["activity", "camp", "evento", "lodging", "transport"]
    );
    for (const appel of state.appelsCategorias) {
      expect(appel.criterios).toEqual({});
      expect(appel.opciones).toMatchObject({ porCategoria: 1 });
    }
  });
});
