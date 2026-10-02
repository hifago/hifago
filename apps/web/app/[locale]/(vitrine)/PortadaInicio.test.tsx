import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { PortadaInicio } from "./PortadaInicio";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// `next/image` remplacé par un `<img>` nu : on observe quelle image le héros demande, comment il
// l'annonce (`alt`, `aria-hidden`) et où il la place (`className`), pas l'URL d'optimisation que
// fabrique Next.
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    ...props
  }: {
    src: string;
    alt: string;
    "aria-hidden"?: boolean;
    className?: string;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element -- doublure de test de `next/image`
    <img src={src} alt={alt} aria-hidden={props["aria-hidden"]} className={props.className} />
  ),
}));

function rendu() {
  return render(
    <PortadaInicio
      titulo={"Guatapé merece\nmás de un día."}
      lema={"Arma tu viaje y vívelo\na tu ritmo."}
      navegacion={<nav data-testid="nav-de-test" />}
      busqueda={<div data-testid="busqueda-de-test" />}
      testId="portada"
    />
  ).container;
}

describe("PortadaInicio", () => {
  // ⚠️ INVARIANT DE LA SPEC 28 (§0.3) : un seul <h1> par page, et il a un TEXTE. Depuis la seconde
  // maquette (2026-10-02), c'est le titre VISIBLE du héros — le « bloc titré » que la spec attendait
  // pour lever son masquage provisoire. Le logo devient un décor, hors du <h1>.
  it("fait du titre visible le <h1>, et du logo un décor hors du titre", () => {
    const container = rendu();
    const titres = container.querySelectorAll("h1");
    expect(titres.length).toBe(1);
    expect(titres[0].querySelector(".sr-only")).toBeNull();
    const logo = container.querySelector('img[src="/brand/logo-portada.webp"]') as HTMLImageElement;
    expect(logo.getAttribute("alt")).toBe("");
    expect(logo.getAttribute("aria-hidden")).toBe("true");
    expect(logo.closest("h1")).toBeNull();
  });

  // ⚠️ La coupure de ligne de la maquette passe par un `\n` rendu en `whitespace-pre-line`, JAMAIS
  // par un <br> : un <br> ne laisse aucun caractère dans le `textContent` — moteurs et lecteurs
  // d'écran liraient « mereceMás ». Le `\n`, lui, y reste un blanc entre les deux mots.
  it("coupe le titre et le sous-titre sans coller les mots du texte lu", () => {
    const container = rendu();
    const titre = container.querySelector("h1") as HTMLElement;
    expect(titre.textContent).toBe("Guatapé merece\nmás de un día.");
    expect(titre.querySelector("br")).toBeNull();
    expect(titre.innerHTML).toContain("whitespace-pre-line");
    const lema = container.querySelector('[data-testid="portada-lema"]') as HTMLElement;
    expect(lema.tagName).toBe("P");
    expect(lema.textContent).toBe("Arma tu viaje y vívelo\na tu ritmo.");
    expect(lema.className).toContain("whitespace-pre-line");
  });

  // L'illustration de la rue est un DÉCOR : rien à annoncer, et hors du <h1>.
  it("pose l'illustration de la rue en décor, hors du titre", () => {
    const container = rendu();
    const rue = container.querySelector('img[src="/brand/calle-zocalos.webp"]') as HTMLImageElement;
    expect(rue.getAttribute("alt")).toBe("");
    expect(rue.getAttribute("aria-hidden")).toBe("true");
    expect(rue.closest("h1")).toBeNull();
  });

  // L'ordre de la maquette : le logo, le titre, le sous-titre, la navigation par type, PUIS la
  // recherche.
  it("rend logo, titre, sous-titre, navigation puis recherche, dans cet ordre", () => {
    const container = rendu();
    const ordre = [
      container.querySelector('img[src="/brand/logo-portada.webp"]'),
      container.querySelector("h1"),
      container.querySelector('[data-testid="portada-lema"]'),
      container.querySelector('[data-testid="nav-de-test"]'),
      container.querySelector('[data-testid="busqueda-de-test"]'),
    ] as HTMLElement[];
    for (let i = 1; i < ordre.length; i++) {
      expect(ordre[i - 1].compareDocumentPosition(ordre[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
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

  // ⚠️ DESCENSO_MOVIL (Jérôme, 2026-10-02) : sous `md`, logo, titre, sous-titre et filigrane
  // descendent de 50 px, puis les trois premiers de 10 px de plus — le filigrane, non ; puis le
  // menu se resserre (liens de 44 → 34 px) et descend vers la barre.
  // La recherche, elle, ne bouge pas. Cinq valeurs sur trois éléments et deux fichiers : c'est leur
  // ACCORD qu'on vérifie — et que `md:` remet tout à l'état d'avant, la demande ne visant que le
  // mobile.
  it("descend le haut du héros de 60 px sous md seulement, sans déplacer la recherche", () => {
    const container = rendu();
    const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);
    // Le décalage en px d'une marge `calc(… _±_Npx)`, signé ; 0 sans `calc`.
    const px = (classe: string | undefined) => {
      const m = classe?.match(/_([+-])_(\d+)px\)\]$/);
      return m ? Number(m[2]) * (m[1] === "-" ? -1 : 1) : 0;
    };
    const base = (el: Element | null, prefixe: string) =>
      classes(el).find((c) => c.startsWith(`${prefixe}-[`));
    const md = (el: Element | null, prefixe: string) =>
      classes(el).find((c) => c.startsWith(`md:${prefixe}-[`) || c === `md:${prefixe}-0`);

    const logo = container.querySelector('img[src="/brand/logo-portada.webp"]');
    const rue = container.querySelector('img[src="/brand/calle-zocalos.webp"]');
    const menu = container.querySelector('[data-testid="nav-de-test"]')?.parentElement ?? null;

    const descente = px(base(logo, "mt")) - px(md(logo, "mt")?.slice(3));
    expect(descente).toBe(60);
    expect(base(rue, "top")).toBe("top-[50px]");
    expect(md(rue, "top")).toBe("md:top-0");

    // Le menu, sur DEUX lignes (téléphones) : ses liens perdent `44 − 34` px chacun, lus dans
    // `MenuTiposPortada.tsx` — c'est leur accord avec les marges d'ici qu'on vérifie.
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "MenuTiposPortada.tsx"), "utf8");
    expect(source).toContain("md:min-h-11");
    const lienMobile = Number(source.match(/"[^"]*\bmin-h-\[(\d+)px\]/)?.[1]);
    const resserrement = 2 * (44 - lienMobile);
    // Marge basse sous `md` : `-mb-[Npx]` → −N ; `md:mb-0` remet à 0.
    const mbMobile = -Number(classes(menu).find((c) => c.startsWith("-mb-["))?.match(/\d+/)?.[0] ?? 0);
    expect(classes(menu)).toContain("md:mb-0");
    const deltaMt = px(base(menu, "mt")) - px(md(menu, "mt")?.slice(3));
    // La recherche ne bouge pas : ce que le logo a pris + ce que le menu prend au-dessus de lui,
    // moins ce qu'il perd en hauteur, plus sa marge basse = 0.
    expect(descente + deltaMt - resserrement + mbMobile).toBe(0);
    // Et la demande elle-même, ligne par ligne : la 2e ligne à 15 px de plus près de la barre, la
    // 1re à 10 px de plus près de la 2e. Décalage du centre de la 2e ligne par rapport à avant :
    // la marge du menu (sans la reprise du logo) + 1,5 lien de 34 au lieu de 1,5 lien de 44.
    expect(44 - lienMobile).toBe(10);
    expect(deltaMt + descente + 1.5 * lienMobile - 1.5 * 44).toBe(15);
  });

  it("reste un Server Component : ni \"use client\", ni @hifago/ui", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "PortadaInicio.tsx"), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toContain("@hifago/ui");
  });
});
