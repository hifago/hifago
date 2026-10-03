import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { FilaRiel } from "./FilaRiel";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Même montage que `CarruselConSombra.test.tsx`, qui teste la mesure partagée
// (`useBordesDesplazables`) en détail : jsdom ne fait aucune mise en page, les trois dimensions de
// défilement sont donc posées à la main, puis un `scroll` réel force la relecture. Ici on ne
// vérifie que ce que cette rangée-ci ajoute : DEUX VOILES qui suivent la mesure, décoratifs.

class ObservateurInerte {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

window.ResizeObserver ??= ObservateurInerte as unknown as typeof window.ResizeObserver;

function definirDimensiones(
  el: HTMLElement,
  dims: { scrollWidth: number; clientWidth: number; scrollLeft: number }
) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: dims.scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: dims.clientWidth });
  Object.defineProperty(el, "scrollLeft", { configurable: true, value: dims.scrollLeft });
}

function rendu() {
  return render(
    <FilaRiel testId="fila">
      <li>Tuile 1</li>
      <li>Tuile 2</li>
    </FilaRiel>
  );
}

describe("FilaRiel", () => {
  it("rend ses tuiles dans la liste qui défile", () => {
    const { container } = rendu();
    expect(container.querySelectorAll("ul > li").length).toBe(2);
  });

  // ⚠️ Le voile dit « il reste des photos par là » : allumé à droite au repos d'une rangée qui
  // déborde, à gauche après un défilement, éteint au bord atteint. Un voile toujours allumé
  // flouterait la dernière photo d'une rangée déjà parcourue jusqu'au bout.
  it("⚠️ floute le bord d'où il reste des photos à faire défiler, et seulement celui-là", () => {
    const { container, getByTestId } = rendu();
    const liste = container.querySelector("ul") as HTMLElement;
    const gauche = getByTestId("fila-velo-izquierda");
    const droite = getByTestId("fila-velo-derecha");

    // Rien ne déborde (jsdom mesure 0) : aucun voile.
    expect(gauche.className).toContain("opacity-0");
    expect(droite.className).toContain("opacity-0");

    // Au repos, cinq photos de plus à droite.
    definirDimensiones(liste, { scrollWidth: 1000, clientWidth: 300, scrollLeft: 0 });
    fireEvent.scroll(liste);
    expect(gauche.className).toContain("opacity-0");
    expect(droite.className).toContain("opacity-100");

    // Au milieu : les deux.
    definirDimensiones(liste, { scrollWidth: 1000, clientWidth: 300, scrollLeft: 400 });
    fireEvent.scroll(liste);
    expect(gauche.className).toContain("opacity-100");
    expect(droite.className).toContain("opacity-100");

    // Au bout : plus rien à droite.
    definirDimensiones(liste, { scrollWidth: 1000, clientWidth: 300, scrollLeft: 700 });
    fireEvent.scroll(liste);
    expect(gauche.className).toContain("opacity-100");
    expect(droite.className).toContain("opacity-0");
    expect(droite.className).not.toContain("opacity-100");
  });

  // Le voile recouvre le bord d'une tuile cliquable : il ne doit ni intercepter le clic, ni être
  // annoncé, et il doit passer AU-DESSUS du calque de texte des tuiles (`z-[1]`) pour flouter aussi
  // le cartouche.
  it("garde les voiles décoratifs : hors de l'assistance, transparents au clic, flous", () => {
    const { getByTestId } = rendu();
    for (const id of ["fila-velo-izquierda", "fila-velo-derecha"]) {
      const velo = getByTestId(id);
      expect(velo.getAttribute("aria-hidden")).toBe("true");
      expect(velo.className).toContain("pointer-events-none");
      expect(velo.className).toContain("backdrop-blur-sm");
      expect(velo.className).toContain("z-[2]");
    }
  });
});
