import { describe, expect, it } from "vitest";
import {
  ESTABLISHMENT_DESCRIPTION_MAX,
  descriptionLength,
  establishmentDescriptionError,
} from "./descriptionLimit";

describe("establishmentDescriptionError", () => {
  it("accepte exactement 600 caractères dans chaque langue", () => {
    const text = "x".repeat(ESTABLISHMENT_DESCRIPTION_MAX);
    expect(ESTABLISHMENT_DESCRIPTION_MAX).toBe(600);
    expect(establishmentDescriptionError(text, text)).toBeNull();
  });

  it("refuse 601 caractères et nomme la langue en cause", () => {
    const tooLong = "x".repeat(ESTABLISHMENT_DESCRIPTION_MAX + 1);
    expect(establishmentDescriptionError(tooLong, "")).toMatch(/\(ES\).*600/);
    expect(establishmentDescriptionError("", tooLong)).toMatch(/\(EN\).*600/);
  });

  it("ne compte pas les espaces de début et de fin, retirés à l'enregistrement", () => {
    const text = `  ${"x".repeat(ESTABLISHMENT_DESCRIPTION_MAX)}  `;
    expect(establishmentDescriptionError(text, "")).toBeNull();
  });

  it("compte un emoji pour un caractère, comme char_length de Postgres", () => {
    expect(descriptionLength("🌴")).toBe(1);
    expect(establishmentDescriptionError("🌴".repeat(ESTABLISHMENT_DESCRIPTION_MAX), "")).toBeNull();
  });
});
