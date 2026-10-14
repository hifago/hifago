import { describe, expect, it } from "vitest";
import {
  buildWhatsAppLink,
  SUPPORT_ACCOUNT_MESSAGE,
  SUPPORT_WHATSAPP_NUMBER,
  supportReferralCodeMessage,
} from "./whatsapp";

// Les messages de support de l'espace socio s'adressent à l'équipe, jamais à une personne nommée.

describe("messages de support WhatsApp", () => {
  it("compte de socio : message neutre", () => {
    expect(SUPPORT_ACCOUNT_MESSAGE).toBe(
      "Hola equipo Hifago, tengo un problema con mi cuenta de socio. ¿Me pueden ayudar?"
    );
  });

  it("lien/QR de vente : message neutre, avec le code du socio", () => {
    expect(supportReferralCodeMessage("MOCK-1")).toBe(
      'Hola equipo Hifago, soy "MOCK-1", tengo un problema con mi enlace/QR de venta. ¿Me pueden ayudar?'
    );
  });

  it.each([[SUPPORT_ACCOUNT_MESSAGE], [supportReferralCodeMessage("X")]])("ne nomme personne : %s", (message) => {
    expect(message).not.toMatch(/J[ée]r[oó]me/i);
  });

  it("lien wa.me vers le numéro de support, message encodé", () => {
    expect(buildWhatsAppLink(SUPPORT_WHATSAPP_NUMBER, SUPPORT_ACCOUNT_MESSAGE)).toBe(
      `https://wa.me/573215764841?text=${encodeURIComponent(SUPPORT_ACCOUNT_MESSAGE)}`
    );
  });
});
