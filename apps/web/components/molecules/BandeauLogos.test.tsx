import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BandeauLogos, tailleAffichee, type LogoBandeau } from "./BandeauLogos";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
// jsdom ne joue aucune animation : le défilement lui-même se constate au navigateur. Ce fichier
// tient ce qui se casse sans se voir — combien de fois un logo est NOMMÉ, et ce qui reste quand le
// mouvement est coupé.

const MAIRIE: LogoBandeau = { src: "/logos/mairie.webp", alt: "Municipio de Guatapé", width: 443, height: 116 };
const PUEBLO: LogoBandeau = { src: "/logos/pueblo.webp", alt: "Pueblo de Zócalos", width: 805, height: 574 };

function rendu(logos: readonly LogoBandeau[]) {
  const { container } = render(<BandeauLogos logos={logos} testId="bandeau" />);
  return {
    bandeau: container.querySelector('[data-testid="bandeau"]') as HTMLElement | null,
    groupes: Array.from(container.querySelectorAll("ul")),
    images: Array.from(container.querySelectorAll("img")),
  };
}

function plusieurs(n: number): LogoBandeau[] {
  return Array.from({ length: n }, (_, i) => ({ ...MAIRIE, src: `/logos/${i}.webp`, alt: `Logo ${i}` }));
}

describe("BandeauLogos", () => {
  it("ne rend rien sans logo — ni bande vide ni filet orphelin", () => {
    expect(rendu([]).bandeau).toBeNull();
  });

  it("déroule deux groupes identiques, le second masqué aux lecteurs d'écran", () => {
    const { groupes } = rendu([MAIRIE, PUEBLO]);
    expect(groupes).toHaveLength(2);
    expect(groupes[0].getAttribute("aria-hidden")).toBeNull();
    expect(groupes[1].getAttribute("aria-hidden")).toBe("true");
    expect(groupes[1].children).toHaveLength(groupes[0].children.length);
  });

  it("nomme chaque logo UNE seule fois, quel que soit le nombre de répétitions", () => {
    const { images, groupes } = rendu([MAIRIE, PUEBLO]);
    const nommees = images.filter((image) => image.getAttribute("alt") !== "");
    expect(nommees.map((image) => image.getAttribute("alt"))).toEqual([MAIRIE.alt, PUEBLO.alt]);
    // Les répétitions du premier groupe sont masquées une à une ; celles du second par leur liste.
    const items = Array.from(groupes[0].children);
    expect(items.slice(0, 2).every((li) => li.getAttribute("aria-hidden") === null)).toBe(true);
    expect(items.slice(2).every((li) => li.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  it("répète une liste courte pour remplir la bande, et cesse dès qu'elle est assez longue", () => {
    expect(rendu([MAIRIE]).groupes[0].children).toHaveLength(8);
    expect(rendu([MAIRIE, PUEBLO]).groupes[0].children).toHaveLength(8);
    expect(rendu(plusieurs(3)).groupes[0].children).toHaveLength(9);
    expect(rendu(plusieurs(12)).groupes[0].children).toHaveLength(12);
  });

  it("garde une vitesse constante : la durée suit le nombre de logos du groupe", () => {
    expect(rendu([MAIRIE, PUEBLO]).bandeau?.style.getPropertyValue("--bandeau-duree")).toBe("40s");
    expect(rendu(plusieurs(12)).bandeau?.style.getPropertyValue("--bandeau-duree")).toBe("60s");
  });

  it("donne aux logos la même surface, pas la même hauteur", () => {
    const large = tailleAffichee(MAIRIE);
    const ramasse = tailleAffichee(PUEBLO);
    expect(large.height).toBeLessThan(ramasse.height);
    expect(large.width).toBeGreaterThan(ramasse.width);
    const surfaces = [large, ramasse].map(({ width, height }) => width * height);
    expect(Math.abs(surfaces[0] - surfaces[1]) / surfaces[0]).toBeLessThan(0.03);
    expect(tailleAffichee({ width: 200, height: 200 })).toEqual({ width: 104, height: 104 });
  });

  it("se met en pause au survol et au focus, et s'arrête sous prefers-reduced-motion", () => {
    const { groupes } = rendu([MAIRIE, PUEBLO]);
    for (const groupe of groupes) {
      expect(groupe.className).toContain("group-hover/bandeau:[animation-play-state:paused]");
      expect(groupe.className).toContain("group-focus-within/bandeau:[animation-play-state:paused]");
      expect(groupe.className).toContain("motion-reduce:animate-none");
    }
  });

  it("sans mouvement, ne laisse que les logos nommés — les répétitions disparaissent", () => {
    const { groupes } = rendu([MAIRIE, PUEBLO]);
    expect(groupes[1].className).toContain("motion-reduce:hidden");
    const items = Array.from(groupes[0].children);
    expect(items.slice(0, 2).every((li) => !li.className.includes("motion-reduce:hidden"))).toBe(true);
    expect(items.slice(2).every((li) => li.className.includes("motion-reduce:hidden"))).toBe(true);
  });

  it("ne peint aucune couleur : il se pose sur la surface qui le reçoit", () => {
    const { bandeau } = rendu([MAIRIE, PUEBLO]);
    expect(bandeau?.className).not.toMatch(/#[0-9a-fA-F]{3,8}\b|bg-|text-\[/);
  });
});
