import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  meetsPasswordPolicy,
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIRED_CHARACTERS,
} from "./passwordPolicy";

const politique = JSON.parse(
  readFileSync(new URL("../../../../supabase/auth-policy.json", import.meta.url), "utf-8")
) as { password_min_length: number; password_required_characters: string };

describe("meetsPasswordPolicy — miroir de la règle de Supabase Auth", () => {
  it("accepte 8 caractères avec au moins une lettre et un chiffre", () => {
    expect(meetsPasswordPolicy("abcdefg1")).toBe(true);
    expect(meetsPasswordPolicy("1234567A")).toBe(true);
    expect(meetsPasswordPolicy("Seed1234!")).toBe(true);
  });

  it("refuse moins de 8 caractères, même avec lettres et chiffres", () => {
    expect(meetsPasswordPolicy("abcdef1")).toBe(false);
    expect(meetsPasswordPolicy("")).toBe(false);
  });

  it("refuse un mot de passe sans chiffre ou sans lettre", () => {
    expect(meetsPasswordPolicy("abcdefgh")).toBe(false);
    expect(meetsPasswordPolicy("12345678")).toBe(false);
    expect(meetsPasswordPolicy("!!!!!!!!1")).toBe(false);
  });

  it("une lettre accentuée ne compte pas comme une lettre (jeux ASCII de GoTrue)", () => {
    expect(meetsPasswordPolicy("ñññññññ1")).toBe(false);
    expect(meetsPasswordPolicy("ñññññññ1a")).toBe(true);
  });

  it("porte les valeurs attendues sur les projets cloud (supabase/auth-policy.json)", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(politique.password_min_length);
    expect(PASSWORD_REQUIRED_CHARACTERS).toBe(politique.password_required_characters);
  });
});
