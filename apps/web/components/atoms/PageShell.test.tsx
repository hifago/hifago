import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageShell } from "./PageShell";

function shell(variant: "pagina" | "portada", children = <p>contenido</p>) {
  const { container } = render(<PageShell variant={variant}>{children}</PageShell>);
  return { container, main: container.firstElementChild as HTMLElement };
}

describe("PageShell", () => {
  it("rend un unique <main> sans ajouter de titre ni de landmark", () => {
    const { container, main } = shell("pagina");
    expect(container.children.length).toBe(1);
    expect(main.tagName).toBe("MAIN");
    expect(main.querySelector("h1, h2, h3, h4, h5, h6, header, footer, nav")).toBeNull();
  });

  it("rend la colonne de l'accueil en variant pagina", () => {
    const { main } = shell("pagina");
    expect(main.className).toContain("grid-cols-[1fr_min(60rem,100%_-_2.5rem)_1fr]");
    expect(main.className).toContain("sm:grid-cols-[1fr_min(60rem,100%_-_4rem)_1fr]");
    expect(main.className).toContain("pb-12");
    expect(main.className).not.toContain("max-w-");
  });

  it("vise l'enfant ordinaire et épargne celui marqué data-bleed", () => {
    const { container, main } = shell(
      "pagina",
      <>
        <p data-testid="ordinaire">colonne</p>
        <section data-bleed="" data-testid="fond-perdu">rail</section>
      </>
    );
    const variante = main.className.split(" ").find((c) => c.startsWith("[&>*")) as string;
    const selecteur = variante.slice(1, variante.indexOf("]:"));
    // Le sélecteur Tailwind est aussi exercé dans le DOM, sans en recopier une seconde version.
    const css = variante.slice(1, variante.indexOf("]:")).replace("&", "main");
    const vises = [...container.querySelectorAll(css)].map((el) => el.getAttribute("data-testid"));
    expect(selecteur).toContain(":not([data-bleed])");
    expect(vises).toEqual(["ordinaire"]);
  });

  it("ne pose ni padding, ni grille, ni largeur en variant portada", () => {
    const { main } = shell("portada");
    expect(main.className).toBe("flex w-full flex-1 flex-col");
  });

  it("expose le testId et déclare la surface or à la demande", () => {
    const { container } = render(
      <PageShell variant="pagina" fondo="acento" testId="page">
        <p>contenido</p>
      </PageShell>
    );
    const main = container.querySelector("[data-testid='page']") as HTMLElement;
    expect(main.tagName).toBe("MAIN");
    expect(main.getAttribute("data-fondo")).toBe("acento");
    expect(main.getAttribute("data-superficie")).toBe("or");
  });
});
