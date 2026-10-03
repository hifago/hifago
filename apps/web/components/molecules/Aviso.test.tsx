import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Aviso, type AvisoProps, type AvisoTono } from "./Aviso";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Ce que ce fichier tient : les règles invisibles à l'œil d'un encadré qui « a l'air juste » — la
// surface `clara` qui le garde lisible sur l'or, le ton qui ne repose pas sur la seule couleur,
// l'absence de titre HTML, et le rôle ARIA qui n'apparaît que quand l'appelant le demande.

function rendre(props: Partial<AvisoProps> = {}) {
  const { container } = render(
    <Aviso tono="info" testId="aviso" {...props}>
      {props.children ?? "Este servicio ya no está disponible."}
    </Aviso>
  );
  const racine = container.firstElementChild as HTMLElement;
  if (!racine) throw new Error("Aviso n'a rien rendu");
  return racine;
}

const TONOS: AvisoTono[] = ["info", "exito", "alerta", "error"];

describe("Aviso", () => {
  it("pose sa propre surface claire, sur fond blanc : il reste lisible posé sur l'or", () => {
    const racine = rendre();
    expect(racine.getAttribute("data-superficie")).toBe("clara");
    expect(racine.className).toContain("bg-surface");
    expect(racine.className).toContain("text-foreground");
  });

  it.each([
    ["info", "border-link", "text-link"],
    ["exito", "border-success", "text-success"],
    ["alerta", "border-warning", "text-warning"],
    ["error", "border-danger", "text-danger"],
  ] as const)("ton %s : bordure %s et icône %s, le texte reste marine", (tono, borde, icono) => {
    const racine = rendre({ tono });
    expect(racine.getAttribute("data-tono")).toBe(tono);
    expect(racine.className).toContain(borde);
    expect(racine.querySelector("[data-testid='aviso-icono']")?.getAttribute("class")).toContain(icono);
    expect(racine.querySelector("[data-testid='aviso-cuerpo']")?.className).not.toMatch(/text-(link|success|warning|danger)/);
  });

  // La couleur seule ne dit pas le ton : chaque ton a un tracé à lui. Si deux tons partageaient le
  // même dessin, seul le changement de couleur les distinguerait.
  it("dessine une icône différente pour chacun des quatre tons", () => {
    const traces = TONOS.map((tono) => rendre({ tono }).querySelector("svg")?.innerHTML);
    expect(new Set(traces).size).toBe(4);
  });

  it("cache l'icône aux technologies d'assistance : ce sont les mots qui portent le message", () => {
    const svg = rendre().querySelector("svg") as SVGElement;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
  });

  it("rend le titre dans un <p>, jamais un titre HTML", () => {
    const racine = rendre({ titulo: "Necesitas un alojamiento" });
    expect(racine.querySelector("[data-testid='aviso-titulo']")?.tagName).toBe("P");
    expect(racine.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
  });

  it("n'ajoute ni titre ni rangée d'actions quand ils sont absents", () => {
    const racine = rendre();
    expect(racine.querySelector("[data-testid='aviso-titulo']")).toBeNull();
    expect(racine.querySelector("[data-testid='aviso-accion']")).toBeNull();
  });

  it("rend l'action sous le texte", () => {
    const racine = rendre({ accion: <button type="button">Reintentar</button> });
    expect(racine.querySelector("[data-testid='aviso-accion'] button")?.textContent).toBe("Reintentar");
  });

  // Les e2e et les lecteurs d'écran lisent le rôle sur l'élément EXTÉRIEUR : celui que l'appelant
  // avait avant S6. Aucun rôle par défaut.
  it("ne pose le rôle que s'il est demandé, et sur l'élément extérieur", () => {
    expect(rendre().hasAttribute("role")).toBe(false);
    expect(rendre({ rol: "alert" }).getAttribute("role")).toBe("alert");
    expect(rendre({ rol: "status" }).getAttribute("role")).toBe("status");
  });

  it("le compact resserre le padding, le rayon et le texte", () => {
    const normal = rendre();
    const compact = rendre({ compacto: true });
    expect(normal.className).toContain("rounded-[16px]");
    expect(normal.className).toContain("p-4");
    expect(normal.className).toContain("sm:p-5");
    expect(compact.className).toContain("rounded-[12px]");
    expect(compact.className).toContain("p-3");
    expect(compact.className).toContain("text-sm");
    expect(compact.className).not.toContain("sm:p-5");
  });
});
