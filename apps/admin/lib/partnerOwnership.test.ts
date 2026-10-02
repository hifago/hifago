// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Portée des écrans socio qui affichent UNE fiche (produit, établissement) : un partenaire n'y voit
// que les siennes, l'admin toutes. Ce fichier prouve que la portée est toujours EXPLICITE — jamais
// un `null` qui pourrait être lu comme « sans restriction » pour un partenaire.

class Introuvable extends Error {}

let garde: { partnerId: string | null; isAdmin: boolean } = { partnerId: "p-1", isAdmin: false };

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Introuvable("404");
  },
}));

vi.mock("./partnerGuard", () => ({
  requirePartnerOrAdmin: async () => garde,
}));

const { ownerScope } = await import("./partnerOwnership");

function client(utilisateur: { id: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user: utilisateur } }) },
  } as unknown as SupabaseClient;
}

describe("ownerScope", () => {
  it("partenaire : portée restreinte à son organisation", async () => {
    garde = { partnerId: "p-1", isAdmin: false };
    await expect(ownerScope(client({ id: "u" }))).resolves.toEqual({
      kind: "partner",
      partnerId: "p-1",
    });
  });

  it("admin (sans organisation) : portée admin", async () => {
    garde = { partnerId: null, isAdmin: true };
    await expect(ownerScope(client({ id: "u" }))).resolves.toEqual({ kind: "admin" });
  });

  it("sans session : introuvable (le layout a déjà redirigé, défense en profondeur)", async () => {
    await expect(ownerScope(client(null))).rejects.toBeInstanceOf(Introuvable);
  });

  it("ni organisation ni admin : introuvable, jamais une portée ouverte", async () => {
    garde = { partnerId: null, isAdmin: false };
    await expect(ownerScope(client({ id: "u" }))).rejects.toBeInstanceOf(Introuvable);
  });
});
