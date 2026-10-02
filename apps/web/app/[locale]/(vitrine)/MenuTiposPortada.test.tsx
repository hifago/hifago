import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MenuTiposPortada } from "./MenuTiposPortada";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

// Les libellés de la maquette, et des `href` qui PORTENT déjà les critères : c'est `tiposDeBarra.ts`
// qui les compose, ce composant ne doit ni les perdre ni les réécrire.
const TIPOS = [
  { tipo: "activity", label: "Actividades", href: "/actividades?q=kayak" },
  { tipo: "lodging", label: "Alojamiento", href: "/alojamientos?q=kayak" },
  { tipo: "transport", label: "Transporte", href: "/transportes?q=kayak" },
  { tipo: "camp", label: "Retiros", href: "/camps?q=kayak" },
  { tipo: "evento", label: "Eventos", href: "/eventos?q=kayak" },
] as const;

function rendu() {
  return render(
    <MenuTiposPortada tipos={[...TIPOS]} etiqueta="Tipos de oferta" testId="selector-tipos" />
  ).container;
}

describe("MenuTiposPortada", () => {
  // ⚠️ `selector-tipos-<tipo>` : l'identifiant que cliquait `SelectorTipo`, et que
  // `e2e/home.spec.ts` clique toujours (« les critères survivent à la navigation »).
  it("rend les cinq types en vrais liens, critères compris, sous les identifiants des e2e", () => {
    const container = rendu();
    const nav = container.querySelector("nav") as HTMLElement;
    expect(nav.getAttribute("aria-label")).toBe("Tipos de oferta");
    expect(nav.getAttribute("data-testid")).toBe("selector-tipos");
    for (const { tipo, label, href } of TIPOS) {
      const lien = container.querySelector(`[data-testid="selector-tipos-${tipo}"]`) as HTMLAnchorElement;
      expect(lien.tagName).toBe("A");
      expect(lien.getAttribute("href")).toBe(href);
      expect(lien.textContent).toBe(label);
    }
  });

  // Les points qui séparent les types sont décoratifs : un lecteur d'écran annonce déjà « liste,
  // 5 éléments ». Quatre points pour cinq types — jamais un point avant le premier.
  it("sépare les types par quatre points décoratifs", () => {
    const container = rendu();
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(5);
    const points = container.querySelectorAll('li > span[aria-hidden="true"]');
    expect(points.length).toBe(4);
    expect(items[0].querySelector('span[aria-hidden="true"]')).toBeNull();
  });

  // ⚠️ Rien n'est replié derrière un bouton : la rangée passe à la ligne. Les cinq liens sont dans
  // le HTML SERVI, et aucun n'est masqué (Google indexe la version mobile).
  it("sert les cinq liens dans le HTML, sans rien de masqué", () => {
    const html = renderToStaticMarkup(
      <MenuTiposPortada tipos={[...TIPOS]} etiqueta="Tipos de oferta" testId="selector-tipos" />
    );
    for (const { href } of TIPOS) expect(html).toContain(`href="${href}"`);
    expect(html).not.toContain("<button");
    // Aucun lien masqué : ni attribut `hidden`, ni classe qui sortirait un libellé de l'écran.
    const dom = new DOMParser().parseFromString(html, "text/html");
    for (const lien of dom.querySelectorAll("a")) {
      expect(lien.closest("[hidden]")).toBeNull();
      const classes = lien.className.split(/\s+/);
      expect(classes).not.toContain("hidden");
      expect(classes).not.toContain("sr-only");
    }
  });

  it("garde 44 px de cible tactile sur chaque lien", () => {
    for (const lien of rendu().querySelectorAll("a")) {
      expect(lien.className).toContain("min-h-11");
    }
  });

  it("reste un Server Component : ni \"use client\", ni @hifago/ui", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "MenuTiposPortada.tsx"), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toContain("@hifago/ui");
  });
});
