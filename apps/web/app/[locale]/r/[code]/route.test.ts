// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Lien/QR imprimé des socios : la locale vient du chemin, et tous les chemins n'atteignent pas
// cette route en passant par le proxy next-intl (qui ne valide que ce qu'il intercepte). Ce
// fichier prouve que la redirection reste sur le site quelle que soit la locale reçue.

const ORIGIN = "http://localhost:3200";

let codeActif: string | null = null;
let panne = false;

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => {
    const requete = {
      select: () => requete,
      eq: () => requete,
      maybeSingle: async () =>
        panne
          ? { data: null, error: { message: "connection refused" } }
          : { data: codeActif ? { code: codeActif } : null, error: null },
    };
    return { from: () => requete };
  },
}));

const { GET } = await import("./route");

async function redirection(locale: string, code: string) {
  const reponse = await GET(
    new Request(`${ORIGIN}/${encodeURIComponent(locale)}/r/${code}`) as never,
    { params: Promise.resolve({ locale, code }) } as never
  );
  return { statut: reponse.status, location: reponse.headers.get("location") };
}

describe("GET /[locale]/r/[code]", () => {
  beforeEach(() => {
    codeActif = null;
    panne = false;
  });

  it.each([["\\evil.com"], ["//evil.com"], ["fr"]])(
    "une locale inconnue (%j) retombe sur l'accueil espagnol du site",
    async (locale) => {
      expect(await redirection(locale, "NOPE")).toEqual({ statut: 302, location: `${ORIGIN}/es` });
    }
  );

  it("un code actif garde sa locale et réinjecte ?ref=", async () => {
    codeActif = "ABC";
    expect(await redirection("en", "ABC")).toEqual({
      statut: 302,
      location: `${ORIGIN}/en?ref=ABC`,
    });
  });

  it("un code inconnu redirige vers l'accueil de la locale, sans ?ref=", async () => {
    expect(await redirection("en", "NOPE")).toEqual({ statut: 302, location: `${ORIGIN}/en` });
  });

  // Une panne n'est jamais une absence : le QR imprimé garde son attribution, create_order
  // revérifie le code au moment de la commande.
  it("lecture en panne : ?ref= conservé, jamais l'attribution perdue", async () => {
    panne = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await redirection("es", "ABC")).toEqual({ statut: 302, location: `${ORIGIN}/es?ref=ABC` });
    vi.restoreAllMocks();
  });
});
