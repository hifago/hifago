// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveMissingEstablishmentPartners } from "./resolveMissingEstablishment";

// Une invitation « Prestador » consommée reste actionnable tant que son partenaire n'a pas
// d'établissement. Une panne de lecture ne doit JAMAIS se lire « établissement rattaché ».

type Reponse = { data: unknown; error: { message: string } | null };

function client(reponses: Record<string, Reponse>) {
  return {
    from: (table: string) => {
      const requete = {
        select: () => requete,
        in: () => requete,
        eq: () => requete,
        is: () => requete,
        then: (resoudre: (r: Reponse) => unknown) => resoudre(reponses[table] ?? { data: [], error: null }),
      };
      return requete;
    },
  } as never;
}

const INVITATION = {
  id: "inv-1",
  status: "consumed",
  onboarding_path: "provider",
  partner_id: null,
  consumed_by_account_id: "acc-1",
};

describe("resolveMissingEstablishmentPartners", () => {
  it("résout le partenaire du compte et signale l'établissement manquant", async () => {
    const resultat = await resolveMissingEstablishmentPartners(
      client({
        partner_accounts: { data: [{ id: "acc-1", partner_id: "p-1" }], error: null },
        partner_capabilities: { data: [{ partner_id: "p-1" }], error: null },
      }),
      [INVITATION]
    );
    expect(resultat.resolvedPartnerByInvitation.get("inv-1")).toBe("p-1");
    expect(resultat.missingEstablishmentByInvitation.get("inv-1")).toBe("p-1");
  });

  it.each([["partner_accounts"], ["partner_capabilities"]])(
    "panne de %s : lève, jamais « établissement rattaché »",
    async (table) => {
      const reponses: Record<string, Reponse> = {
        partner_accounts: { data: [{ id: "acc-1", partner_id: "p-1" }], error: null },
        partner_capabilities: { data: [{ partner_id: "p-1" }], error: null },
      };
      reponses[table] = { data: null, error: { message: "connection refused" } };
      await expect(resolveMissingEstablishmentPartners(client(reponses), [INVITATION])).rejects.toThrow(
        /Lecture impossible/
      );
    }
  );
});
