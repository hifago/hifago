import { describe, expect, it } from "vitest";
import { buildProfileChanges, parseTags, socialHref, type PartnerProfile } from "./partnerProfile";

const initial: PartnerProfile = {
  display_name: "Casa Kayam",
  legal_name: "",
  identification_type: "NIT",
  identification_number: "900",
  partner_city: "Guatapé",
  email: "a@b.co",
  phone: "+573000000000",
  instagram: "",
  facebook: "",
  website: "",
  barrio: "Centro",
  notes: "",
  commercial_status: "prospecto",
  tags: "kayak, lago",
};

describe("buildProfileChanges", () => {
  it("rien de modifié (espaces compris) : objet vide, le moyen de paiement gardé", () => {
    expect(
      buildProfileChanges(initial, { ...initial, email: " a@b.co ", tags: "kayak,lago, kayak" }, { action: "keep" }),
    ).toEqual({});
  });

  it("seuls les champs modifiés partent ; un champ vidé part en null", () => {
    expect(
      buildProfileChanges(
        initial,
        { ...initial, phone: "", instagram: " @casakayam ", commercial_status: "activo", tags: "lago" },
        { action: "keep" },
      ),
    ).toEqual({ phone: null, instagram: "@casakayam", commercial_status: "activo", tags: ["lago"] });
  });

  it("moyen de paiement : remplacé en entier, ou effacé", () => {
    expect(
      buildProfileChanges(initial, initial, { action: "nequi", nombre: " Ana ", telefono: "300 " }),
    ).toEqual({ bank: { nombre: "Ana", nequi: { telefono: "300" } } });
    expect(buildProfileChanges(initial, initial, { action: "remove" })).toEqual({ bank: null });
  });
});

describe("parseTags", () => {
  it("rogne, ignore les vides, dédoublonne dans l'ordre", () => {
    expect(parseTags(" kayak, ,lago,kayak ")).toEqual(["kayak", "lago"]);
  });
});

describe("socialHref", () => {
  it("pseudo, URL complète, domaine sans schéma", () => {
    expect(socialHref("instagram", "@casa.kayam")).toBe("https://instagram.com/casa.kayam");
    expect(socialHref("facebook", "casakayam")).toBe("https://facebook.com/casakayam");
    expect(socialHref("facebook", "facebook.com/casakayam")).toBe("https://facebook.com/casakayam");
    expect(socialHref("website", "casakayam.com")).toBe("https://casakayam.com");
    expect(socialHref("website", "https://x.co/a")).toBe("https://x.co/a");
  });

  it("texte qui n'est pas un lien : null (affiché tel quel)", () => {
    expect(socialHref("instagram", "")).toBeNull();
    expect(socialHref("instagram", "Casa Kayam oficial")).toBeNull();
    expect(socialHref("website", "pas de site")).toBeNull();
  });
});
