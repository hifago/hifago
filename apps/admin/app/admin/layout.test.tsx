import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// La garde de tout /admin. Ce fichier prouve deux choses : une panne de la base n'est jamais lue
// comme « pas admin » (elle lève, et app/error.tsx l'affiche), et un compte connecté sans rôle
// admin est renvoyé à l'aiguillage `/` — jamais à /login, qui le renvoyait à /admin en boucle.

class Redirection extends Error {
  constructor(readonly url: string) {
    super(url);
  }
}

type Reponse = { data?: unknown; count?: number | null; error: { message: string } | null };

let utilisateur: { id: string; is_anonymous?: boolean } | null = null;
let isAdmin: Reponse = { data: true, error: null };
let comptes: Record<string, Reponse> = {};
let lectures: string[] = [];

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirection(url);
  },
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: utilisateur } }) },
    rpc: async (nom: string) =>
      nom === "is_admin" ? isAdmin : { data: null, error: { message: `rpc ${nom} inattendue` } },
    from: (table: string) => {
      lectures.push(table);
      return { select: () => ({ eq: async () => comptes[table] }) };
    },
  }),
}));

vi.mock("./AdminNav", () => ({
  AdminNav: ({ pendingProposalsCount }: { pendingProposalsCount: number }) => (
    <p data-testid="pastille">{pendingProposalsCount}</p>
  ),
}));

const { default: AdminLayout } = await import("./layout");

async function rendre() {
  return AdminLayout({ children: <p>contenu</p> } as never);
}

async function redirection() {
  try {
    await rendre();
  } catch (e) {
    if (e instanceof Redirection) return e.url;
    throw e;
  }
  throw new Error("aucune redirection");
}

describe("/admin — garde", () => {
  beforeEach(() => {
    utilisateur = { id: "u" };
    isAdmin = { data: true, error: null };
    lectures = [];
    comptes = {
      product_proposals: { count: 2, error: null },
      establishment_proposals: { count: 1, error: null },
    };
  });

  it("sans session, renvoie à /login avec retour sur /admin", async () => {
    utilisateur = null;
    expect(await redirection()).toBe("/login?next=/admin");
  });

  it("session anonyme (panier de la vitrine) : renvoie à /login, jamais à l'aiguillage", async () => {
    utilisateur = { id: "anon", is_anonymous: true };
    expect(await redirection()).toBe("/login?next=/admin");
  });

  it("connecté sans rôle admin (socio), renvoie à l'aiguillage / — jamais à /login", async () => {
    isAdmin = { data: false, error: null };
    expect(await redirection()).toBe("/");
  });

  it("lève quand le rôle admin est indéterminable, au lieu de déconnecter", async () => {
    isAdmin = { data: null, error: { message: "connection refused" } };
    await expect(rendre()).rejects.toThrow(/is_admin/);
    expect(lectures).toEqual([]);
  });

  it.each([["product_proposals"], ["establishment_proposals"]])(
    "lève quand le compte des propositions en attente (%s) échoue, au lieu d'afficher 0",
    async (table) => {
      comptes[table] = { count: null, error: { message: "timeout" } };
      await expect(rendre()).rejects.toThrow(table);
    }
  );

  it("admin : rend la navigation avec la somme des propositions en attente", async () => {
    render(await rendre());
    expect(screen.getByTestId("pastille").textContent).toBe("3");
    expect(screen.getByText("contenu")).toBeTruthy();
  });
});
