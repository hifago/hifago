import { describe, expect, it } from "vitest";
import { deriveOrderState, displayLineStatus, isDeadLine, DEAD_LINE_STATUSES } from "./orderState";

// Pas de @testing-library ici : fonction pure, aucun composant à monter.
describe("deriveOrderState", () => {
  it("rend « paid » dès que le paiement est encaissé, quels que soient les statuts de ligne", () => {
    expect(
      deriveOrderState({
        paymentStatus: "paid",
        lines: [{ status: "cancelled_by_client" }],
        acompteCop: 0,
      })
    ).toBe("paid");
  });

  // Retournement du 2026-10-23 : le booking Lobby se fait APRÈS l'acompte. Payé ≠ confirmé tant que le
  // prestataire n'a pas son booking — l'écran ne dit jamais « confirmada » avant.
  it("rend « confirming » pour une commande payée dont le booking Lobby est en cours", () => {
    expect(
      deriveOrderState({
        paymentStatus: "paid",
        lines: [{ status: "reserved" }],
        acompteCop: 100,
        pmsConfirmation: "pending",
      })
    ).toBe("confirming");
  });

  it("rend « paid_unconfirmed » quand le prestataire n'a pas pu confirmer — jamais « paid »", () => {
    expect(
      deriveOrderState({
        paymentStatus: "paid",
        lines: [{ status: "reserved" }],
        acompteCop: 100,
        pmsConfirmation: "failed",
      })
    ).toBe("paid_unconfirmed");
  });

  it("une commande payée sans pms_confirmation (ou à null) reste « paid »", () => {
    const base = { paymentStatus: "paid", lines: [{ status: "reserved" }], acompteCop: 100 };
    expect(deriveOrderState(base)).toBe("paid");
    expect(deriveOrderState({ ...base, pmsConfirmation: null })).toBe("paid");
  });

  it("pms_confirmation ne change rien à une commande non payée (aucun faux « confirming »)", () => {
    expect(
      deriveOrderState({
        paymentStatus: "unpaid",
        lines: [{ status: "reserved" }],
        acompteCop: 100,
        pmsConfirmation: "pending",
      })
    ).toBe("unpaid");
  });

  it("rend « awaiting » pendant que le webhook Mercado Pago n'est pas arrivé", () => {
    expect(
      deriveOrderState({ paymentStatus: "pending", lines: [{ status: "reserved" }], acompteCop: 0 })
    ).toBe("awaiting");
  });

  // Spec 39 D3 (2026-09-22) — trois cas que la revue adversariale du Lot B a fait entrer ici.
  it("rend « paid_not_honored » quand le client a payé une commande morte, AVANT « awaiting »", () => {
    // Order L du Lot A : paiement local resté `pending`, lignes expirées, entrée refund_required.
    expect(
      deriveOrderState({
        paymentStatus: "pending",
        lines: [{ status: "expired" }],
        acompteCop: 0,
        paymentReceivedNotHonored: true,
      })
    ).toBe("paid_not_honored");
  });

  it("ne rend jamais « awaiting » pour une commande sans ligne vivante — « se actualiza sola » pour toujours", () => {
    expect(
      deriveOrderState({ paymentStatus: "pending", lines: [{ status: "cancelled_by_client" }], acompteCop: 0 })
    ).toBe("cancelled");
    expect(
      deriveOrderState({ paymentStatus: "pending", lines: [{ status: "expired" }], acompteCop: 0 })
    ).toBe("expired");
  });

  it("rend « refunded » dès que l'argent est rendu, par le job ou hors hifago", () => {
    expect(
      deriveOrderState({
        paymentStatus: "unpaid",
        lines: [{ status: "expired" }],
        acompteCop: 0,
        paymentReceivedNotHonored: false,
        refundStatus: "approved",
      })
    ).toBe("refunded");
    expect(
      deriveOrderState({ paymentStatus: "refunded", lines: [{ status: "reserved" }], acompteCop: 17000 })
    ).toBe("refunded");
  });

  it("un remboursement en attente ou refusé laisse le client sur « te contactamos »", () => {
    expect(
      deriveOrderState({
        paymentStatus: "unpaid", lines: [{ status: "expired" }], acompteCop: 0,
        paymentReceivedNotHonored: true, refundStatus: "pending",
      })
    ).toBe("paid_not_honored");
    expect(
      deriveOrderState({
        paymentStatus: "unpaid", lines: [{ status: "expired" }], acompteCop: 0,
        paymentReceivedNotHonored: true, refundStatus: "rejected",
      })
    ).toBe("paid_not_honored");
  });

  it("rend « unpaid » tant qu'une prestation est encore vivante ET qu'un acompte est réellement dû en ligne", () => {
    expect(
      deriveOrderState({ paymentStatus: "unpaid", lines: [{ status: "reserved" }], acompteCop: 17000 })
    ).toBe("unpaid");
  });

  // Evento réservable en ligne (2026-09-15) — gratuit ou payable sur place : une prestation reste
  // vivante, mais aucun acompte n'est dû EN LIGNE (create_order force acompte_pct=0 pour ces
  // lignes, ou total_cop=0 si gratuit). Sans cette distinction, l'écran affichait un bouton
  // « Pagar » qui échouait au clic (create_payment_intent → nothing_to_pay).
  it("rend « confirmed » quand une prestation est vivante mais qu'aucun acompte n'est dû en ligne", () => {
    expect(
      deriveOrderState({ paymentStatus: "unpaid", lines: [{ status: "reserved" }], acompteCop: 0 })
    ).toBe("confirmed");
  });

  // ⚠️ Le cas qui distingue les deux fins : toutes les lignes sont mortes, et c'est l'expiration
  // qui décide du mot employé. Une commande dont le paiement n'est jamais arrivé n'a pas été
  // « anulada » par le client — le dire faussement lui ferait croire qu'il a agi.
  it("rend « expired » quand toutes les lignes sont mortes et qu'au moins une a expiré", () => {
    expect(
      deriveOrderState({
        paymentStatus: "unpaid",
        lines: [{ status: "expired" }, { status: "cancelled_by_client" }],
        acompteCop: 0,
      })
    ).toBe("expired");
  });

  it("rend « cancelled » quand toutes les lignes sont mortes sans aucune expiration", () => {
    expect(
      deriveOrderState({
        paymentStatus: "unpaid",
        lines: [{ status: "cancelled_by_client" }, { status: "cancelled_by_provider" }],
        acompteCop: 0,
      })
    ).toBe("cancelled");
  });

  // Une commande sans aucune ligne ne doit pas être annoncée « à payer » : il n'y a rien à payer.
  it("rend « cancelled » pour une commande sans aucune ligne", () => {
    expect(deriveOrderState({ paymentStatus: "unpaid", lines: [], acompteCop: 0 })).toBe("cancelled");
  });

  // Le piège nommé dans l'en-tête d'OrderResult : un paiement de trop qui échoue ne doit pas
  // rendre payable une commande déjà payée. Ce module ne connaît pas l'incident — il rend « paid »,
  // et c'est l'écran qui superpose « failed » sans jamais rouvrir le bouton de paiement.
  it("ne connaît pas l'incident de paiement : une commande payée reste « paid »", () => {
    expect(
      deriveOrderState({ paymentStatus: "paid", lines: [{ status: "reserved" }], acompteCop: 0 })
    ).toBe("paid");
  });
});

