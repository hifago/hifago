// @vitest-environment node
import { describe, expect, it } from "vitest";
import { identidadCompleta, rellenarIdentidad, TELEFONO_LEGIBLE } from "./identidad";

const VIDE = { titular: null, nit: null, rnt: null, domicilio: null, correo: null };
const PLEINE = {
  titular: "Jerome Christian Filippi",
  nit: "901.000.000-1",
  rnt: "123456",
  domicilio: "Guatapé, Antioquia",
  correo: "hola@hifago.co",
};

describe("identité légale des pages institutionnelles", () => {
  it("une donnée manquante s'affiche comme à compléter, jamais comme un jeton brut", () => {
    expect(rellenarIdentidad("NIT: {nit}", "[por completar]", VIDE)).toBe("NIT: [por completar]");
  });

  it("une donnée renseignée remplace son jeton ; le téléphone vient du module de contact", () => {
    expect(rellenarIdentidad("{titular} · {telefono}", "?", PLEINE)).toBe(
      `Jerome Christian Filippi · ${TELEFONO_LEGIBLE}`
    );
    expect(TELEFONO_LEGIBLE).toBe("+57 321 576 4841");
  });

  it("un jeton inconnu est laissé tel quel (faute de frappe visible à la relecture)", () => {
    expect(rellenarIdentidad("{nitt}", "?", PLEINE)).toBe("{nitt}");
  });

  it("l'identité n'est complète que si TOUTES les données sont là", () => {
    expect(identidadCompleta(VIDE)).toBe(false);
    expect(identidadCompleta({ ...PLEINE, rnt: " " })).toBe(false);
    expect(identidadCompleta(PLEINE)).toBe(true);
  });
});
