import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Title } from "./Title";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Le sujet de ce fichier tient en une phrase : `as` décide de la BALISE, `size` décide de
// l'APPARENCE, et l'une ne déteint jamais sur l'autre. C'est la seule chose qui empêche un <h3>
// écrit pour obtenir du petit texte.
function titre(element: React.ReactElement) {
  const { container } = render(element);
  return container.firstElementChild as HTMLElement;
}

describe("Title", () => {
  it("rend la balise demandée par `as`", () => {
    expect(titre(<Title as="h1">Titre</Title>).tagName).toBe("H1");
    expect(titre(<Title as="h2">Titre</Title>).tagName).toBe("H2");
    expect(titre(<Title as="h3">Titre</Title>).tagName).toBe("H3");
  });

  // ⚠️ Le test qui porte la décision : demander un autre rôle ne change JAMAIS le niveau.
  it("`size` ne change pas la balise", () => {
    expect(titre(<Title as="h2" size="bloque">Disponibilidad</Title>).tagName).toBe("H2");
    expect(titre(<Title as="h2" size="pagina">Disponibilidad</Title>).tagName).toBe("H2");
    expect(titre(<Title as="h3" size="etiqueta">General</Title>).tagName).toBe("H3");
  });

  // Les classes de rôle du plan 41 (F1), définies dans `packages/ui/src/styles/globals.css`.
  it("dérive le rôle par défaut du niveau : h1→pagina, h2→seccion, h3→bloque", () => {
    expect(titre(<Title as="h1">Titre</Title>).className).toBe("titre-page");
    expect(titre(<Title as="h2">Titre</Title>).className).toBe("titre-section");
    expect(titre(<Title as="h3">Titre</Title>).className).toBe("titre-bloc");
  });

  it("applique le rôle explicite quand il est donné", () => {
    // Le cas réel : « Disponibilidad », un <h2> qui se lit comme un titre de bloc.
    expect(titre(<Title as="h2" size="bloque">Disponibilidad</Title>).className).toBe("titre-bloc");
    // Les catégories d'équipement : un <h3> en Poppins, jamais en police de titre à 14 px.
    expect(titre(<Title as="h3" size="etiqueta">General</Title>).className).toBe("etiquette");
    expect(titre(<Title as="h2" size="pagina">Titre</Title>).className).toBe("titre-page");
  });

  // ⚠️ Le défaut que F2 a supprimé : `font-semibold` sur Anton, qui n'existe qu'en 400, faisait
  // synthétiser un faux gras au navigateur. Aucun rôle ne pose plus de graisse ni de taille en
  // classe : elles vivent dans la définition CSS du rôle.
  it("ne pose jamais de classe de graisse ni de taille Tailwind", () => {
    for (const size of ["pagina", "seccion", "bloque", "etiqueta"] as const) {
      expect(titre(<Title as="h2" size={size}>T</Title>).className).not.toMatch(/font-|text-/);
    }
  });

  it("expose testId sur la balise de titre", () => {
    const element = titre(
      <Title as="h1" testId="product-name">
        GLAMPING
      </Title>
    );
    expect(element.getAttribute("data-testid")).toBe("product-name");
    expect(element.tagName).toBe("H1");
  });

  it("rend son contenu, y compris un enfant React", () => {
    const element = titre(
      <Title as="h2">
        Casa Kayam <span data-testid="badge">·&nbsp;6</span>
      </Title>
    );
    expect(element.textContent).toContain("Casa Kayam");
    expect(element.querySelector('[data-testid="badge"]')).not.toBeNull();
  });
});
