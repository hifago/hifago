// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// /mfa/verify suit `next` par `redirect()`, que Next ne nettoie pas : ce fichier prouve que la
// destination reste interne, et qu'elle survit entière à l'aller-retour par /login.

class Redirection extends Error {
  constructor(readonly url: string) {
    super(url);
  }
}

let utilisateur: { id: string } | null = null;

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirection(url);
  },
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: utilisateur } }) },
  }),
}));

vi.mock("@/lib/mfaGuard", () => ({
  checkMfaGuard: async () => ({ action: "none" }),
}));

vi.mock("./MfaVerifyForm", () => ({ MfaVerifyForm: () => null }));

const { default: MfaVerifyPage } = await import("./page");

async function redirectionPour(next: string) {
  try {
    await MfaVerifyPage({ searchParams: Promise.resolve({ next }) } as never);
  } catch (e) {
    if (e instanceof Redirection) return e.url;
    throw e;
  }
  throw new Error("aucune redirection");
}

describe("/mfa/verify — destination de retour", () => {
  beforeEach(() => {
    utilisateur = { id: "u" };
  });

  it.each([["//evil.com"], ["/\\evil.com"], ["/./\\evil.com"], ["/..//evil.com"]])(
    "redirige vers / au lieu d'une destination hors du site (%j)",
    async (next) => {
      expect(await redirectionPour(next)).toBe("/");
    }
  );

  it("redirige vers une destination interne telle quelle", async () => {
    expect(await redirectionPour("/partner")).toBe("/partner");
  });

  it("sans session, conserve la destination entière à travers /login", async () => {
    utilisateur = null;
    const destination = "/partner/join?token=a&x=b#h";
    const versLogin = new URL(await redirectionPour(destination), "http://h");
    expect(versLogin.pathname).toBe("/login");
    const retour = new URL(versLogin.searchParams.get("next") ?? "", "http://h");
    expect(retour.pathname).toBe("/mfa/verify");
    expect(retour.searchParams.get("next")).toBe(destination);
  });
});
