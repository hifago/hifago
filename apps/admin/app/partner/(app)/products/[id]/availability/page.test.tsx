// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerScope } from "@/lib/partnerOwnership";

// Écran socio « Calendario y cupos » d'un produit. Ce fichier prouve qu'un partenaire n'y ouvre que
// SES fiches (filtre `partner_id`, la RLS laissant lire toute fiche en vente), que l'admin n'est
// pas restreint, et qu'une lecture en panne lève au lieu de rendre « introuvable » ou un calendrier
// vide — un calendrier vide se lirait « aucune date fermée, aucun cupo réservé ».

class Introuvable extends Error {}

type Reponse = { data: unknown; error: { message: string } | null };

const PRODUCT_ID = "b0000000-0000-4000-8000-000000000006";

let portee: OwnerScope = { kind: "partner", partnerId: "p-1" };
let reponses: Record<string, Reponse> = {};
let filtres: Record<string, string[]> = {};

function chaine(table: string) {
  const etapes: string[] = (filtres[table] = []);
  const c = {
    select: () => c,
    eq: (colonne: string, valeur: unknown) => (etapes.push(`eq:${colonne}=${String(valeur)}`), c),
    maybeSingle: async () => reponses[table],
    then: (resoudre: (r: Reponse) => unknown) => resoudre(reponses[table]),
  };
  return c;
}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Introuvable("404");
  },
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => chaine(table) }),
}));

vi.mock("@/lib/partnerOwnership", () => ({ ownerScope: async () => portee }));
vi.mock("@/components/availability-calendar", () => ({ AvailabilityCalendar: () => null }));

const { default: PartnerProductAvailabilityPage } = await import("./page");

function ouvrir() {
  return PartnerProductAvailabilityPage({ params: Promise.resolve({ id: PRODUCT_ID }) } as never);
}

const PANNE = { data: null, error: { message: "connection refused" } };

describe("/partner/products/[id]/availability", () => {
  beforeEach(() => {
    portee = { kind: "partner", partnerId: "p-1" };
    filtres = {};
    reponses = {
      products: {
        data: { id: PRODUCT_ID, name: { es: "Kayak" }, calendar_default_open: true, default_capacity: 8 },
        error: null,
      },
      product_availability: { data: [], error: null },
      product_calendar: { data: [], error: null },
      product_date_rates: { data: [], error: null },
    };
  });

  it("partenaire : la fiche est lue restreinte à son organisation", async () => {
    await ouvrir();
    expect(filtres.products).toEqual([`eq:id=${PRODUCT_ID}`, "eq:partner_id=p-1"]);
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

  it.each([["products"], ["product_availability"], ["product_calendar"], ["product_date_rates"]])(
    "lecture %s en panne : la page lève, jamais introuvable ni calendrier vide",
    async (table) => {
      reponses[table] = PANNE;
      const resultat = ouvrir();
      await expect(resultat).rejects.toThrow(table);
      await expect(resultat).rejects.not.toBeInstanceOf(Introuvable);
    }
  );
});
