import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { IconLink } from "./IconLink";
import { IconButton } from "./IconButton";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Même mock que les autres tests du dossier : `@/i18n/navigation` tire next-intl/navigation →
// next/navigation, dont la résolution casse sous Vitest. `data-localized` distingue le vrai Link
// localisé d'un `<a>` nu — sans lui ce test passerait aussi avec `next/link`, c'est-à-dire avec un
// lien qui perd le préfixe de locale.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} data-localized="true" {...props}>
      {children}
    </a>
  ),
}));

const Croix = () => <svg data-testid="icone" />;

function lien(element: React.ReactElement) {
  const { container } = render(element);
  return container.querySelector("a") as HTMLAnchorElement;
}

describe("IconLink", () => {
  // ⚠️ La raison d'être du composant : ce que Jérôme demandait — un bouton rond à icône qui
  // NAVIGUE — n'était constructible ni avec `IconButton` (un vrai <button>, sans href) ni avec
  // `LinkButton` (qui exige un libellé visible).
  it("est un LIEN, pas un bouton", () => {
    const element = lien(<IconLink icon={<Croix />} label="Carrito" href="/pago" />);
    expect(element.tagName).toBe("A");
    expect(element.getAttribute("href")).toBe("/pago");
    expect(element.getAttribute("data-localized")).toBe("true");
  });

  it("porte son nom accessible et rend l'icône décorative", () => {
    const element = lien(<IconLink icon={<Croix />} label="Carrito, 2 artículos" href="/pago" />);
    expect(element.getAttribute("aria-label")).toBe("Carrito, 2 artículos");
    expect(element.textContent).toBe("");
    const cache = element.querySelector('[aria-hidden="true"]');
    expect(cache?.querySelector('[data-testid="icone"]')).not.toBeNull();
  });

  it("est rond par défaut, carré sur demande", () => {
    expect(lien(<IconLink icon={<Croix />} label="C" href="/x" />).className).toContain("rounded-full");
    expect(
      lien(<IconLink icon={<Croix />} label="C" href="/x" shape="square" />).className
    ).toContain("rounded-[var(--rayon-bouton)]");
  });

  it("prend la largeur carrée et la taille lg de la famille", () => {
    const element = lien(<IconLink icon={<Croix />} label="C" href="/x" />);
    expect(element.className).toContain("button--icon-only");
    expect(element.className).toContain("button--lg");
    // 44 × 44 px à toutes les tailles, comme IconButton (plan 41, item F4).
    expect(element.className).toContain("size-11");
  });

  // ⚠️ Un `<a class="button">` ne reçoit PAS l'anneau de focus de HeroUI : `.button` ne le pose que
  // sur `[data-focus-visible="true"]`, un attribut que seul le <Button> react-aria reçoit. Sans
  // cette classe, le lien serait focalisable sans aucun anneau visible (WCAG 2.4.7).
  it("porte l'anneau de focus des liens habillés en bouton", () => {
    expect(lien(<IconLink icon={<Croix />} label="C" href="/x" />).className).toContain(
      "focus-visible:status-focused"
    );
  });

  // Le garde-fou anti-divergence de la famille : quatre composants, une seule table de couleurs.
  it("partage exactement les classes de couleur d'IconButton", () => {
    const bouton = render(<IconButton icon={<Croix />} label="C" variant="soft" color="danger" />);
    const classesBouton = (bouton.container.querySelector("button") as HTMLElement).className;
    const classesLien = lien(
      <IconLink icon={<Croix />} label="C" href="/x" variant="soft" color="danger" />
    ).className;
    for (const classe of ["[--btn-fill:var(--danger)]", "[--button-bg:var(--btn-tint)]"]) {
      expect(classesBouton).toContain(classe);
      expect(classesLien).toContain(classe);
    }
  });
});
