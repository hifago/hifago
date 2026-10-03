import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WizardStepper } from "./wizard-stepper";

// Les pastilles d'étape n'affichent que « 1 » ou « ✓ », et les titres des étapes sont masqués sous
// sm : ce fichier prouve que chaque bouton porte un nom accessible complet, étape terminée comprise.

describe("WizardStepper — noms accessibles des étapes", () => {
  it("nomme chaque étape par son numéro, son titre et son état", () => {
    render(
      <WizardStepper titles={["Identidad", "Ubicación", "Fotos"]} currentIndex={1} onStepClick={() => {}} />
    );
    expect(screen.getByRole("button", { name: "Paso 1 de 3: Identidad (completado)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Paso 2 de 3: Ubicación" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Paso 3 de 3: Fotos" })).toBeTruthy();
  });
});
