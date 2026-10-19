import { describe, expect, it } from "vitest";
import {
  colombianWhatsAppError,
  colombianWhatsAppReasonMessage,
  localPartOfColombianWhatsApp,
  toColombianWhatsApp,
} from "./colombianWhatsApp";

describe("toColombianWhatsApp", () => {
  it("préfixe les 10 chiffres saisis derrière +57", () => {
    expect(toColombianWhatsApp("3001234567")).toBe("+573001234567");
  });

  it("tolère espaces et tirets d'un numéro collé", () => {
    expect(toColombianWhatsApp("300 123-4567")).toBe("+573001234567");
  });

  it("ne double pas un indicatif déjà présent", () => {
    expect(toColombianWhatsApp("+57 300 123 4567")).toBe("+573001234567");
    expect(toColombianWhatsApp("573001234567")).toBe("+573001234567");
  });

  it("refuse ce qui n'a pas 10 chiffres", () => {
    expect(toColombianWhatsApp("300123456")).toBeNull();
    expect(toColombianWhatsApp("30012345678")).toBeNull();
    expect(toColombianWhatsApp("")).toBeNull();
  });

  it("refuse un numéro étranger", () => {
    expect(toColombianWhatsApp("+33 6 12 34 56 78")).toBeNull();
  });
});

describe("localPartOfColombianWhatsApp", () => {
  it("retire le préfixe d'un numéro stocké", () => {
    expect(localPartOfColombianWhatsApp("+573001234567")).toBe("3001234567");
  });

  it("rend une chaîne vide quand rien n'est stocké", () => {
    expect(localPartOfColombianWhatsApp(null)).toBe("");
  });
});

describe("colombianWhatsAppError", () => {
  it("un champ vide est une erreur : le numéro est obligatoire", () => {
    expect(colombianWhatsAppError("  ")).toMatch(/obligatorio/);
  });

  it("aucune erreur pour un numéro valide", () => {
    expect(colombianWhatsAppError("3001234567")).toBeNull();
  });
});

describe("colombianWhatsAppReasonMessage", () => {
  it("traduit les motifs des RPC, et rien d'autre", () => {
    expect(colombianWhatsAppReasonMessage("contact_phone_required")).toMatch(/obligatorio/);
    expect(colombianWhatsAppReasonMessage("invalid_phone")).toMatch(/\+57/);
    expect(colombianWhatsAppReasonMessage("version_conflict")).toBeNull();
  });
});
