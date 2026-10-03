import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TarjetaOferta } from "@/lib/catalog/tipos";
import { TeselaOferta, type TeselaOfertaProps } from "./TeselaOferta";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Ce que ce fichier tient : les règles de la tuile qui ne se voient pas sur un rendu « qui a l'air
// juste » — le lien étiré nommé par le seul nom, la photo décorative, les quatre formes du prix,
// une bulle par information présente, le rayon fixe de 16 px et les planchers de texte. La forme
// elle-même (carré, cartouche, bulles) se juge dans les stories, à 390 et 1 280 px.

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} data-localized="true" {...props}>
      {children}
    </a>
  ),
}));

// `next/image` remplacé par un `<img>` nu : on observe QUELLE photo, son `alt`, son `sizes` et sa
// priorité, pas l'URL d'optimisation que fabrique Next.
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    sizes,
    priority,
    loading,
  }: {
    src: string;
    alt: string;
    sizes?: string;
    priority?: boolean;
    loading?: "lazy";
  }) => (
    // eslint-disable-next-line @next/next/no-img-element -- doublure de test de `next/image`
    <img src={src} alt={alt} data-sizes={sizes} data-priority={priority ? "true" : "false"} loading={loading} />
  ),
}));

function oferta(patch: Partial<TarjetaOferta> = {}): TarjetaOferta {
  return {
    clave: "producto-1",
    href: "/productos/kayak",
    nombre: "Kayak en el embalse",
    establecimiento: "Casa del Embalse",
    precio: { tipo: "monto", cop: 20000 },
    fotos: [{ url: "/mock/kayak-1.jpg" }, { url: "/mock/kayak-2.jpg" }],
    tipo: "activity",
    nAlojamientos: null,
    capacidad: null,
    testId: "tarjeta-kayak",
    ...patch,
  };
}

const SIZES = "(min-width: 1024px) 300px, (min-width: 768px) 45vw, 90vw";

function rendre(patch: Partial<TarjetaOferta> = {}, props: Partial<TeselaOfertaProps> = {}) {
  const { container } = render(
    <TeselaOferta oferta={oferta(patch)} locale="es" labelDesde="Desde" sizes={SIZES} {...props} />
  );
  const tuile = container.querySelector("[data-testid='tarjeta-kayak']") as HTMLElement;
  if (!tuile) throw new Error("TeselaOferta n'a rien rendu");
  const sous = (suffixe: string) => tuile.querySelector(`[data-testid='tarjeta-kayak-${suffixe}']`);
  return { tuile, sous };
}

