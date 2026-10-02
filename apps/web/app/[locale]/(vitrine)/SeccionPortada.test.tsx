import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TarjetaOferta } from "@/lib/catalog/tipos";
import { SeccionPortada, type SeccionPortadaProps } from "./SeccionPortada";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Même doublure du `Link` localisé que `SeccionOfertas.test.tsx` : le vrai tire next/navigation,
// dont la résolution casse sous Vitest. Il rend un vrai `<a href>`, ce qui suffit à observer CE QUE
// la section lie, et où.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

// `next/image` remplacé par un `<img>` nu : on observe QUELLE image la section demande (la
// première photo, le « GO » du logo) et son `alt`, pas l'URL d'optimisation que fabrique Next.
vi.mock("next/image", () => ({
  default: ({ src, alt, sizes }: { src: string; alt: string; sizes?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- doublure de test de `next/image`
    <img src={src} alt={alt} data-sizes={sizes} />
  ),
}));

function carte(n: number, fotos: string[] = [`/mock/foto-${n}-a.jpg`, `/mock/foto-${n}-b.jpg`]): TarjetaOferta {
  return {
    clave: `clave-${n}`,
    href: `/productos/oferta-${n}`,
    nombre: `Oferta ${n}`,
    establecimiento: null,
    precio: null,
    fotos: fotos.map((url) => ({ url })),
    tipo: "activity",
    nAlojamientos: null,
    capacidad: null,
    testId: `tarjeta-oferta-${n}`,
  } as TarjetaOferta;
}

const OCHO = Array.from({ length: 8 }, (_, i) => carte(i + 1));

function rendu(props: Partial<SeccionPortadaProps> = {}) {
  return render(
    <SeccionPortada
      titulo="Actividades"
      hrefVerMas="/actividades"
      labelVerMas="Más actividades"
      mostrarVerMas
      tarjetas={OCHO}
      testId="seccion-activity"
      {...props}
    />
  ).container;
}

describe("SeccionPortada", () => {
  // ⚠️ LE CONTRAT QUE LES E2E LISENT (`e2e/home.spec.ts`) : `main section[data-testid]`, puis
  // `seccion-<tipo>-titulo` en <h2>, puis `seccion-<tipo>-ver-mas`. Le changement de maquette ne
  // doit en casser aucun — c'est ce que vérifie ce test, pas l'apparence.
  it("garde les identifiants que les e2e lisent : section, titre en <h2>, lien « ver más »", () => {
    const container = rendu();
    const section = container.querySelector("section") as HTMLElement;
    expect(section.getAttribute("data-testid")).toBe("seccion-activity");
    expect(section.getAttribute("aria-label")).toBe("Actividades");

    const titre = container.querySelector('[data-testid="seccion-activity-titulo"]') as HTMLElement;
    expect(titre.tagName).toBe("H2");
    expect(titre.textContent).toBe("Actividades");
    expect(container.querySelectorAll("h2").length).toBe(1);

    expect(container.querySelector('[data-testid="seccion-activity-ver-mas"]')?.getAttribute("href")).toBe(
      "/actividades"
    );
  });

  // Le point bleu, le trait et le motif sont des ORNEMENTS : aucun ne doit être annoncé.
  it("garde les ornements hors de l'arbre d'accessibilité", () => {
    const container = rendu();
    const point = container.querySelector("h2 > span") as HTMLElement;
    expect(point.getAttribute("aria-hidden")).toBe("true");
    expect(point.textContent).toBe("");
    const ornements = container.querySelectorAll('section > [aria-hidden="true"], section > div > [aria-hidden="true"]');
    expect(ornements.length).toBeGreaterThanOrEqual(2); // le trait, le motif
  });

  // Huit offres servies, trois à l'écran : la rangée défile DANS le conteneur. Toutes doivent être
  // dans le HTML SERVI — c'est le contenu principal de la page, et les e2e cliquent des offres
  // nommées qui ne sont pas forcément dans les trois premières.
  it("sert les huit offres dans le HTML, chacune avec sa carte et son lien", () => {
    const html = renderToStaticMarkup(
      <SeccionPortada
        titulo="Actividades"
        hrefVerMas="/actividades"
        labelVerMas="Más actividades"
        mostrarVerMas
        tarjetas={OCHO}
        testId="seccion-activity"
      />
    );
    for (let n = 1; n <= 8; n += 1) {
      expect(html).toContain(`data-testid="tarjeta-oferta-${n}"`);
      expect(html).toContain(`data-testid="tarjeta-oferta-${n}-link"`);
      expect(html).toContain(`href="/productos/oferta-${n}"`);
    }
  });

  it("nomme chaque lien par le nom de l'offre, et ne décrit pas la photo une seconde fois", () => {
    const container = rendu();
    const lien = container.querySelector('[data-testid="tarjeta-oferta-3-link"]') as HTMLAnchorElement;
    expect(lien.textContent).toBe("Oferta 3");
    // La PREMIÈRE photo seulement, et `alt=""` : le lien dit déjà ce que c'est.
    const photo = container.querySelector('[data-testid="tarjeta-oferta-3"] img') as HTMLImageElement;
    expect(photo.getAttribute("src")).toBe("/mock/foto-3-a.jpg");
    expect(photo.getAttribute("alt")).toBe("");
    expect(container.querySelectorAll('[data-testid="tarjeta-oferta-3"] img').length).toBe(1);
  });

  // Sans photo, le nom n'attend pas le survol : sinon la tuile serait un carré muet.
  it("montre le nom en permanence sur une offre sans photo", () => {
    const container = rendu({ tarjetas: [carte(1), carte(2, [])] });
    const avecPhoto = container.querySelector('[data-testid="tarjeta-oferta-1-link"] span') as HTMLElement;
    const sansPhoto = container.querySelector('[data-testid="tarjeta-oferta-2-link"] span') as HTMLElement;
    expect(avecPhoto.className).toContain("opacity-0");
    expect(sansPhoto.className).not.toContain("opacity-0");
    expect(sansPhoto.textContent).toBe("Oferta 2");
    expect(container.querySelector('[data-testid="tarjeta-oferta-2"] img')).toBeNull();
  });

  // « GO → » : le nom accessible contient « GO », le texte qu'on voit (WCAG 2.5.3), puis le libellé
  // complet — c'est aussi le texte d'ancre qu'un moteur lit.
  it("nomme le lien « GO → » par ce qu'on voit puis par sa destination", () => {
    const container = rendu();
    const go = container.querySelector('[data-testid="seccion-activity-ver-mas"]') as HTMLAnchorElement;
    expect(go.querySelector("img")?.getAttribute("alt")).toBe("GO");
    expect(go.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(go.textContent).toContain("Más actividades");
  });

  it("ne rend pas « GO → » quand la page le lui demande", () => {
    const container = rendu({ mostrarVerMas: false });
    expect(container.querySelector('[data-testid="seccion-activity-ver-mas"]')).toBeNull();
  });

  // ⚠️ Les deux défauts vus au rendu le 2026-10-01, tenus ici parce qu'aucun typecheck ne les voit :
  //   · une marge haute sur le conteneur FUSIONNAIT avec celle de son bloc, et le motif démarrait à
  //     sa hauteur au lieu de le dépasser au-dessus — d'où un padding sur le bloc, jamais de marge ;
  //   · deux photos dans un conteneur pleine largeur laissaient un tiers de marine vide (le retour
  //     de Jérôme sur la version précédente) — d'où des photos en `cqw` et un conteneur `w-fit`.
  it("ajuste le conteneur à ses photos, et place le motif par un padding — jamais une marge", () => {
    const container = rendu({ tarjetas: [carte(1), carte(2)] });
    const liste = container.querySelector("ul") as HTMLElement;
    const boite = liste.parentElement?.parentElement as HTMLElement;
    expect(boite.className).toContain("w-fit");
    expect(boite.className).toContain("max-w-[92.5cqw]");
    const bloc = boite.parentElement as HTMLElement;
    expect(bloc.className).toContain("pt-[6.3cqw]");
    expect(boite.className).not.toMatch(/\bmt-/);
    for (const li of liste.querySelectorAll("li")) {
      expect(li.className).toContain("w-[27.83cqw]");
    }
  });

  // ⚠️ La décision structurante : aucune interactivité, donc aucun JavaScript. Le HTML des sections
  // est servi tel quel — c'est lui que Google indexe. Vérifié sur le TEXTE du fichier : une règle
  // que rien ne vérifie n'est pas une règle (CLAUDE.md §11.20).
  it("reste un Server Component : ni \"use client\", ni @hifago/ui", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "SeccionPortada.tsx"), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toContain("@hifago/ui");
  });
});
