import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// La garde commune de l'espace socio. Ce fichier prouve qu'une panne de `partner_id_for_account`
// lève (app/error.tsx propose de réessayer) au lieu d'être prise pour « aucune organisation » —
// ce qui rendait la nav socio amputée de tous les écrans d'operator.

class Redirection extends Error {
  constructor(readonly url: string) {
    super(url);
  }
}

let utilisateur: { id: string; is_anonymous?: boolean } | null = null;
let partnerId: { data: unknown; error: { message: string } | null } = { data: "p-1", error: null };
const capaciteLue = vi.fn(async (_supabase: unknown, _partnerId: string | null) => true);

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirection(url);
  },
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: utilisateur } }) },
    rpc: async () => partnerId,
  }),
}));

vi.mock("@/lib/agenda/activeOperatorEstablishments", () => ({
  getOperatorCapability: (supabase: unknown, id: string | null) => capaciteLue(supabase, id),
}));

vi.mock("./PartnerAppNav", () => ({
  PartnerAppNav: ({ hasOperatorCapability }: { hasOperatorCapability: boolean }) => (
    <p data-testid="nav">{String(hasOperatorCapability)}</p>
  ),
}));

const { default: PartnerAppLayout } = await import("./layout");

async function rendre() {
  return PartnerAppLayout({ children: <p>contenu</p> } as never);
}

describe("/partner — garde commune", () => {
  beforeEach(() => {
    utilisateur = { id: "u" };
    partnerId = { data: "p-1", error: null };
    capaciteLue.mockClear();
  });

  it("sans session, renvoie à /login avec retour sur /partner", async () => {
    utilisateur = null;
    await expect(rendre()).rejects.toMatchObject({ url: "/login?next=/partner" });
  });

  it("session anonyme (panier de la vitrine) : renvoie à /login, sans coquille socio", async () => {
    utilisateur = { id: "anon", is_anonymous: true };
    await expect(rendre()).rejects.toMatchObject({ url: "/login?next=/partner" });
  });

  it("lève quand l'organisation est illisible, sans rendre de nav amputée", async () => {
    partnerId = { data: null, error: { message: "connection refused" } };
    await expect(rendre()).rejects.toThrow(/partner_id_for_account/);
    expect(capaciteLue).not.toHaveBeenCalled();
  });

  it("rend la nav selon la capacité operator de l'organisation lue", async () => {
    render(await rendre());
    expect(capaciteLue).toHaveBeenCalledWith(expect.anything(), "p-1");
    expect(screen.getByTestId("nav").textContent).toBe("true");
    expect(screen.getByText("contenu")).toBeTruthy();
  });
});
