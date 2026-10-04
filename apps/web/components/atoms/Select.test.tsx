import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { Select, type SelectOption } from "./Select";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// ⚠️ Deux pièges de test propres au Select HeroUI v3, documentés dans CLAUDE.md §11 :
//  - point 2 : son déclencheur porte `role="button"` et `aria-haspopup="listbox"`, JAMAIS
//    `role="combobox"` — une requête par rôle combobox ne trouve rien ;
//  - point 3 : le `<select>` natif caché (repli formulaire/accessibilité) contient le texte de
//    TOUTES les options, sélectionnées ou non. Une assertion sur le composant entier matche donc
//    n'importe quoi. Tout ce fichier scope sur `[data-slot="select-value"]`.
const TYPES: SelectOption[] = [
  { value: "lodging", label: "Alojamiento" },
  { value: "activity", label: "Actividad" },
  { value: "transport", label: "Transporte" },
];

function rendu(element: React.ReactElement) {
  const { container } = render(element);
  return {
    container,
    // ⚠️ PAS `container.firstElementChild` : react-aria insère un <template> en tête du conteneur,
    // et toute assertion sur la racine viserait ce template au lieu du champ.
    racine: container.querySelector('[data-slot="select"]') as HTMLElement,
    valeur: container.querySelector('[data-slot="select-value"]') as HTMLElement,
    declencheur: container.querySelector('[data-slot="select-trigger"]') as HTMLElement,
  };
}

describe("Select", () => {
  it("affiche le libellé de la valeur sélectionnée", () => {
    const { valeur } = rendu(
      <Select label="Tipo" options={TYPES} value="activity" onChange={() => {}} testId="type" />
    );
    expect(valeur.textContent).toBe("Actividad");
  });

  // ⚠️ Le cas que le catalogue utilise en production : aucune sélection = « toutes ». react-aria ne
  // considère jamais une clé vide comme sélectionnée, donc sans le rendu explicite du déclencheur
  // celui-ci afficherait un blanc.
  it("affiche l'entrée « toutes » quand la valeur est vide", () => {
    const { valeur } = rendu(
      <Select label="Tipo" options={TYPES} value="" onChange={() => {}} allLabel="Todos" />
    );
    expect(valeur.textContent).toBe("Todos");
  });

  it("n'ajoute aucune entrée « toutes » quand allLabel est absent", () => {
    const { container } = rendu(
      <Select label="Tipo" options={TYPES} value="lodging" onChange={() => {}} />
    );
    // Le <select> natif caché liste toutes les options : c'est le seul endroit où les compter
    // sans ouvrir le popover. ⚠️ react-aria y ajoute une option vide de tête (son placeholder),
    // qui n'est PAS une entrée de la liste — d'où le +1 partout ici.
    const natif = container.querySelector("select") as HTMLSelectElement;
    expect(natif.querySelectorAll("option").length).toBe(TYPES.length + 1);
  });

  it("ajoute l'entrée « toutes » en tête quand allLabel est fourni", () => {
    const { container } = rendu(
      <Select label="Tipo" options={TYPES} value="" onChange={() => {}} allLabel="Todos" />
    );
    const natif = container.querySelector("select") as HTMLSelectElement;
    // Le placeholder de react-aria, plus l'entrée « toutes », plus les trois types.
    expect(natif.querySelectorAll("option").length).toBe(TYPES.length + 2);
    expect([...natif.querySelectorAll("option")].map((o) => o.textContent)).toContain("Todos");
  });

  // ⚠️ Le piège §11.2 de CLAUDE.md, avec une précision relevée ici : le déclencheur est un vrai
  // <button> et son rôle est donc IMPLICITE — l'attribut `role` vaut `null`, pas `"button"`. Une
  // requête par rôle fonctionne, une assertion sur l'attribut échoue. Ce qui l'identifie vraiment
  // comme une liste déroulante est `aria-haspopup="listbox"` ; jamais `role="combobox"`.
  it("expose un déclencheur bouton, pas un combobox (piège §11.2)", () => {
    const { declencheur } = rendu(
      <Select label="Tipo" options={TYPES} value="lodging" onChange={() => {}} testId="type" />
    );
    expect(declencheur.tagName).toBe("BUTTON");
    expect(declencheur.getAttribute("aria-haspopup")).toBe("listbox");
    expect(declencheur.getAttribute("role")).toBeNull();
    expect(declencheur.getAttribute("data-testid")).toBe("type-trigger");
  });

  it("remonte la valeur choisie", () => {
    const onChange = vi.fn();
    const { container } = rendu(
      <Select label="Tipo" options={TYPES} value="" onChange={onChange} allLabel="Todos" />
    );
    // Le <select> natif caché est le chemin fiable en jsdom : ouvrir le popover react-aria demande
    // un vrai moteur de rendu (positionnement, focus piégé), ce qui n'existe pas ici.
    const natif = container.querySelector("select") as HTMLSelectElement;
    fireEvent.change(natif, { target: { value: "transport" } });
    expect(onChange).toHaveBeenCalledWith("transport");
  });

  it("relie erreur et texte d'aide au déclencheur, et se marque invalide", () => {
    const { container, racine, declencheur } = rendu(
      <Select label="Tipo" options={TYPES} value="" onChange={() => {}} hint="Filtra el catálogo" error="Elige un tipo" testId="type" />
    );
    expect(racine.getAttribute("data-invalid")).toBe("true");
    const erreur = container.querySelector('[data-testid="type-error"]') as HTMLElement;
    const aide = container.querySelector('[data-testid="type-hint"]') as HTMLElement;
    expect(erreur.textContent).toBe("Elige un tipo");
    expect(aide.textContent).toBe("Filtra el catálogo");
    // La relation, pas seulement la présence : c'est le déclencheur qui est décrit, puisque c'est
    // lui que le lecteur d'écran atteint.
    const decrits = declencheur.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(decrits).toContain(aide.id);
    expect(decrits).toContain(erreur.id);
  });

  it("garde une cible tactile d'au moins 44 px sur son déclencheur (48 px, plan 41 S11)", () => {
    // `.select__trigger` de HeroUI plafonne à `min-h-9`, soit 36 px — sous la règle du README.
    const { declencheur } = rendu(<Select label="Tipo" options={TYPES} value="" onChange={() => {}} />);
    expect(declencheur.className).toContain("min-h-12");
  });

  it("se désactive", () => {
    const { declencheur } = rendu(
      <Select label="Tipo" options={TYPES} value="lodging" onChange={() => {}} isDisabled />
    );
    expect(declencheur.getAttribute("data-disabled")).toBe("true");
  });
});
