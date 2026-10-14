import { describe, expect, it } from "vitest";
import { commercialStatusLabel, resumenMetodoPago } from "./crmProfile";

describe("resumenMetodoPago", () => {
  it("Bancolombia : type de compte, suffixe seul, titulaire", () => {
    const resumen = resumenMetodoPago({
      nombre: "Ana Pérez",
      bancolombia: { numero_cuenta: "12345678901", tipo_cuenta: "ahorros" },
    });
    expect(resumen).toBe("Bancolombia (ahorros) · cuenta …8901 · titular Ana Pérez");
    expect(resumen).not.toContain("12345678901");
  });

  it("Nequi : jamais le téléphone complet", () => {
    const resumen = resumenMetodoPago({ nombre: "", nequi: { telefono: "3001234567" } });
    expect(resumen).toBe("Nequi · teléfono …4567");
    expect(resumen).not.toContain("3001234567");
  });

  it("sans moyen enregistré : null (titulaire seul conservé s'il existe)", () => {
    expect(resumenMetodoPago(null)).toBeNull();
    expect(resumenMetodoPago({})).toBeNull();
    expect(resumenMetodoPago({ nombre: "Ana" })).toBe("titular Ana");
  });
});

describe("commercialStatusLabel", () => {
  it("libellé connu, valeur inconnue rendue telle quelle, vide → null", () => {
    expect(commercialStatusLabel("pausa")).toBe("En pausa");
    expect(commercialStatusLabel("otro")).toBe("otro");
    expect(commercialStatusLabel(null)).toBeNull();
  });
});
