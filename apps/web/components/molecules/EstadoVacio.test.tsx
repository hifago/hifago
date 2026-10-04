import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { EstadoVacio, type EstadoVacioProps } from "./EstadoVacio";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Le sujet de ce fichier : cet état vide n'entre PAS dans la hiérarchie des titres de la page.
// C'est une règle invisible à l'œil (deux `<p>` centrés et deux `<h*>` centrés se ressemblent
// exactement) et qui casserait donc en silence, le jour où quelqu'un « améliorerait » le titre en
// y passant l'atome `Title`. Elle est tenue ici, explicitement. Depuis le plan 41 (S8), il tient
// aussi l'illustration décorative et l'emplacement d'action.

// `next/image` remplacé par un `<img>` nu : on observe quelle image et son `alt`, pas l'URL
// d'optimisation que fabrique Next.
vi.mock("next/image", () => ({
  default: ({ src, alt, sizes }: { src: string; alt: string; sizes?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- doublure de test de `next/image`
    <img src={src} alt={alt} data-sizes={sizes} />
  ),
}));

function rendre(props: EstadoVacioProps) {
  const { container } = render(<EstadoVacio {...props} />);
  const racine = container.firstElementChild as HTMLElement;
  if (!racine) throw new Error("EstadoVacio n'a rien rendu");
  return racine;
}

const TITULO = "No encontramos ofertas para tu búsqueda";
const DESCRIPCION = "Prueba con otras fechas, con menos personas o quita algún filtro.";

describe("EstadoVacio", () => {
  it("rend le titre reçu, tel quel", () => {
    const racine = rendre({ titulo: TITULO });
    expect(racine.textContent).toBe(TITULO);
  });

  it("rend la description quand elle est fournie", () => {
    const racine = rendre({ titulo: TITULO, descripcion: DESCRIPCION });
    const paragraphes = racine.querySelectorAll("p");

    expect(paragraphes.length).toBe(2);
    expect(paragraphes[0].textContent).toBe(TITULO);
    expect(paragraphes[1].textContent).toBe(DESCRIPCION);
  });

  // ⚠️ Le complément qui compte : sans description, on ne rend pas un élément vide. Un `<p>` vide
  // laisserait le `gap` du conteneur ouvrir un blanc que rien ne remplit, et un lecteur d'écran
  // annoncerait un paragraphe fantôme.
  it("n'ajoute AUCUN élément quand la description est absente", () => {
    const racine = rendre({ titulo: TITULO, ilustracion: null });

    expect(racine.querySelectorAll("p").length).toBe(1);
    expect(racine.children.length).toBe(1);
  });

  // La règle que ce composant existe pour tenir : spec 28 §0 — un seul <h1>, les titres de section
  // sont des <h2>. L'état vide ne prend AUCUN niveau, sinon la structure de titres de l'accueil
  // changerait selon qu'il y a des résultats ou non.
  it("ne rend aucun titre HTML, ni avec ni sans description", () => {
    expect(rendre({ titulo: TITULO }).querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(
      rendre({ titulo: TITULO, descripcion: DESCRIPCION }).querySelector("h1, h2, h3, h4, h5, h6")
    ).toBeNull();
  });

  it("expose testId sur le conteneur, et préfixe ses deux enfants", () => {
    const racine = rendre({ titulo: TITULO, descripcion: DESCRIPCION, testId: "sin-resultados" });

    expect(racine.getAttribute("data-testid")).toBe("sin-resultados");
    expect(
      racine.querySelector('[data-testid="sin-resultados-titulo"]')?.textContent
    ).toBe(TITULO);
    expect(
      racine.querySelector('[data-testid="sin-resultados-descripcion"]')?.textContent
    ).toBe(DESCRIPCION);
  });

  it("ne pose aucun data-testid quand testId est absent", () => {
    const racine = rendre({
      titulo: TITULO,
      descripcion: DESCRIPCION,
      accion: <button type="button">Explorar</button>,
    });

    expect(racine.hasAttribute("data-testid")).toBe(false);
    expect(racine.querySelectorAll("[data-testid]").length).toBe(0);
  });

  // ── Plan 41, S8 : illustré, et avec une action ───────────────────────────────────────────────

  // L'illustration est un DÉCOR : rien à annoncer, et elle n'ajoute rien au texte du bloc.
  it("pose par défaut la pastille du motif, décorative, au sizes de sa taille", () => {
    const racine = rendre({ titulo: TITULO, testId: "vacio" });
    const pastille = racine.querySelector('[data-testid="vacio-ilustracion"]') as HTMLElement;
    expect(pastille.getAttribute("aria-hidden")).toBe("true");
    expect(pastille.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["size-32", "sm:size-40", "rounded-full"])
    );
    const image = pastille.querySelector("img") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("/brand/motif-bleu-ciel.webp");
    expect(image.getAttribute("alt")).toBe("");
    expect(image.getAttribute("data-sizes")).toBe("160px");
    expect(racine.textContent).toBe(TITULO);
  });

  it("retire l'illustration sur demande", () => {
    expect(rendre({ titulo: TITULO, ilustracion: null }).querySelector("img")).toBeNull();
  });

  // Rôle `titre-bloc` (Anton 20 → 22 px) sur un `<p>` : l'apparence d'un titre de bloc, sans
  // entrer dans la hiérarchie. Aucune graisse : Anton n'existe qu'en 400.
  it("rend le titre au rôle titre-bloc et la description en corps de 16 px", () => {
    const racine = rendre({ titulo: TITULO, descripcion: DESCRIPCION, testId: "vacio" });
    const titre = racine.querySelector('[data-testid="vacio-titulo"]') as HTMLElement;
    expect(titre.className.split(/\s+/)).toContain("titre-bloc");
    expect(titre.className).not.toMatch(/\bfont-(medium|semibold|bold)\b/);
    const description = racine.querySelector('[data-testid="vacio-descripcion"]') as HTMLElement;
    expect(description.className.split(/\s+/)).toContain("text-base");
  });

  it("rend l'action sous le texte, et rien sans action", () => {
    const avec = rendre({ titulo: TITULO, accion: <button type="button">Explorar</button>, testId: "vacio" });
    const accion = avec.querySelector('[data-testid="vacio-accion"]') as HTMLElement;
    expect(accion.querySelector("button")?.textContent).toBe("Explorar");
    expect(avec.lastElementChild).toBe(accion);
    expect(
      rendre({ titulo: TITULO, testId: "vacio" }).querySelector('[data-testid="vacio-accion"]')
    ).toBeNull();
  });

  it("reste un Server Component : ni \"use client\", ni @hifago/ui", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "EstadoVacio.tsx"), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toMatch(/from ["']@hifago\/ui/);
  });
});
