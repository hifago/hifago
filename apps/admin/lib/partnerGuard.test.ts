// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Garde partagée des layouts products / establishment / reservations de l'espace socio. Ce
// fichier prouve qu'un rôle illisible LÈVE (app/error.tsx) au lieu d'être pris pour « aucun rôle »,
// ce qui renvoyait un partenaire ou un admin en panne de base sur /partner.

class Redirection extends Error {
  constructor(readonly url: string) {
    super(url);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirection(url);
  },
}));

const { requirePartnerOrAdmin } = await import("./partnerGuard");

type Reponse = { data: unknown; error: { message: string } | null };

function client(reponses: Record<string, Reponse>) {
  return { rpc: async (nom: string) => reponses[nom] } as unknown as SupabaseClient;
}

const OK_PARTENAIRE = { data: "p-1", error: null };
const SANS_PARTENAIRE = { data: null, error: null };
const NON_ADMIN = { data: false, error: null };
const PANNE = { data: null, error: { message: "connection refused" } };

describe("requirePartnerOrAdmin", () => {
  it("partenaire : rend son organisation", async () => {
    await expect(
      requirePartnerOrAdmin(client({ partner_id_for_account: OK_PARTENAIRE, is_admin: NON_ADMIN }), "u")
    ).resolves.toEqual({ partnerId: "p-1", isAdmin: false });
  });

  it("admin sans organisation : passe", async () => {
    await expect(
      requirePartnerOrAdmin(
        client({ partner_id_for_account: SANS_PARTENAIRE, is_admin: { data: true, error: null } }),
        "u"
      )
    ).resolves.toEqual({ partnerId: null, isAdmin: true });
  });

  it("aucun rôle : renvoie au repli", async () => {
    await expect(
      requirePartnerOrAdmin(
        client({ partner_id_for_account: SANS_PARTENAIRE, is_admin: NON_ADMIN }),
        "u",
        "/partner/x"
      )
    ).rejects.toMatchObject({ url: "/partner/x" });
  });

  it.each([
    ["partner_id_for_account", { partner_id_for_account: PANNE, is_admin: NON_ADMIN }],
    ["is_admin", { partner_id_for_account: SANS_PARTENAIRE, is_admin: PANNE }],
  ])("lève quand %s échoue, au lieu de renvoyer au repli", async (rpc, reponses) => {
    await expect(requirePartnerOrAdmin(client(reponses), "u")).rejects.toThrow(rpc);
  });
});
