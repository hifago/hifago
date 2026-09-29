// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Retour de confirmation d'email de la vitrine : la destination `next` vient de l'URL du lien.
// Ce fichier prouve qu'elle ne peut jamais sortir du site.

const ORIGIN = "http://localhost:3200";

let appelsRpc: string[] = [];

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
      verifyOtp: async () => ({ error: null }),
    },
    rpc: async (nom: string) => {
      appelsRpc.push(nom);
      return { error: null };
    },
  }),
}));

const { GET } = await import("./route");

async function atterrir(next: string) {
  const reponse = await GET(
    new Request(
      `${ORIGIN}/auth/callback?token_hash=x&type=signup&next=${encodeURIComponent(next)}`
    )
  );
  return reponse.headers.get("location");
}

describe("GET /auth/callback (vitrine) — destination de retour", () => {
  beforeEach(() => {
    appelsRpc = [];
  });

  it.each([
    ["//evil.com"],
    ["/\\evil.com"],
    ["/./\\evil.com"],
    ["/..//evil.com"],
  ])("ramène une destination hors du site (%j) à l'accueil du site", async (next) => {
    expect(await atterrir(next)).toBe(`${ORIGIN}/`);
  });

  it("conserve une destination interne localisée", async () => {
    expect(await atterrir("/es/cuenta/reservas?x=1")).toBe(`${ORIGIN}/es/cuenta/reservas?x=1`);
    expect(appelsRpc).toContain("attach_orders_to_account");
  });
});
