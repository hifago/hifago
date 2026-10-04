import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { BackLink } from "./BackLink";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Même mock que ProductDetailView.test.tsx et CatalogBrowser.test.tsx : `@/i18n/navigation` tire
// next-intl/navigation → next/navigation, dont la résolution casse sous Vitest.
//
// ⚠️ Une différence assumée avec ces deux-là : le mock pose `data-localized`. Sans lui, ce test
// passerait à l'identique si BackLink utilisait `next/link` ou un `<a href>` nu — or c'est
// précisément ce que l'atome existe pour empêcher (seul le Link de @/i18n/navigation conserve le
// préfixe de locale). L'attribut est le seul moyen, sous mock, de distinguer les deux rendus.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} data-localized="true" {...props}>
      {children}
    </a>
  ),
}));

function lien(element: React.ReactElement) {
  const { container } = render(element);
  return container.firstElementChild as HTMLElement;
}

describe("BackLink", () => {
  it("passe par le Link localisé de @/i18n/navigation, jamais par un <a> nu", () => {
    const element = lien(<BackLink href="/" label="Volver al catálogo" />);
    expect(element.tagName).toBe("A");
    expect(element.getAttribute("data-localized")).toBe("true");
  });

  it("rend le href et le libellé déjà traduit qu'on lui donne", () => {
    const element = lien(
      <BackLink href="/establecimientos/casa-kayam-guatape" label="Volver al alojamiento" />
    );
    expect(element.getAttribute("href")).toBe("/establecimientos/casa-kayam-guatape");
    expect(element.textContent).toBe("Volver al alojamiento");
  });

  // ⚠️ La seconde raison d'être de l'atome : le motif d'origine était une ligne de texte de 14 px,
  // sous la cible tactile de 44 px exigée par components/README.md. `min-h-11` = 2,75rem = 44 px.
  it("garde une cible tactile d'au moins 44 px", () => {
    const element = lien(<BackLink href="/" label="Volver" />);
    expect(element.className).toContain("min-h-11");
    expect(element.className).toContain("inline-flex");
    expect(element.className).toContain("items-center");
  });

  // ⚠️ Sans `self-start`, l'`inline-flex` est blockifié dans un conteneur flex et `stretch`
  // l'étire sur toute la largeur : une bande cliquable de 44 px de haut d'un bord à l'autre, qui
  // navigue au moindre appui à droite du libellé. Mesuré à 342 px dans un PageShell à 390 px.
  it("ne s'étire pas sur toute la largeur de son conteneur flex", () => {
    const element = lien(<BackLink href="/" label="Volver" />);
    expect(element.className).toContain("self-start");
  });

  it("expose testId sur le lien", () => {
    const element = lien(<BackLink href="/" label="Volver" testId="back-to-catalog" />);
    expect(element.getAttribute("data-testid")).toBe("back-to-catalog");
  });

  // Plan 41, item C4 : une flèche DESSINÉE, décorative, devant le libellé. Un lien dont le sens
  // tiendrait dans un glyphe serait illisible pour un lecteur d'écran : elle est `aria-hidden`, et
  // le texte du lien — son nom accessible — reste le libellé seul, sans « ← » prononcé.
  it("dessine une flèche décorative, hors du nom accessible", () => {
    const element = lien(<BackLink href="/" label="Volver al catálogo" />);
    const fleche = element.querySelector("svg") as SVGElement;
    expect(fleche).not.toBeNull();
    expect(fleche.getAttribute("aria-hidden")).toBe("true");
    expect(element.firstElementChild).toBe(fleche);
    expect(element.textContent).toBe("Volver al catálogo");
  });
});