describe("TeselaOferta", () => {
  // ⚠️ Le rayon ne s'écrit ni par l'échelle (`rounded-2xl` = 8 px dans le thème vitrine, mesuré) ni
  // en `cqw` (il varierait d'une grille à un rail) : 16 px fixes, comme la tuile de l'accueil.
  it("rend une tuile carrée, arrondie à 16 px fixes, conteneur de requête pour son intérieur", () => {
    const classes = rendre().tuile.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["aspect-square", "rounded-[16px]", "@container"]));
    expect(rendre().tuile.className).not.toMatch(/rounded-(2xl|3xl|\[[\d.]+cqw\])/);
  });

  it("passe par le Link localisé, nommé par le seul nom de l'offre, étiré sur toute la tuile", () => {
    const { tuile, sous } = rendre({}, { labelCapacidad: "Hasta 2 personas" });
    const lien = sous("link") as HTMLAnchorElement;
    expect(lien.getAttribute("data-localized")).toBe("true");
    expect(lien.getAttribute("href")).toBe("/productos/kayak");
    expect(lien.textContent).toBe("Kayak en el embalse");
    expect(lien.className).toContain("after:inset-0");
    // Aucun ancêtre positionné entre le lien et la tuile : sinon le `::after` ne couvrirait plus
    // la photo, et un clic sur l'image ne mènerait nulle part.
    expect(tuile.className).toMatch(/(^|\s)relative(\s|$)/);
    let noeud = lien.parentElement;
    while (noeud && noeud !== tuile) {
      expect(noeud.className).not.toMatch(/(^|\s)(absolute|relative|fixed|sticky)(\s|$)/);
      noeud = noeud.parentElement;
    }
  });

  // Le nom est un lien dans une liste, comme sur l'accueil : pas de titre HTML (l'ancien `<h3>` des
  // cartes de listing était en police de titre à 18 px, en faux gras, et sautait un niveau).
  it("ne rend aucun titre HTML", () => {
    expect(rendre().tuile.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
  });

  // D6 = A : une seule photo, décorative. Le texte « <nom>, foto i de n » des anciennes cartes de
  // listing disparaît avec leur carrousel, et c'est voulu — le lien dit déjà ce que c'est.
  it("montre la PREMIÈRE photo seulement, décorative, au sizes de l'appelant", () => {
    const images = rendre().tuile.querySelectorAll("img");
    expect(images.length).toBe(1);
    expect(images[0].getAttribute("src")).toBe("/mock/kayak-1.jpg");
    expect(images[0].getAttribute("alt")).toBe("");
    expect(images[0].getAttribute("data-sizes")).toBe(SIZES);
  });

  it("sans photo : aucune image, le fond bleu poudre de la tuile garde la forme", () => {
    const { tuile } = rendre({ fotos: [] });
    expect(tuile.querySelector("img")).toBeNull();
    expect(tuile.className).toContain("bg-[var(--default)]");
  });

  it("prioridad : la photo est prioritaire et perd son lazy ; sinon elle reste lazy", () => {
    const prioritaire = rendre({}, { prioridad: true }).tuile.querySelector("img") as HTMLImageElement;
    expect(prioritaire.getAttribute("data-priority")).toBe("true");
    expect(prioritaire.hasAttribute("loading")).toBe(false);
    const ordinaire = rendre().tuile.querySelector("img") as HTMLImageElement;
    expect(ordinaire.getAttribute("data-priority")).toBe("false");
    expect(ordinaire.getAttribute("loading")).toBe("lazy");
  });

  it("pose le prix dans une bulle selon sa forme — texte jamais formaté, aucune bulle sans prix", () => {
    expect(rendre({ precio: { tipo: "monto", cop: 95000 } }).sous("precio")?.textContent).toContain("95.000");
    expect(rendre({ precio: { tipo: "desde", cop: 180000 } }).sous("precio")?.textContent).toMatch(
      /^Desde .*180\.000/
    );
    const texto = rendre({ precio: { tipo: "texto", label: "Entrada libre" } }).sous("precio");
    expect(texto?.textContent).toBe("Entrada libre");
    expect(rendre({ precio: null }).sous("precio")).toBeNull();
  });

  it("une bulle par information présente : prix et capacité, jamais une bulle vide", () => {
    const avec = rendre({ capacidad: 4 }, { labelCapacidad: "Hasta 4 personas" });
    expect(avec.sous("precio")?.className).toContain("rounded-full");
    expect(avec.sous("capacidad")?.textContent).toBe("Hasta 4 personas");
    // La capacité ne s'affiche que si la carte la porte, même si un libellé traîne.
    expect(rendre({ capacidad: null }, { labelCapacidad: "Hasta 4 personas" }).sous("capacidad")).toBeNull();
    // Ni prix ni capacité : pas même le conteneur des bulles.
    const sans = rendre({ precio: null });
    expect(sans.tuile.querySelector(".rounded-full")).toBeNull();
  });

  it("sous-titre : l'établissement, ou le décompte d'une carte groupée, ou rien", () => {
    expect(rendre().tuile.querySelector("p")?.textContent).toBe("Casa del Embalse");
    const groupee = rendre({ establecimiento: null, nAlojamientos: 3 }, { labelConteo: "3 alojamientos" });
    expect(groupee.tuile.querySelector("p")?.textContent).toBe("3 alojamientos");
    expect(rendre({ establecimiento: null }).tuile.querySelector("p")).toBeNull();
  });

  // Les planchers du plan (S4) : la borne basse de chaque `clamp`. Sans eux, une tuile de 202 px
  // (rail à 768 px d'écran) écrivait le nom à 11 px et l'établissement à 10.
  it("tient les planchers de texte : nom 13 px, établissement 12 px, bulles 11 px", () => {
    const { tuile, sous } = rendre();
    expect(sous("link")?.className).toContain("text-[clamp(0.8125rem,");
    expect(tuile.querySelector("p")?.className).toContain("text-[clamp(0.75rem,");
    expect(sous("precio")?.className).toContain("text-[clamp(0.6875rem,");
  });

  it("garde le nom visible en permanence, dans le cartouche clair", () => {
    const lien = rendre().sous("link") as HTMLElement;
    expect(lien.className).not.toContain("opacity-0");
    expect(lien.parentElement?.className).toContain("bg-[var(--background)]");
  });

  it("se rend côté serveur, sans contexte i18n", () => {
    const html = renderToStaticMarkup(
      <TeselaOferta oferta={oferta()} locale="es" labelDesde="Desde" sizes={SIZES} />
    );
    expect(html).toContain('data-testid="tarjeta-kayak-link"');
  });

  it("reste un Server Component : ni \"use client\", ni @hifago/ui", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "TeselaOferta.tsx"), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toMatch(/from ["']@hifago\/ui/);
  });
});
