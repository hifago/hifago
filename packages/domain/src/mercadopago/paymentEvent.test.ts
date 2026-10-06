import { describe, expect, it } from "vitest";
import { exploitableAmount, toPaymentEvent } from "./paymentEvent";

// Forme d'une réponse GET /v1/payments/{id} — avec ce que l'événement conservé ne doit JAMAIS
// porter (coordonnées du payeur).
const PAYMENT = {
  id: 123456789,
  status: "approved",
  status_detail: "accredited",
  transaction_amount: 34000,
  currency_id: "COP",
  date_created: "2026-10-04T10:00:00.000-05:00",
  date_approved: "2026-10-04T10:00:05.000-05:00",
  external_reference: "9b930000-0000-4000-8000-000000000001",
  collector_id: 987654,
  payer: { email: "payeur@example.com", identification: { type: "CC", number: "1234567890" } },
};

describe("exploitableAmount", () => {
  it("rend le montant d'un paiement en COP", () => {
    expect(exploitableAmount(PAYMENT)).toBe(34000);
  });

  it.each([
    ["une autre devise", { ...PAYMENT, currency_id: "USD" }],
    ["une devise absente", { ...PAYMENT, currency_id: undefined }],
    ["un montant absent", { ...PAYMENT, transaction_amount: undefined }],
    ["un montant non fini", { ...PAYMENT, transaction_amount: Number.NaN }],
  ])("null pour %s (échec fermé côté base)", (_cas, payment) => {
    expect(exploitableAmount(payment)).toBeNull();
  });
});

describe("toPaymentEvent", () => {
  it("aplatit : jamais le payeur, montant exploitable et montant brut séparés", () => {
    const event = toPaymentEvent({ ...PAYMENT, currency_id: "USD" }, null, null);
    expect(event).toEqual({
      mp_payment_id: "123456789",
      status: "approved",
      status_detail: "accredited",
      transaction_amount: null,
      mp_transaction_amount: 34000,
      currency_id: "USD",
      date_created: PAYMENT.date_created,
      date_approved: PAYMENT.date_approved,
      external_reference: PAYMENT.external_reference,
      collector_id: "987654",
      webhook_body: null,
    });
    expect(JSON.stringify(event)).not.toContain("payeur@example.com");
  });

  it("garde le corps du webhook quand il y en a un", () => {
    expect(toPaymentEvent(PAYMENT, 34000, { type: "payment" }).webhook_body).toEqual({ type: "payment" });
  });
});
