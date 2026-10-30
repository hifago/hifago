// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// /mfa/enroll suit `next` par `redirect()`, que Next ne nettoie pas : ce fichier prouve que la
// destination reste interne, et qu'elle survit entière à l'aller-retour par /login — et à celui par
// /mfa/verify, où une session AAL1 dont le compte a déjà un facteur est renvoyée avant d'enrôler.

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

let capacite: { data: unknown; error: { message: string } | null } = { data: true, error: null };

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: utilisateur } }) },
    rpc: async () => capacite,
  }),
}));

let garde: { action: "none" | "verify" } = { action: "verify" };

vi.mock("@/lib/mfaGuard", () => ({
  checkMfaGuard: async () => garde,
}));

vi.mock("./MfaEnrollForm", () => ({ MfaEnrollForm: () => null }));
vi.mock("@/components/LogoutButton", () => ({ LogoutButton: () => null }));

const { default: MfaEnrollPage } = await import("./page");

async function redirectionPour(next: string) {
  try {
    await MfaEnrollPage({ searchParams: Promise.resolve({ next }) } as never);
  } catch (e) {
    if (e instanceof Redirection) return e.url;
    throw e;
  }
  throw new Error("aucune redirection");
}

function destinationVerify(url: string) {
  const redirection = new URL(url, "http://h");
  expect(redirection.pathname).toBe("/mfa/verify");
  return redirection.searchParams.get("next");
}

describe("/mfa/enroll — destination de retour", () => {
  beforeEach(() => {
    utilisateur = { id: "u" };
    garde = { action: "verify" };
    capacite = { data: true, error: null };
  });

  it.each([["//evil.com"], ["/\\evil.com"], ["/./\\evil.com"], ["/..//evil.com"]])(
    "renvoie vers / au lieu d'une destination hors du site (%j)",
    async (next) => {
      expect(destinationVerify(await redirectionPour(next))).toBe("/");
    }
  );

  it("renvoie vers le défi avec une destination interne telle quelle", async () => {
    expect(destinationVerify(await redirectionPour("/partner"))).toBe("/partner");
  });

  it("un compte sans capacité admin n'enrôle pas : renvoyé à sa destination", async () => {
    capacite = { data: false, error: null };
    expect(await redirectionPour("/partner")).toBe("/partner");
  });

  it("lève quand la capacité admin est illisible, au lieu de la lire comme « non »", async () => {
    capacite = { data: null, error: { message: "connection refused" } };
    await expect(redirectionPour("/partner")).rejects.toThrow(/has_admin_capability/);
  });

  it("sans facteur à vérifier, rend l'écran d'enrôlement au lieu de rediriger", async () => {
    garde = { action: "none" };
    await expect(redirectionPour("/partner")).rejects.toThrow("aucune redirection");
  });

  it("sans session, conserve la destination entière à travers /login", async () => {
    utilisateur = null;
    const destination = "/partner/join?token=a&x=b#h";
    const versLogin = new URL(await redirectionPour(destination), "http://h");
    expect(versLogin.pathname).toBe("/login");
    const retour = new URL(versLogin.searchParams.get("next") ?? "", "http://h");
    expect(retour.pathname).toBe("/mfa/enroll");
    expect(retour.searchParams.get("next")).toBe(destination);
  });
});
