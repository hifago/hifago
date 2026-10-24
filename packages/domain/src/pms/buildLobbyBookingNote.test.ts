import { describe, expect, it } from "vitest";
import { buildLobbyBookingNote } from "./buildLobbyBookingNote";

describe("buildLobbyBookingNote", () => {
  it("garde l'identifiant technique en tête, seul repère fiable", () => {
    expect(buildLobbyBookingNote({ orderLineId: "abc-123" })).toBe("hifago order_line abc-123");
  });

  it("assemble tous les champs disponibles dans l'ordre du format v1", () => {
    expect(
      buildLobbyBookingNote({
        orderLineId: "abc-123",
        promoCode: "GUABANIA",
        phone: "+573001245678",
        email: "cliente@example.com",
        source: "qr",
      })
    ).toBe(
      "hifago order_line abc-123 | PROMO:GUABANIA | WA:+573001245678 | MAIL:cliente@example.com | SRC:qr"
    );
  });

  it("dit ce que le client a déjà payé, juste après l'identifiant technique", () => {
    expect(
      buildLobbyBookingNote({
        orderLineId: "x",
        advancePaidCop: 150000,
        balanceCop: 1350000,
        promoCode: "GUABANIA",
      })
    ).toBe("hifago order_line x | Anticipo pagado en hifago: $150.000 — saldo: $1.350.000 | PROMO:GUABANIA");
  });

  it("n'écrit aucune mention d'acompte s'il est nul, absent ou sans solde connu", () => {
    expect(buildLobbyBookingNote({ orderLineId: "x", advancePaidCop: 0, balanceCop: 100 })).toBe("hifago order_line x");
    expect(buildLobbyBookingNote({ orderLineId: "x", advancePaidCop: 100 })).toBe("hifago order_line x");
    expect(buildLobbyBookingNote({ orderLineId: "x", advancePaidCop: null, balanceCop: null })).toBe(
      "hifago order_line x"
    );
  });

  it("omet un champ absent, vide ou blanc — jamais un libellé sans valeur", () => {
    expect(
      buildLobbyBookingNote({ orderLineId: "x", promoCode: null, phone: "   ", email: undefined })
    ).toBe("hifago order_line x");
  });

  it("neutralise le séparateur dans les valeurs, sinon la note se coupe en champs fantômes", () => {
    expect(buildLobbyBookingNote({ orderLineId: "x", promoCode: "A|B" })).toBe(
      "hifago order_line x | PROMO:A B"
    );
  });

  it("aplatit les retours à la ligne et les espaces multiples", () => {
    expect(buildLobbyBookingNote({ orderLineId: "x", source: "web\n\ncampagne   été" })).toBe(
      "hifago order_line x | SRC:web campagne été"
    );
  });

  it("n'expose jamais la pièce d'identité, même si l'appelant en fournit une", () => {
    const note = buildLobbyBookingNote({
      orderLineId: "x",
      email: "a@b.co",
      // @ts-expect-error — champ volontairement absent du contrat : la v1 l'envoyait, pas nous.
      document: "CC 1234567890",
    });
    expect(note).not.toContain("1234567890");
    expect(note).not.toContain("DOC");
  });
});