describe("isDeadLine", () => {
  it("reconnaît les quatre statuts qui ne comptent plus", () => {
    expect(DEAD_LINE_STATUSES.every(isDeadLine)).toBe(true);
  });

  it("laisse vivantes les prestations réservées, réalisées et absentes", () => {
    // `fulfilled` et `no_show` sont des lignes réellement dues : elles comptent dans les totaux,
    // exactement comme la RPC les y compte.
    expect(["reserved", "fulfilled", "no_show"].some(isDeadLine)).toBe(false);
  });
});

describe("displayLineStatus — une ligne `reserved` ne se lit pas « Reservada » sur une commande impayée", () => {
  it.each(["unpaid", "awaiting", "failed"] as const)("commande %s → pending_payment", (state) => {
    expect(displayLineStatus(state, "reserved")).toBe("pending_payment");
  });

  it.each(["paid", "confirming", "paid_unconfirmed", "confirmed", "refunded", "paid_not_honored"] as const)(
    "commande %s → la ligne reste reserved",
    (state) => {
      expect(displayLineStatus(state, "reserved")).toBe("reserved");
    }
  );

  it.each(["fulfilled", "no_show", "cancelled_by_client", "cancelled_by_provider", "expired", "superseded"])(
    "le statut %s n'est jamais réécrit, même sur une commande à payer",
    (status) => {
      expect(displayLineStatus("unpaid", status)).toBe(status);
    }
  );
});
