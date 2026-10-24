import { describe, expect, it } from "vitest";
import { acompteDue, displayLineStatus, isAwaitingPayment, orderPaymentState } from "./paymentDisplay";

describe("orderPaymentState", () => {
  it.each([
    ["paid", 17000, "paid"],
    ["partially_refunded", 17000, "paid"],
    ["refunded", 17000, "refunded"],
    ["pending", 17000, "in_progress"],
    ["unpaid", 17000, "unpaid"],
  ])("%s avec %s COP dus → %s", (status, due, attendu) => {
    expect(orderPaymentState(status, due)).toBe(attendu);
  });

  it("une commande SANS acompte dû (evento gratuit / sur place) n'est jamais « impayée »", () => {
    expect(orderPaymentState("unpaid", 0)).toBe("not_due");
  });

  it("acompte inconnu (null) → dû : échec fermé, jamais une réservation impayée présentée comme ferme", () => {
    expect(orderPaymentState("unpaid", null)).toBe("unpaid");
    expect(orderPaymentState("pending", null)).toBe("in_progress");
  });

  it("une commande payée l'est quel que soit l'acompte lu", () => {
    expect(orderPaymentState("paid", 0)).toBe("paid");
  });
});

describe("displayLineStatus", () => {
  it("une ligne `reserved` d'une commande qui attend son paiement devient `pending_payment`", () => {
    expect(displayLineStatus("reserved", "unpaid")).toBe("pending_payment");
    expect(displayLineStatus("reserved", "in_progress")).toBe("pending_payment");
  });

  it("une ligne `reserved` d'une commande payée, remboursée ou sans acompte dû reste `reserved`", () => {
    expect(displayLineStatus("reserved", "paid")).toBe("reserved");
    expect(displayLineStatus("reserved", "not_due")).toBe("reserved");
    expect(displayLineStatus("reserved", "refunded")).toBe("reserved");
  });

  it.each(["fulfilled", "no_show", "cancelled_by_client", "cancelled_by_provider", "expired", "superseded"])(
    "le statut %s n'est jamais réécrit, même sur une commande impayée",
    (status) => {
      expect(displayLineStatus(status, "unpaid")).toBe(status);
    }
  );
});

describe("acompteDue / isAwaitingPayment", () => {
  it("ne somme que les lignes vivantes, quelle que soit la casse du champ", () => {
    expect(
      acompteDue([
        { status: "reserved", acompte_cop: 17000 },
        { status: "cancelled_by_client", acompte_cop: 50000 },
        { status: "expired", acompteCop: 9000 },
        { status: "fulfilled", acompteCop: 3000 },
        { status: "reserved", acompte_cop: null },
      ])
    ).toBe(20000);
  });

  it("attend un paiement : non payée ou en cours, rien d'autre", () => {
    expect(["paid", "in_progress", "unpaid", "refunded", "not_due"].filter((s) => isAwaitingPayment(s as never))).toEqual([
      "in_progress",
      "unpaid",
    ]);
  });
});
