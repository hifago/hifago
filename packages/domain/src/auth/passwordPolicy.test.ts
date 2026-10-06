import { readdirSync, readFileSync } from "node:fs";
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

// Les comptes créés par les seeds passent par Supabase Auth : un mot de passe hors règle y serait
// refusé, ou contredirait la règle déclarée. Toute fixture qui en pose un est relue ici.
describe("mots de passe des seeds — conformes à la règle", () => {
  const racine = new URL("../../../../", import.meta.url);

  it("mockData/partners/*.json", () => {
    const dossier = new URL("mockData/partners/", racine);
    const motsDePasse = readdirSync(dossier)
      .filter((nom) => nom.endsWith(".json"))
      .map((nom) => ({
        nom,
        password: (JSON.parse(readFileSync(new URL(nom, dossier), "utf-8")) as { person?: { password?: string } })
          .person?.password,
      }))
      .filter((fixture): fixture is { nom: string; password: string } => typeof fixture.password === "string");

    expect(motsDePasse.length).toBeGreaterThan(0);
    expect(motsDePasse.filter((fixture) => !meetsPasswordPolicy(fixture.password)).map((f) => f.nom)).toEqual([]);
  });

  it("supabase/scripts/seed_auth_users.mjs", () => {
    const script = readFileSync(new URL("supabase/scripts/seed_auth_users.mjs", racine), "utf-8");
    const valeur = /const SEED_PASSWORD = "([^"]+)";/.exec(script)?.[1];
    expect(valeur).toBeDefined();
    expect(meetsPasswordPolicy(valeur!)).toBe(true);
  });
});
