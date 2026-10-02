// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// L'aiguillage de la racine décide où atterrit chaque compte connecté, d'après trois lectures de
// rôle. Ce fichier prouve qu'une lecture en panne lève (app/error.tsx propose de réessayer) au lieu
// d'être prise pour « pas ce rôle » : un admin en panne de base n'est jamais envoyé sur /partner.

class Redirection extends Error {
  constructor(readonly url: string) {
    super(url);
  }
}

type Reponse = { data: unknown; error: { message: string } | null };

let utilisateur: { id: string; is_anonymous?: boolean } | null = null;
let roles: Record<string, Reponse> = {};

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirection(url);
  },
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: utilisateur } }) },
    rpc: async (nom: string, args: { p_role?: string }) =>
      roles[nom === "has_capability" ? (args.p_role ?? "") : nom],
  }),
}));

const { default: RootPage } = await import("./page");

async function destination() {
  try {
    await RootPage();
  } catch (e) {
    if (e instanceof Redirection) return e.url;
    throw e;
  }
  throw new Error("aucune redirection");
}

const NON: Reponse = { data: false, error: null };
const OUI: Reponse = { data: true, error: null };
const PANNE: Reponse = { data: null, error: { message: "connection refused" } };

describe("/ — aiguillage", () => {
  beforeEach(() => {
    utilisateur = { id: "u" };
    roles = { is_admin: NON, operator: NON, referrer: NON };
  });

  it("sans session, renvoie à /login", async () => {
    utilisateur = null;
    expect(await destination()).toBe("/login");
  });

  it("session anonyme (panier de la vitrine) : renvoie à /login, jamais à l'espace socio", async () => {
    utilisateur = { id: "anon", is_anonymous: true };
    expect(await destination()).toBe("/login");
  });

  it.each([
    ["is_admin", "/admin"],
    ["operator", "/partner/establishment"],
    ["referrer", "/partner/commissions"],
  ])("rôle %s → %s", async (role, attendu) => {
    roles[role] = OUI;
    expect(await destination()).toBe(attendu);
  });

  it("aucun rôle → /partner (écran « sin rol »)", async () => {
    expect(await destination()).toBe("/partner");
  });

  it.each([["is_admin"], ["operator"], ["referrer"]])(
    "lève quand la lecture du rôle %s échoue, au lieu d'aiguiller ailleurs",
    async (role) => {
      roles[role] = PANNE;
      await expect(RootPage()).rejects.toThrow(role);
    }
  );
});
