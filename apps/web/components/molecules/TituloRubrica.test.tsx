import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TituloRubrica, type TituloRubricaProps } from "./TituloRubrica";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Ce que ce fichier tient : le niveau décidé par l'appelant, les ornements hors de l'arbre
// d'accessibilité, les couleurs lues sur la surface (jamais écrites ici), le trait selon la taille,
// et les classes `cqw` de l'accueil reprises à l'identique pour `portada` (l'accueil ne doit pas
// bouger d'un pixel). L'apparence elle-même se juge dans la story, à 390 et 1 280 px.

function rendre(props: Partial<TituloRubricaProps> = {}) {
  const { container } = render(
    <TituloRubrica as="h2" texto="Actividades" tamano="seccion" testId="titulo" {...props} />
  );
  const titre = container.querySelector("[data-testid='titulo']") as HTMLElement;
  if (!titre) throw new Error("TituloRubrica n'a rien rendu");
  return { container, titre };
}

describe("TituloRubrica", () => {
  it.each(["h1", "h2"] as const)("rend la balise %s demandée, avec le texte et le testId", (as) => {
    const { container, titre } = rendre({ as });
    expect(titre.tagName).toBe(as.toUpperCase());
    expect(titre.textContent).toBe("Actividades");
    expect(container.querySelectorAll("h1, h2, h3").length).toBe(1);
  });

  it.each([
    ["portada", "titre-section"],
    ["pagina", "titre-page"],
    ["seccion", "titre-section"],
  ] as const)("taille %s : classe de rôle %s, aucune graisse Tailwind (pas de faux gras)", (tamano, role) => {
    const { titre } = rendre({ tamano });
    expect(titre.className.split(/\s+/)).toContain(role);
    expect(titre.className).not.toMatch(/\bfont-(semibold|bold|extrabold|medium)\b/);
  });

  // ⚠️ L'accueil doit rester identique au pixel : ce sont les classes qu'il écrivait à la main avant
  // S1 (`SeccionPortada.tsx`), titre et trait.
  it("portada reprend exactement les classes cqw de l'accueil", () => {
    const { titre } = rendre({ tamano: "portada" });
    const classes = titre.className.split(/\s+/);
    expect(classes).toContain("text-[clamp(1.75rem,6.3cqw,3.75rem)]");
    expect(classes).toContain("leading-none");
    const trazo = (titre.nextElementSibling as HTMLElement).className.split(/\s+/);
    expect(trazo).toEqual(
      expect.arrayContaining(["mt-[0.8cqw]", "h-[clamp(2px,0.5cqw,4px)]", "w-[68cqw]"])
    );
  });

  it("pose le point décoratif, à la couleur de la surface, et le retire pour un nom propre", () => {
    const point = rendre().titre.querySelector("span") as HTMLElement;
    expect(point.getAttribute("aria-hidden")).toBe("true");
    expect(point.textContent).toBe("");
    expect(point.className).toContain("bg-[var(--punto-titulo)]");
    expect(rendre({ punto: false }).titre.querySelector("span")).toBeNull();
  });

  it.each([
    ["portada", true],
    ["seccion", true],
    ["pagina", false],
  ] as const)("taille %s : trait par défaut = %s", (tamano, attendu) => {
    const { titre } = rendre({ tamano });
    expect(titre.nextElementSibling !== null).toBe(attendu);
  });

  it("le trait se force ou se retire, reste décoratif et prend la couleur de la surface", () => {
    expect(rendre({ tamano: "seccion", trazo: false }).titre.nextElementSibling).toBeNull();
    const trazo = rendre({ tamano: "pagina", trazo: true }).titre.nextElementSibling as HTMLElement;
    expect(trazo.getAttribute("aria-hidden")).toBe("true");
    expect(trazo.className).toContain("bg-[var(--trazo-titulo)]");
    expect(trazo.className).toContain("w-[68%]");
  });

  // Le nom accessible du titre est son seul texte : ni le point ni le trait n'y ajoutent rien.
  it("n'ajoute aucun texte au titre", () => {
    const { container } = rendre({ tamano: "portada" });
    expect(container.textContent).toBe("Actividades");
  });

  // Rendu par des Server Components : vérifié sur le TEXTE du fichier (CLAUDE.md §11.20).
  it("reste un Server Component : ni \"use client\", ni @hifago/ui", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "TituloRubrica.tsx"), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toMatch(/from ["']@hifago\/ui/);
  });
});
