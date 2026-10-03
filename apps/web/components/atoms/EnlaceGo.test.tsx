import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { EnlaceGo, type EnlaceGoProps } from "./EnlaceGo";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Même doublure que `BackLink.test.tsx` : `data-localized` distingue le `Link` localisé d'un `<a>`
// nu, que ce test laisserait sinon passer.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} data-localized="true" {...props}>
      {children}
    </a>
  ),
}));

// `next/image` remplacé par un `<img>` nu : on observe quelle image et quel `alt`, pas l'URL
// d'optimisation que fabrique Next.
vi.mock("next/image", () => ({
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- doublure de test de `next/image`
    <img src={src} alt={alt} className={className} />
  ),
}));

function rendre(props: Partial<EnlaceGoProps> = {}) {
  const { container } = render(
    <EnlaceGo href="/actividades" label="Más actividades" tamano="normal" testId="go" {...props} />
  );
  return container.querySelector("[data-testid='go']") as HTMLAnchorElement;
}

describe("EnlaceGo", () => {
  it("passe par le Link localisé, vers la cible demandée", () => {
    const lien = rendre();
    expect(lien.tagName).toBe("A");
    expect(lien.getAttribute("data-localized")).toBe("true");
    expect(lien.getAttribute("href")).toBe("/actividades");
  });

  // WCAG 2.5.3 : le nom accessible commence par ce qu'on voit (« GO »), puis nomme la cible.
  it("se nomme « GO » puis par sa cible, la flèche restant muette", () => {
    const lien = rendre();
    expect(lien.querySelector("img")?.getAttribute("alt")).toBe("GO");
    expect(lien.querySelector("img")?.getAttribute("src")).toBe("/brand/go.webp");
    expect(lien.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(lien.querySelector(".sr-only")?.textContent).toBe("Más actividades");
  });

  it("garde une cible de 44 px et un focus visible", () => {
    const classes = rendre().className.split(/\s+/);
    expect(classes).toContain("min-h-11");
    expect(classes).toContain("focus-visible:status-focused");
  });

  // La flèche suit la surface (F3) : bleu poudre sur l'or, bleu moyen sur le clair.
  it("peint la flèche avec le jeton de surface --flecha-go", () => {
    expect(rendre().querySelector("svg")?.getAttribute("class")).toContain("stroke-[var(--flecha-go)]");
  });

  // ⚠️ L'accueil doit rester identique au pixel : ce sont les classes qu'il écrivait à la main avant
  // S5 (`SeccionPortada.tsx`), lien, GO et flèche.
  it("portada reprend exactement les tailles cqw de l'accueil", () => {
    const lien = rendre({ tamano: "portada" });
    expect(lien.className.split(/\s+/)).toEqual(expect.arrayContaining(["-mr-1", "gap-[1.4cqw]"]));
    expect(lien.querySelector("img")?.className).toContain("h-[clamp(1.75rem,5.1cqw,3.25rem)]");
    expect(lien.querySelector("svg")?.getAttribute("class")).toContain("h-[clamp(1.1rem,3.6cqw,2.25rem)]");
  });

  it("normal : GO de 32 px et flèche de 20 px, sans unité de conteneur", () => {
    const lien = rendre({ tamano: "normal" });
    expect(lien.querySelector("img")?.className.split(/\s+/)).toContain("h-8");
    expect(lien.querySelector("svg")?.getAttribute("class")?.split(/\s+/)).toContain("h-5");
    expect(lien.outerHTML).not.toContain("cqw");
  });

  it("coupe les transitions sous prefers-reduced-motion", () => {
    const lien = rendre();
    expect(lien.querySelector("img")?.className).toContain("motion-reduce:transition-none");
    expect(lien.querySelector("svg")?.getAttribute("class")).toContain("motion-reduce:transition-none");
  });

  it("reste un Server Component : ni \"use client\", ni @hifago/ui", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "EnlaceGo.tsx"), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toMatch(/from ["']@hifago\/ui/);
  });
});
