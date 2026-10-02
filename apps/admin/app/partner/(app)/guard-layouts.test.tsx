// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Les trois layouts de garde operator (products, establishment, reservations). Ce fichier prouve
// qu'une capacité ILLISIBLE remonte telle quelle, sans try/catch qui la convertirait en
// redirection vers /partner (ce que fait une capacité réellement absente). Qu'elle soit ensuite
// rendue par app/error.tsx tient à la structure : c'est la seule frontière d'erreur de l'app, à la
// racine, et elle enveloppe ces layouts — un test unitaire ne peut pas le montrer.

class Redirection extends Error {
  constructor(readonly url: string) {
    super(url);
  }
}

let capacite: () => Promise<boolean> = async () => true;
let garde = { partnerId: "p-1" as string | null, isAdmin: false };

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirection(url);
  },
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
  }),
}));

vi.mock("@/lib/partnerGuard", () => ({
  requirePartnerOrAdmin: async () => garde,
}));

vi.mock("@/lib/agenda/activeOperatorEstablishments", () => ({
  getOperatorCapability: () => capacite(),
}));

const layouts = {
  products: (await import("./products/layout")).default,
  establishment: (await import("./establishment/layout")).default,
  reservations: (await import("./reservations/layout")).default,
};

async function issue(nom: keyof typeof layouts) {
  try {
    await layouts[nom]({ children: null } as never);
    return { rendu: true };
  } catch (e) {
    return e instanceof Redirection ? { redirection: e.url } : { erreur: (e as Error).message };
  }
}

describe.each([["products"], ["establishment"], ["reservations"]] as const)(
  "layout de garde /partner/%s",
  (nom) => {
    beforeEach(() => {
      capacite = async () => true;
      garde = { partnerId: "p-1", isAdmin: false };
    });

    it("admin (sans organisation) : rend l'écran sans lire la capacité", async () => {
      garde = { partnerId: null, isAdmin: true };
      capacite = async () => {
        throw new Error("capacité lue pour un admin");
      };
      expect(await issue(nom)).toEqual({ rendu: true });
    });

    it("operator : rend l'écran", async () => {
      expect(await issue(nom)).toEqual({ rendu: true });
    });

    it("sans capacité operator : renvoie à /partner", async () => {
      capacite = async () => false;
      expect(await issue(nom)).toEqual({ redirection: "/partner" });
    });

    it("capacité illisible : l'erreur remonte, jamais une redirection", async () => {
      capacite = async () => {
        throw new Error("Lecture des capacités impossible (partner_capabilities)");
      };
      expect(await issue(nom)).toEqual({
        erreur: "Lecture des capacités impossible (partner_capabilities)",
      });
    });
  }
);
