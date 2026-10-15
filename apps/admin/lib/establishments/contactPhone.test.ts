import { describe, expect, it } from "vitest";
import { contactPhoneIfChanged, contactPhoneIfFilled, isContactPhoneInvalid } from "./contactPhone";

describe("contactPhone", () => {
  it("E.164 : vide valide (retire le bouton), numéro national refusé", () => {
    expect(isContactPhoneInvalid("")).toBe(false);
    expect(isContactPhoneInvalid("  ")).toBe(false);
    expect(isContactPhoneInvalid("+573001234567")).toBe(false);
    expect(isContactPhoneInvalid("3001234567")).toBe(true);
    expect(isContactPhoneInvalid("+0573001234567")).toBe(true);
  });

  it("édition : la clé n'entre que si le numéro a changé, et vide part à null", () => {
    expect(contactPhoneIfChanged("+573001234567", " +573001234567 ")).toEqual({});
    expect(contactPhoneIfChanged("+573001234567", "+573009998877")).toEqual({ contact_phone: "+573009998877" });
    expect(contactPhoneIfChanged("+573001234567", "")).toEqual({ contact_phone: null });
  });

  it("création : la clé seulement si un numéro est saisi", () => {
    expect(contactPhoneIfFilled("")).toEqual({});
    expect(contactPhoneIfFilled(" +573001234567 ")).toEqual({ contact_phone: "+573001234567" });
  });
});
