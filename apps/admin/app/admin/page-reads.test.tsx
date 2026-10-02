// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Lectures des pages admin (représentatif de tout le lot : chaque page passe par
// lib/supabase/checkedRead.ts et, pour un paramètre [id], par lib/routing/requireUuidParam.ts).
// Ce fichier prouve, sur deux fiches : une panne LÈVE au lieu de répondre « introuvable » ; une
// absence réelle reste un 404 ; un identifiant d'URL qui n'est pas un UUID répond 404 sans aucune
// lecture — jamais l'écran d'erreur pour une faute de frappe.

class Introuvable extends Error {}

type Reponse = { data: unknown; error: { message: string } | null };

let reponse: Reponse = { data: null, error: null };
let lectures = 0;

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Introuvable("404");
  },
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => {
    const requete = {
      select: () => requete,
      eq: () => requete,
      in: () => requete,
      order: () => requete,
      returns: () => requete,
      maybeSingle: async () => {
        lectures += 1;
        return reponse;
      },
    };
    return {
      from: () => requete,
      rpc: async () => {
        lectures += 1;
        return reponse;
      },
    };
  },
}));
vi.mock("./products/[id]/DeleteProductButton", () => ({ DeleteProductButton: () => null }));
vi.mock("./clients/[client_key]/ClientOrderCard", () => ({ ClientOrderCard: () => null }));

const { default: AdminProductDetailPage } = await import("./products/[id]/page");
const { default: AdminClientDetailPage } = await import("./clients/[client_key]/page");

const PANNE: Reponse = { data: null, error: { message: "connection refused" } };

beforeEach(() => {
  lectures = 0;
});

describe("/admin/products/[id]", () => {
  const ouvrir = (id: string) => AdminProductDetailPage({ params: Promise.resolve({ id }) } as never);

  it("panne de la lecture : la page lève, jamais « introuvable »", async () => {
    reponse = PANNE;
    const resultat = ouvrir("b0000000-0000-4000-8000-000000000006");
    await expect(resultat).rejects.toThrow(/Lecture impossible \(products\)/);
    await expect(resultat).rejects.not.toBeInstanceOf(Introuvable);
  });

  it("fiche réellement absente : 404", async () => {
    reponse = { data: null, error: null };
    await expect(ouvrir("b0000000-0000-4000-8000-000000000006")).rejects.toBeInstanceOf(Introuvable);
  });

  it("identifiant qui n'est pas un UUID : 404 sans aucune lecture", async () => {
    reponse = PANNE;
    await expect(ouvrir("pas-un-uuid")).rejects.toBeInstanceOf(Introuvable);
    expect(lectures).toBe(0);
  });
});

describe("/admin/clients/[client_key]", () => {
  const ouvrir = (clientKey: string) =>
    AdminClientDetailPage({ params: Promise.resolve({ client_key: clientKey }) } as never);

  it("panne de list_client_orders : la page lève, jamais « introuvable »", async () => {
    reponse = PANNE;
    const resultat = ouvrir("ana%40example.test");
    await expect(resultat).rejects.toThrow(/list_client_orders/);
    await expect(resultat).rejects.not.toBeInstanceOf(Introuvable);
  });

  it("client sans aucune commande : 404", async () => {
    reponse = { data: [], error: null };
    await expect(ouvrir("ana%40example.test")).rejects.toBeInstanceOf(Introuvable);
  });
});
