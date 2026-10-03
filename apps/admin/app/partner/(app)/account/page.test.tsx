import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// « Mi cuenta » du socio. Ce fichier prouve : (1) que le compte Mercado Pago enregistré n'atteint
// JAMAIS le rendu en entier — seuls ses derniers caractères quittent le serveur (cahier socio,
// décision du 2026-08-11) ; (2) qu'une lecture en panne lève au lieu de rendre un profil vide
// (qu'un enregistrement écraserait) ou de masquer le bloc de paiement.

type Reponse = { data: unknown; error: { message: string } | null };

const COMPTE_COMPLET = "referente.complet@mp.test";

let reponses: Record<string, Reponse> = {};
let filtres: Record<string, string[]> = {};

function chaine(table: string) {
  const etapes: string[] = (filtres[table] = []);
  const c = {
    select: () => c,
    eq: () => c,
    limit: (n: number) => (etapes.push(`limit:${n}`), c),
    maybeSingle: async () => reponses[table],
  };
  return c;
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  useRouter: () => ({ refresh: () => {} }),
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u", email: "r@hifago.test" } } }) },
    from: (table: string) => chaine(table),
  }),
}));

vi.mock("@hifago/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/components/LogoutButton", () => ({ LogoutButton: () => null }));
vi.mock("./ProfileBlock", () => ({ ProfileBlock: () => null }));
vi.mock("./EmailBlock", () => ({ EmailBlock: () => null }));
vi.mock("./PasswordBlock", () => ({ PasswordBlock: () => null }));

const { default: PartnerAccountPage } = await import("./page");

const PANNE = { data: null, error: { message: "connection refused" } };

describe("/partner/account", () => {
  beforeEach(() => {
    filtres = {};
    reponses = {
      partner_accounts: { data: { full_name: "R", phone: null, partner_id: "p-1" }, error: null },
      partner_capabilities: { data: { id: "c-1" }, error: null },
      partner_payout_accounts: { data: { mercadopago_account: COMPTE_COMPLET }, error: null },
    };
  });

  it("le compte enregistré n'apparaît que par ses derniers caractères, jamais en entier", async () => {
    const { container } = render(await PartnerAccountPage());
    expect(container.innerHTML).not.toContain(COMPTE_COMPLET);
    expect(container.innerHTML).not.toContain("referente.complet");
    expect(screen.getByTestId("payout-account-registered").textContent).toContain("••••test");
    expect(screen.getByTestId("payout-mercadopago-account-input")).toHaveProperty("value", "");
  });

  it("sans compte enregistré : pas de mention « registrada », champ vide", async () => {
    reponses.partner_payout_accounts = { data: null, error: null };
    render(await PartnerAccountPage());
    expect(screen.queryByTestId("payout-account-registered")).toBeNull();
    expect(screen.getByTestId("payout-mercadopago-account-input")).toHaveProperty("value", "");
  });

  it("capacité referrer : une seule ligne lue (plusieurs ne font pas échouer la lecture)", async () => {
    render(await PartnerAccountPage());
    expect(filtres.partner_capabilities).toContain("limit:1");
  });

  it.each([["partner_accounts"], ["partner_capabilities"], ["partner_payout_accounts"]])(
    "lecture %s en panne : la page lève",
    async (table) => {
      reponses[table] = PANNE;
      await expect(PartnerAccountPage()).rejects.toThrow(table);
    }
  );
});
