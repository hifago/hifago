import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SearchBar, type SearchSuggestion } from "./SearchBar";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Ce que ces tests protègent, c'est la règle du lot : `Entrée` soumet le TEXTE TAPÉ, sauf si
// l'utilisateur est descendu sur une suggestion aux flèches. Elle n'est le défaut d'aucune
// bibliothèque — react-aria avale `Entrée` sans rien faire — et elle ne se voit dans aucun rendu.
// Sans ces tests, la revenir en arrière ne casserait rien de visible.

// ⚠️ Trois API de navigateur qu'exigent react-aria et HeroUI au montage et que jsdom n'implémente
// pas. Bouchonnées ICI et pas dans une configuration partagée : `vitest.config.ts` et
// `.storybook/**` sont communs à tous les agents.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
class ObservateurInerte {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
window.ResizeObserver ??= ObservateurInerte as unknown as typeof window.ResizeObserver;
window.IntersectionObserver ??= ObservateurInerte as unknown as typeof window.IntersectionObserver;
// ⚠️ jsdom expose `CSS` sans `CSS.escape`, que react-aria appelle pour retrouver une option par son
// id (`useSelectableCollection`) : sans ce bouchon, toute navigation au clavier dans la liste lève
// « Cannot read properties of undefined (reading 'escape') ».
if (!globalThis.CSS) (globalThis as { CSS?: unknown }).CSS = {};
globalThis.CSS.escape ??= ((valeur: string) => valeur.replace(/([^\w-])/g, "\\$1")) as typeof CSS.escape;

const SUGGESTIONS: SearchSuggestion[] = [
  { id: "p-kayak", label: "Kayak en el Embalse", meta: "Actividad en Guatapé", kind: "product" },
  { id: "c-acuaticas", label: "Actividades acuáticas", meta: "12 actividades", kind: "category" },
  {
    id: "e-kayam",
    label: "Casa Kayam",
    meta: "Alojamiento en Guatapé",
    kind: "establishment",
    href: "/establecimientos/casa-kayam",
  },
];

const LIBELLES = {
  label: "Buscar actividades",
  placeholder: "¿Qué quieres hacer?",
  submitLabel: "Buscar",
  emptyLabel: "No encontramos nada.",
};

/** Le composant est CONTRÔLÉ : sans état autour, le champ ne se remplirait pas. */
function Harnais({
  suggestions = SUGGESTIONS,
  onSubmit = () => {},
  onSuggestionSelect = () => {},
  clearLabel,
}: {
  suggestions?: SearchSuggestion[];
  onSubmit?: (q: string) => void;
  onSuggestionSelect?: (s: SearchSuggestion) => void;
  clearLabel?: string;
}) {
  const [texte, setTexte] = useState("");
  return (
    <SearchBar
      {...LIBELLES}
      value={texte}
      onValueChange={setTexte}
      suggestions={suggestions}
      onSubmit={onSubmit}
      onSuggestionSelect={onSuggestionSelect}
      clearLabel={clearLabel}
      testId="recherche"
    />
  );
}

function champ(): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>('[data-testid="recherche-input"]');
  if (!element) throw new Error("champ introuvable");
  return element;
}

/**
 * ⚠️ CLAUDE.md §11 point 7 : sur un `ComboBox` HeroUI, agir sur une liste NON filtrée est moins
 * fiable qu'après avoir tapé. La parade vérifiée — taper d'abord, désigner l'option par son nom
 * ensuite — est appliquée partout ici, même quand la liste tiendrait sans.
 */
function taper(texte: string) {
  const entree = champ();
  act(() => {
    entree.focus();
    fireEvent.change(entree, { target: { value: texte } });
  });
}

