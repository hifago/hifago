// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerScope } from "@/lib/partnerOwnership";

// Écran socio « Proponer edición » d'un établissement. Ce fichier prouve qu'un partenaire n'y ouvre
// que SES établissements (filtre `partner_id`, la RLS laissant lire tout établissement actif),
// que l'admin n'est pas restreint, et qu'une lecture en panne lève au lieu de rendre
// « introuvable » ou une fiche sans propositions ni photos.

class Introuvable extends Error {}

type Reponse = { data: unknown; error: { message: string } | null };

const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000004";

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
        // Deux lectures d'establishment_proposals (édition, puis photos) : distinguées par leur ordre.
        chaine(table === "establishment_proposals" ? `${table}#${++propositions}` : table),
      storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `u/${p}` } }) }) },
    };
  },
}));

vi.mock("@/lib/partnerOwnership", () => ({ ownerScope: async () => portee }));
vi.mock("./EditEstablishmentProposalForm", () => ({ EditEstablishmentProposalForm: () => null }));
vi.mock("@/components/photos-socio-block", () => ({ PhotosSocioBlock: () => null }));

const { default: EditEstablishmentProposalPage } = await import("./page");

function ouvrir() {
  return EditEstablishmentProposalPage({ params: Promise.resolve({ id: ESTABLISHMENT_ID }) } as never);
}

const PANNE = { data: null, error: { message: "connection refused" } };

describe("/partner/establishment/[id]/edit", () => {
  beforeEach(() => {
    portee = { kind: "partner", partnerId: "p-1" };
    filtres = {};
    reponses = {
      establishments: {
        data: { id: ESTABLISHMENT_ID, name: { es: "Finca" }, description: null, address: null, lat: null, lon: null },
        error: null,
      },
      "establishment_proposals#1": { data: null, error: null },
      "establishment_proposals#2": { data: null, error: null },
      establishment_media: { data: [], error: null },
    };
  });

  it("partenaire : l'établissement est lu restreint à son organisation", async () => {
    await ouvrir();
    expect(filtres.establishments).toEqual([`eq:id=${ESTABLISHMENT_ID}`, "eq:partner_id=p-1"]);
  });

  it("admin : l'établissement est lu sans restriction d'organisation", async () => {
    portee = { kind: "admin" };
    await ouvrir();
    expect(filtres.establishments).toEqual([`eq:id=${ESTABLISHMENT_ID}`]);
  });

  it("établissement hors de son organisation (ou inexistant) : introuvable", async () => {
    reponses.establishments = { data: null, error: null };
    await expect(ouvrir()).rejects.toBeInstanceOf(Introuvable);
  });

  it.each([
    ["establishments"],
    ["establishment_proposals#1"],
    ["establishment_proposals#2"],
    ["establishment_media"],
  ])("lecture %s en panne : la page lève, jamais introuvable ni vide", async (cle) => {
    reponses[cle] = PANNE;
    const resultat = ouvrir();
    await expect(resultat).rejects.toThrow(/impossible/);
    await expect(resultat).rejects.not.toBeInstanceOf(Introuvable);
  });

  it("propositions en attente : seule la plus récente est lue (deux en attente ne font pas échouer la lecture)", async () => {
    await ouvrir();
    expect(filtres["establishment_proposals#1"]).toContain("limit:1");
    expect(filtres["establishment_proposals#2"]).toContain("limit:1");
  });
});
