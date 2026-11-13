import { describe, expect, it } from "vitest";
import { deriveLedgerEntry, type LedgerLineInput } from "./deriveLedgerEntry";

// Recommandation externe : total 100 000, acompte 17 000, référent 8 000, app 9 000 — part
// structurelle du prestataire 100 000 − 17 000 = 83 000.
const LINE: Omit<LedgerLineInput, "lineStatus" | "commissionEntry" | "compensationEntry"> = {
  totalCop: 100000,
  acompteCop: 17000,
  referrerCommissionCop: 8000,
  appCommissionCop: 9000,
};

describe("deriveLedgerEntry — lu dans le vrai ledger", () => {
  it.each([
    ["estimated", "reserved"],
    ["due", "fulfilled"],
    ["paid", "fulfilled"],
  ])("commission %s : son statut réel, sa part référent", (status, lineStatus) => {
    expect(
      deriveLedgerEntry({
        ...LINE,
        lineStatus,
        commissionEntry: { status, amountCop: 8000 },
        compensationEntry: null,
      })
    ).toEqual({
      appDueCop: 9000,
      referrerDueCop: 8000,
      providerDueCop: 83000,
      display: { kind: "commission", status },
    });
  });

  it("« Pagada » s'affiche — l'ancienne dérivation ne pouvait jamais la produire", () => {
    const view = deriveLedgerEntry({
      ...LINE,
      lineStatus: "fulfilled",
      commissionEntry: { status: "paid", amountCop: 8000 },
      compensationEntry: null,
    });
    expect(view.display).toEqual({ kind: "commission", status: "paid" });
  });

  it("annulation client PAYÉE : la compensation réelle part au prestataire", () => {
    expect(
      deriveLedgerEntry({
        ...LINE,
        lineStatus: "cancelled_by_client",
        commissionEntry: { status: "void", amountCop: 8000 },
        compensationEntry: { status: "due", amountCop: 8000 },
      })
    ).toEqual({
      appDueCop: 9000,
      referrerDueCop: 0,
      providerDueCop: 91000,
      display: { kind: "compensation", status: "due" },
    });
  });

  it.each(["expired", "cancelled_by_client"])(
    "%s sans acompte payé : aucune compensation, donc rien de « redistribué »",
    (lineStatus) => {
      expect(
        deriveLedgerEntry({
          ...LINE,
          lineStatus,
          commissionEntry: { status: "void", amountCop: 8000 },
          compensationEntry: null,
        })
      ).toEqual({ appDueCop: 0, referrerDueCop: 0, providerDueCop: 0, display: { kind: "commission", status: "void" } });
    }
  );

  it("annulation prestataire : commission reprise, rien n'est dû", () => {
    expect(
      deriveLedgerEntry({
        ...LINE,
        lineStatus: "cancelled_by_provider",
        commissionEntry: { status: "reversed", amountCop: 8000 },
        compensationEntry: null,
      })
    ).toEqual({ appDueCop: 0, referrerDueCop: 0, providerDueCop: 0, display: { kind: "commission", status: "reversed" } });
  });

  it("option 17 % : la part référent est le montant NET du ledger, les frais sont dans la part app", () => {
    const view = deriveLedgerEntry({
      totalCop: 100000,
      acompteCop: 17000,
      referrerCommissionCop: 16150,
      appCommissionCop: 850,
      lineStatus: "fulfilled",
      commissionEntry: { status: "due", amountCop: 16150 },
      compensationEntry: null,
    });
    expect([view.appDueCop, view.referrerDueCop, view.providerDueCop]).toEqual([850, 16150, 83000]);
  });

  it("ligne directe : aucune entrée, « sin comisión »", () => {
    expect(
      deriveLedgerEntry({
        totalCop: 50000,
        acompteCop: 8500,
        referrerCommissionCop: 0,
        appCommissionCop: 8500,
        lineStatus: "reserved",
        commissionEntry: null,
        compensationEntry: null,
      })
    ).toEqual({ appDueCop: 8500, referrerDueCop: 0, providerDueCop: 41500, display: { kind: "none" } });
  });
});
