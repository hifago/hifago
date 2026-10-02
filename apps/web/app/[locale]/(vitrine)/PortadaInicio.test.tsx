import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { PortadaInicio } from "./PortadaInicio";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// `next/image` remplacé par un `<img>` nu : on observe quelle image le héros demande et comment il
// l'annonce (`alt`, `aria-hidden`), pas l'URL d'optimisation que fabrique Next.
vi.mock("next/image", () => ({
  default: ({ src, alt, ...props }: { src: string; alt: string; "aria-hidden"?: boolean }) => (
    // eslint-disable-next-line @next/next/no-img-element -- doublure de test de `next/image`
    <img src={src} alt={alt} aria-hidden={props["aria-hidden"]} />
  ),
}));

function rendu() {
  return render(
    <PortadaInicio
      titulo="Actividades y alojamientos en Guatapé"
      navegacion={<nav data-testid="nav-de-test" />}
      busqueda={<div data-testid="busqueda-de-test" />}
      testId="portada"
    />
  ).container;
}

describe("PortadaInicio", () => {
  // ⚠️ INVARIANT DE LA SPEC 28 (§0.3) : un seul <h1> par page, et il a un TEXTE. Le <h1> de
  // l'accueil est désormais le grand logo — l'image est décorative, le texte reste dans le DOM pour
  // les lecteurs d'écran et les moteurs (`e2e/home.spec.ts` lit son `textContent`).
  it("fait du logo le <h1>, avec le titre de la page en texte", () => {
    const container = rendu();
    const titres = container.querySelectorAll("h1");
    expect(titres.length).toBe(1);
    expect(titres[0].textContent).toBe("Actividades y alojamientos en Guatapé");
    const logo = titres[0].querySelector("img") as HTMLImageElement;
    expect(logo.getAttribute("src")).toBe("/brand/logo-portada.webp");
    expect(logo.getAttribute("alt")).toBe("");
  });

  // L'illustration de la rue est un DÉCOR : rien à annoncer, et hors du <h1>.
  it("pose l'illustration de la rue en décor, hors du titre", () => {
    const container = rendu();
    const rue = container.querySelector('img[src="/brand/calle-zocalos.webp"]') as HTMLImageElement;
    expect(rue.getAttribute("alt")).toBe("");
    expect(rue.getAttribute("aria-hidden")).toBe("true");
    expect(rue.closest("h1")).toBeNull();
  });

  // L'ordre de la maquette : le logo, la navigation par type, PUIS la recherche.
  it("rend la navigation puis la recherche, sous le titre", () => {
    const container = rendu();
    const titre = container.querySelector("h1") as HTMLElement;
    const nav = container.querySelector('[data-testid="nav-de-test"]') as HTMLElement;
    const busqueda = container.querySelector('[data-testid="busqueda-de-test"]') as HTMLElement;
    expect(titre.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.compareDocumentPosition(busqueda) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // ⚠️ `pt-16` = la hauteur du header transparent (`SiteHeader`, `h-16`), qui est posé PAR-DESSUS
  // ce héros. Si l'un bouge sans l'autre, le logo passe sous le header ou s'en éloigne. Les deux
  // fichiers sont lus ici, et pas seulement le nôtre : c'est leur ACCORD qu'on vérifie.
  it("réserve au-dessus du logo exactement la hauteur du header transparent", () => {
    const ici = dirname(fileURLToPath(import.meta.url));
    const portada = readFileSync(join(ici, "PortadaInicio.tsx"), "utf8");
    const header = readFileSync(join(ici, "../../../components/organisms/SiteHeader.tsx"), "utf8");
    expect(portada).toContain("pt-16");
    expect(header).toMatch(/COLUMNA_PORTADA\}[^"`]*flex h-16 /);
  });

  it("reste un Server Component : ni \"use client\", ni @hifago/ui", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "PortadaInicio.tsx"), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toContain("@hifago/ui");
  });
});
