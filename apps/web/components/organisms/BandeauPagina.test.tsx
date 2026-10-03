import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BandeauPagina, type BandeauPaginaProps } from "./BandeauPagina";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Ce que ce fichier tient : le seul `<h1>` de la page, l'ordre de lecture du bandeau, la surface or
// à fond perdu de la variante `contenido` (et son absence en `navegacion`), et l'image décorative
// qui seule a le droit de disparaître sous `lg`. L'apparence se juge dans la story, à 360, 390 et
// 1 280 px.

function rendre(props: Partial<BandeauPaginaProps> = {}) {
  const { container } = render(
    <BandeauPagina titulo="Agua" variante="contenido" testId="bandeau" {...props} />
  );
  const racine = container.querySelector("[data-testid='bandeau']") as HTMLElement;
  if (!racine) throw new Error("BandeauPagina n'a rien rendu");
  return racine;
}

const COMPLET: Partial<BandeauPaginaProps> = {
  migas: <nav aria-label="Ruta">Inicio › Actividades › Agua</nav>,
  // Doublures : le bandeau reçoit ces blocs tout rendus, il ne les connaît pas.
  volver: <p>Volver</p>,
  chapo: "Kayak, jetski y paseos en lancha por el embalse.",
  meta: <span>3 ofertas</span>,
  accion: <button type="button">Buscar</button>,
  imagen: <span>decor</span>,
};

describe("BandeauPagina", () => {
  it("porte le seul <h1> de la page, à point par défaut, sans trait", () => {
    const racine = rendre();
    const titres = racine.querySelectorAll("h1, h2, h3");
    expect(titres.length).toBe(1);
    expect(titres[0].tagName).toBe("H1");
    expect(titres[0].getAttribute("data-testid")).toBe("bandeau-titulo");
    expect(titres[0].className.split(/\s+/)).toContain("titre-page");
    expect(titres[0].querySelector("span[aria-hidden='true']")).not.toBeNull();
    // Le trait est la marque des rubriques de section, pas du H1 d'un bandeau (§3.6 du plan).
    expect(titres[0].nextElementSibling).toBeNull();
  });

  it("retire le point pour un nom propre", () => {
    expect(rendre({ conPunto: false }).querySelector("h1 span")).toBeNull();
  });

  // L'ordre du §6 (S2) : fil d'Ariane → lien retour → H1 → chapô → meta → action.
  it("rend les éléments dans l'ordre de lecture du plan", () => {
    const racine = rendre(COMPLET);
    const colonne = racine.querySelector("h1")!.parentElement!;
    const ordre = Array.from(colonne.children).map(
      (el) => el.getAttribute("data-testid") ?? el.tagName.toLowerCase()
    );
    expect(ordre).toEqual(["nav", "p", "bandeau-titulo", "bandeau-chapo", "bandeau-meta", "bandeau-accion"]);
  });

  it("pose le chapô au rôle chapo, limité à 60 caractères par ligne", () => {
    const chapo = rendre(COMPLET).querySelector("[data-testid='bandeau-chapo']") as HTMLElement;
    expect(chapo.tagName).toBe("P");
    expect(chapo.className.split(/\s+/)).toEqual(expect.arrayContaining(["chapo", "max-w-[60ch]"]));
  });

  // La page de catégorie (P2) garde le `data-testid` que lit son e2e.
  it("porte le data-testid du chapô demandé par la page", () => {
    const racine = rendre({ ...COMPLET, chapoTestId: "categoria-descripcion" });
    expect(racine.querySelector("[data-testid='categoria-descripcion']")?.tagName).toBe("P");
    expect(racine.querySelector("[data-testid='bandeau-chapo']")).toBeNull();
  });

  it("n'ajoute aucun bloc vide quand chapô, meta, action et image manquent", () => {
    const racine = rendre();
    for (const suffixe of ["chapo", "meta", "accion", "imagen"]) {
      expect(racine.querySelector(`[data-testid='bandeau-${suffixe}']`)).toBeNull();
    }
  });

  // La variante des pages claires peint l'or elle-même, hors de la colonne, et redéfinit ce qui s'y
  // lit (F3). `data-bleed` est la marque que lit `PageShell pagina`.
  it("contenido : or à fond perdu, en sous-grille, contenu dans la colonne", () => {
    const racine = rendre();
    expect(racine.tagName).toBe("HEADER");
    expect(racine.hasAttribute("data-bleed")).toBe(true);
    expect(racine.getAttribute("data-superficie")).toBe("or");
    expect(racine.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["col-span-full", "grid-cols-subgrid"])
    );
    expect((racine.firstElementChild as HTMLElement).className).toContain("col-start-2");
  });

  // La page est déjà or : pas de second fond, pas de sortie de colonne.
  it("navegacion : ni fond propre ni fond perdu", () => {
    const racine = rendre({ variante: "navegacion" });
    expect(racine.hasAttribute("data-bleed")).toBe(false);
    expect(racine.hasAttribute("data-superficie")).toBe(false);
  });

  // Seul le décor a le droit de disparaître selon la largeur (`.claude/rules/ui.md`).
  it("pose l'image en décor, masquée sous lg, et ouvre une seconde colonne pour elle", () => {
    const racine = rendre(COMPLET);
    const imagen = racine.querySelector("[data-testid='bandeau-imagen']") as HTMLElement;
    expect(imagen.getAttribute("aria-hidden")).toBe("true");
    expect(imagen.className.split(/\s+/)).toEqual(expect.arrayContaining(["hidden", "lg:block"]));
    expect((imagen.parentElement as HTMLElement).className).toContain("lg:grid-cols-[minmax(0,1fr)_auto]");
    // Sans image, la grille reste à une colonne.
    expect(rendre().innerHTML).not.toContain("lg:grid-cols-");
  });

  it("contenido : garde 24 → 32 px au-dessus et 32 → 48 px au-dessous", () => {
    const grille = rendre().querySelector("h1")!.parentElement!.parentElement as HTMLElement;
    expect(grille.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["pt-6", "pb-8", "sm:pt-8", "sm:pb-12"])
    );
  });

  // Décision du 2026-10-03 : sur une page déjà or, l'écart du `<main>` (24 px) s'ajoute à la marge
  // basse ; 0 → 24 px laissent 32 → 56 px visibles sous la recherche, le rythme des rails.
  it("navegacion : même marge haute, 0 → 24 px au-dessous", () => {
    const grille = rendre({ variante: "navegacion" }).querySelector("h1")!.parentElement!
      .parentElement as HTMLElement;
    const classes = grille.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["pt-6", "pb-0", "sm:pt-8", "sm:pb-6"]));
    expect(classes).not.toContain("sm:pb-12");
  });

  it("reste un Server Component : ni \"use client\", ni @hifago/ui", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "BandeauPagina.tsx"), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toMatch(/from ["']@hifago\/ui/);
  });
});