describe("SearchBar", () => {
  it("⚠️ Entrée SEUL soumet le texte tapé, jamais une suggestion", () => {
    // LE test du lot. La référence (getyourguide.com) fait l'inverse, mesuré : `Entrée` y part sur
    // une suggestion et le texte libre n'est atteignable que par le bouton — donc jamais depuis un
    // téléphone, où ce projet a décidé de ne pas afficher de bouton.
    const soumis = vi.fn();
    const choisie = vi.fn();
    render(<Harnais onSubmit={soumis} onSuggestionSelect={choisie} />);

    taper("kayak");
    act(() => {
      fireEvent.keyDown(champ(), { key: "Enter" });
    });

    expect(soumis).toHaveBeenCalledWith("kayak");
    expect(choisie).not.toHaveBeenCalled();
  });

  it("⚠️ FlècheBas puis Entrée active la suggestion, et ne soumet PAS le texte", () => {
    const soumis = vi.fn();
    const choisie = vi.fn();
    render(<Harnais onSubmit={soumis} onSuggestionSelect={choisie} />);

    taper("kayak");
    act(() => {
      fireEvent.keyDown(champ(), { key: "ArrowDown" });
    });
    // C'est l'attribut que le composant lit pour trancher : une option est active.
    expect(champ().getAttribute("aria-activedescendant")).not.toBeNull();

    act(() => {
      fireEvent.keyDown(champ(), { key: "Enter" });
    });
    expect(choisie).toHaveBeenCalledTimes(1);
    expect(choisie.mock.calls[0][0].id).toBe("p-kayak");
    expect(soumis).not.toHaveBeenCalled();
  });

  it("⚠️ aucune suggestion n'est présélectionnée à l'ouverture", () => {
    // C'est CETTE absence qui rend la règle ci-dessus sûre : avec une option présélectionnée,
    // « Entrée soumet le texte » et « Entrée valide la surbrillance » se disputeraient la touche.
    // La référence présélectionne la première (`aria-selected="true"`), et c'est sa panne.
    render(<Harnais />);
    taper("kayak");

    expect(champ().getAttribute("aria-activedescendant")).toBeNull();
    const options = document.querySelectorAll('[role="option"]');
    expect(options.length).toBe(3);
    for (const option of options) expect(option.getAttribute("aria-selected")).not.toBe("true");
  });

  it("un clic sur une suggestion l'active", () => {
    const choisie = vi.fn();
    render(<Harnais onSuggestionSelect={choisie} />);

    taper("kayak");
    act(() => {
      // Parade du §11.7 : on a tapé d'abord, et on désigne l'option par son NOM.
      // ⚠️ `pointerDown`/`pointerUp` et pas `.click()` : react-aria écoute les événements POINTEUR
      // (`usePress`), qu'un `HTMLElement.click()` ne produit pas — l'option resterait inerte.
      const option = screen.getByRole("option", { name: /Actividades acuáticas/ });
      fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 });
      fireEvent.pointerUp(option, { pointerType: "mouse", button: 0 });
      fireEvent.click(option);
    });

    expect(choisie).toHaveBeenCalledTimes(1);
    expect(choisie.mock.calls[0][0].id).toBe("c-acuaticas");
  });

  it("le bouton soumet le texte tapé, comme Entrée", () => {
    const soumis = vi.fn();
    render(<Harnais onSubmit={soumis} />);

    taper("lancha");
    // ⚠️ `Échap` d'abord, et ce n'est pas un contournement : tant que la liste est ouverte,
    // react-aria pose `aria-hidden` sur tout ce qui l'entoure (`ariaHideOutside`), donc le bouton
    // n'est PAS dans l'arbre d'accessibilité — `getByRole` ne le voit pas, et un lecteur d'écran
    // non plus. C'est le parcours réel : on ferme la liste, puis on presse le bouton.
    act(() => {
      fireEvent.keyDown(champ(), { key: "Escape" });
    });
    act(() => {
      const bouton = screen.getByRole("button", { name: "Buscar" });
      fireEvent.pointerDown(bouton, { pointerType: "mouse", button: 0 });
      fireEvent.pointerUp(bouton, { pointerType: "mouse", button: 0 });
      fireEvent.click(bouton);
    });

    expect(soumis).toHaveBeenCalledWith("lancha");
  });

  it("⚠️ ne refiltre RIEN : les suggestions reçues sont rendues telles quelles", () => {
    // react-aria refiltre la collection sur le texte tapé quand elle n'est pas contrôlée — mesuré :
    // quatre suggestions fournies, une seule affichée. La catégorie « Actividades acuáticas », que
    // l'appelant juge pertinente pour « kayak », disparaissait alors qu'elle ne contient pas le mot.
    // C'est exactement ce que ce composant promet de ne pas faire.
    render(<Harnais />);
    taper("kayak");

    expect(document.querySelectorAll('[role="option"]').length).toBe(3);
    expect(screen.getByRole("option", { name: /Actividades acuáticas/ })).toBeDefined();
  });

  it("⚠️ liste vide : le message est rendu, la liste ne disparaît pas en silence", () => {
    // react-aria FERME le popover dès que la collection est vide, sauf `allowsEmptyCollection`.
    // Sans lui, l'état le plus fréquent d'une recherche n'affiche rien du tout.
    render(<Harnais suggestions={[]} />);
    taper("xyzzy");

    expect(document.querySelector('[data-testid="recherche-empty"]')?.textContent).toBe(
      "No encontramos nada."
    );
  });

  it("rend une suggestion pourvue d'un href comme un VRAI lien", () => {
    // Un résultat qu'on ne peut pas ouvrir dans un nouvel onglet est une régression par rapport à
    // une liste de cartes. C'est l'appelant qui décide, suggestion par suggestion.
    render(<Harnais />);
    taper("casa");

    const lien = screen.getByRole("option", { name: /Casa Kayam/ });
    expect(lien.tagName).toBe("A");
    expect(lien.getAttribute("href")).toBe("/establecimientos/casa-kayam");
    // Les autres ne sont pas des liens : le href est facultatif, pas imposé.
    expect(screen.getByRole("option", { name: /Kayak en el Embalse/ }).tagName).not.toBe("A");
  });

  it("porte la ligne secondaire de chaque suggestion, sans intitulé de groupe", () => {
    // Liste PLATE, comme la référence : la nature est portée par la ligne secondaire, pas par des
    // sections. Ça mélange les natures par pertinence et ça évite les intitulés non sélectionnables.
    render(<Harnais />);
    taper("kayak");

    expect(screen.getByRole("option", { name: /Actividad en Guatapé/ })).toBeDefined();
    // Scopé à la LISTE : la pilule elle-même est un `Group` react-aria, et c'est normal.
    const liste = document.querySelector('[role="listbox"]');
    expect(liste?.querySelectorAll('[role="group"]').length).toBe(0);
  });

  it("⚠️ le champ porte enterkeyhint=search et type=text — les deux comptent", () => {
    // `enterkeyhint` : sous `md` le bouton est masqué, la touche de validation du clavier virtuel
    // est le seul moyen visible de chercher. `type="text"` et pas `search` : Chromium EFFACE
    // nativement un `input[type=search]` à `Échap` (mesuré), ce qui perdrait le texte tapé.
    render(<Harnais />);
    expect(champ().getAttribute("enterkeyhint")).toBe("search");
    expect(champ().getAttribute("type")).toBe("text");
    expect(champ().getAttribute("role")).toBe("combobox");
    expect(champ().getAttribute("aria-label")).toBe("Buscar actividades");
  });

  it("expose testId sur la racine et le préfixe sur ses parties", () => {
    const { container } = render(<Harnais />);
    expect(container.firstElementChild?.getAttribute("data-testid")).toBe("recherche");
    expect(document.querySelector('[data-testid="recherche-input"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="recherche-submit"]')).not.toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // LA CROIX DE LA MAQUETTE DE L'ACCUEIL (2026-10-01)
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  //
  // ⚠️ La maquette la dessine dans un champ VIDE ; elle n'apparaît ici qu'avec du texte, parce
  // qu'une croix qui n'efface rien serait un bouton sans effet. C'est ce choix que ces tests tiennent.
  const croix = () => document.querySelector<HTMLButtonElement>('[data-testid="recherche-clear"]');

  it("n'affiche la croix qu'avec du texte à effacer", () => {
    render(<Harnais clearLabel="Borrar la búsqueda" />);
    expect(croix()).toBeNull();
    act(() => {
      fireEvent.change(champ(), { target: { value: "kay" } });
    });
    expect(croix()).not.toBeNull();
    expect(croix()?.getAttribute("aria-label")).toBe("Borrar la búsqueda");
  });

  it("sans libellé, pas de croix du tout — même avec du texte", () => {
    render(<Harnais />);
    act(() => {
      fireEvent.change(champ(), { target: { value: "kay" } });
    });
    expect(croix()).toBeNull();
  });

  // ⚠️ Le focus REVIENT au champ : la croix disparaît avec le texte, et sans ce retour le focus
  // tomberait sur <body> — la tabulation repartirait du début de la page.
  it("vide le champ et rend le focus au champ", () => {
    render(<Harnais clearLabel="Borrar la búsqueda" />);
    act(() => {
      champ().focus();
      fireEvent.change(champ(), { target: { value: "kayak" } });
    });
    act(() => {
      fireEvent.click(croix() as HTMLButtonElement);
    });
    expect(champ().value).toBe("");
    expect(document.activeElement).toBe(champ());
    expect(croix()).toBeNull();
  });
});
