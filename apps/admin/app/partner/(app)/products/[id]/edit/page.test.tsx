// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerScope } from "@/lib/partnerOwnership";

// Écran socio « Proponer edición » d'un produit. Ce fichier prouve : (1) qu'un partenaire ne peut
// ouvrir que SES fiches — `products_select_public` laisse lire toute fiche en vente, le filtre
// `partner_id` est donc posé par la page ; (2) que l'admin n'est pas restreint ; (3) qu'une
// lecture en panne lève (app/error.tsx) au lieu de devenir « introuvable » ou un écran vide.

class Introuvable extends Error {}

type Reponse = { data: unknown; error: { message: string } | null };

const PRODUCT_ID = "b0000000-0000-4000-8000-000000000006";

let portee: OwnerScope = { kind: "partner", partnerId: "p-1" };
let reponses: Record<string, Reponse> = {};
let filtres: Record<string, string[]> = {};

function chaine(cle: string) {
  const etapes: string[] = (filtres[cle] = []);
  const c = {
    select: () => c,
    eq: (colonne: string, valeur: unknown) => (etapes.push(`eq:${colonne}=${String(valeur)}`), c),
    order: () => c,
    limit: (n: number) => (etapes.push(`limit:${n}`), c),
    maybeSingle: async () => reponses[cle],
    then: (resoudre: (r: Reponse) => unknown) => resoudre(reponses[cle]),
  };
  return c;
}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Introuvable("404");
  },
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => {
    let propositions = 0;
    return {
      from: (table: string) =>
        // Deux lectures de product_proposals (contenu, puis photos) : distinguées par leur ordre.
        chaine(table === "product_proposals" ? `${table}#${++propositions}` : table),
      storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `u/${p}` } }) }) },
    };
  },
}));

vi.mock("@/lib/partnerOwnership", () => ({ ownerScope: async () => portee }));
vi.mock("./EditProposalForm", () => ({ EditProposalForm: () => null }));
vi.mock("@/components/photos-socio-block", () => ({ PhotosSocioBlock: () => null }));

const { default: EditProductProposalPage } = await import("./page");

function ouvrir() {
  return EditProductProposalPage({ params: Promise.resolve({ id: PRODUCT_ID }) } as never);
}

const PANNE = { data: null, error: { message: "connection refused" } };

describe("/partner/products/[id]/edit", () => {
  beforeEach(() => {
    portee = { kind: "partner", partnerId: "p-1" };
    filtres = {};
    reponses = {
      products: { data: { id: PRODUCT_ID, type: "activity", name: { es: "Kayak" } }, error: null },
      "product_proposals#1": { data: null, error: null },
      "product_proposals#2": { data: null, error: null },
      product_media: { data: [], error: null },
    };
  });

  it("partenaire : la fiche est lue restreinte aux établissements de son organisation (prédicat des RPC d'écriture)", async () => {
    await ouvrir();
    expect(filtres.products).toEqual([`eq:id=${PRODUCT_ID}`, "eq:establishment.partner_id=p-1"]);
  });

  it("admin : la fiche est lue sans restriction d'organisation", async () => {
    portee = { kind: "admin" };
    await ouvrir();
    expect(filtres.products).toEqual([`eq:id=${PRODUCT_ID}`]);
  });

  it("fiche hors de son organisation (ou inexistante) : introuvable", async () => {
    reponses.products = { data: null, error: null };
    await expect(ouvrir()).rejects.toBeInstanceOf(Introuvable);
  });

  it.each([["products"], ["product_proposals#1"], ["product_proposals#2"], ["product_media"]])(
    "lecture %s en panne : la page lève, jamais introuvable ni vide",
    async (cle) => {
      reponses[cle] = PANNE;
      const resultat = ouvrir();
      await expect(resultat).rejects.toThrow(/impossible/);
      await expect(resultat).rejects.not.toBeInstanceOf(Introuvable);
    }
  );

  it("propositions en attente : seule la plus récente est lue (deux en attente ne font pas échouer la lecture)", async () => {
    await ouvrir();
    expect(filtres["product_proposals#1"]).toContain("limit:1");
    expect(filtres["product_proposals#2"]).toContain("limit:1");
  });
});
