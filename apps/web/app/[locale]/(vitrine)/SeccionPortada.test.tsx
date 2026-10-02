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

// La rangée (`FilaPortada`, client) observe sa taille pour ses voiles de bord : jsdom n'a pas de
// `ResizeObserver`. Doublure inerte, comme `CarruselConSombra.test.tsx` — les voiles ont leur test.
class ObservateurInerte {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
window.ResizeObserver ??= ObservateurInerte as unknown as typeof window.ResizeObserver;

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
      locale="es"
      labelDesde="Desde"
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
        locale="es"
        labelDesde="Desde"
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

  // ⚠️ La référence de Jérôme du 2026-10-02 : le nom n'attend PLUS le survol, avec ou sans photo —
  // il est dans le cartouche, toujours visible. Le défaut à craindre est silencieux : une légende
  // qui resterait en `opacity-0` passerait tous les tests de structure.
  it("montre le nom en permanence dans le cartouche, avec ou sans photo, et l'établissement dessous", () => {
    const container = rendu({
      tarjetas: [{ ...carte(1), establecimiento: "Casa Kayam" }, carte(2, [])],
    });
    for (const n of [1, 2]) {
      const lien = container.querySelector(`[data-testid="tarjeta-oferta-${n}-link"]`) as HTMLElement;
      expect(lien.className).not.toContain("opacity-0");
      expect(lien.parentElement?.className).toContain("bg-[var(--background)]");
    }
    const tuile1 = container.querySelector('[data-testid="tarjeta-oferta-1"]') as HTMLElement;
    expect(tuile1.querySelector("p")?.textContent).toBe("Casa Kayam");
    expect(container.querySelector('[data-testid="tarjeta-oferta-2"] img')).toBeNull();
  });

  // Le lien est le TITRE étiré : ni l'établissement ni le prix n'entrent dans son nom accessible,
  // et aucun de ses ancêtres sous la tuile n'est positionné — sinon son `::after` ne couvrirait
  // plus la photo, et un clic sur l'image ne mènerait nulle part.
  it("garde le lien nommé par le seul nom de l'offre, étiré sur toute la tuile", () => {
    const container = rendu({
      tarjetas: [{ ...carte(1), establecimiento: "Casa Kayam", precio: { tipo: "monto", cop: 95000 } }],
    });
    const tuile = container.querySelector('[data-testid="tarjeta-oferta-1"]') as HTMLElement;
    const lien = container.querySelector('[data-testid="tarjeta-oferta-1-link"]') as HTMLElement;
    expect(lien.textContent).toBe("Oferta 1");
    expect(lien.className).toContain("after:inset-0");
    expect(tuile.className).toMatch(/(^|\s)relative(\s|$)/);
    let noeud = lien.parentElement;
    while (noeud && noeud !== tuile) {
      expect(noeud.className).not.toMatch(/(^|\s)(absolute|relative|fixed|sticky)(\s|$)/);
      noeud = noeud.parentElement;
    }
  });

  // Les quatre formes du prix, même règle que `TarjetaOferta` : `texto` jamais formaté en COP,
  // `null` sans aucune bulle — jamais « 0 COP ».
  it("pose le prix dans une bulle selon sa forme, et aucune bulle sans prix", () => {
    const container = rendu({
      tarjetas: [
        { ...carte(1), precio: { tipo: "monto", cop: 95000 } },
        { ...carte(2), precio: { tipo: "desde", cop: 180000 } },
        { ...carte(3), precio: { tipo: "texto", label: "Entrada libre" } },
        carte(4),
      ],
    });
    const bulle = (n: number) => container.querySelector(`[data-testid="tarjeta-oferta-${n}-precio"]`);
    expect(bulle(1)?.textContent).toContain("95.000");
    expect(bulle(1)?.className).toContain("rounded-full");
    expect(bulle(2)?.textContent).toMatch(/^Desde .*180\.000/);
    expect(bulle(3)?.textContent).toBe("Entrada libre");
    expect(bulle(4)).toBeNull();
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
    // ul → enveloppe des voiles (`FilaPortada`) → conteneur marine → bloc ajusté.
    const boite = liste.parentElement?.parentElement?.parentElement as HTMLElement;
    expect(boite.className).toContain("w-fit");
    // Liseré marine divisé par deux le 2026-10-02 : conteneur à sa taille d'origine, photos
    // agrandies de tout l'espace libéré.
    expect(boite.className).toContain("max-w-[92.5cqw]");
    expect(liste.parentElement?.parentElement?.className).toContain("p-[1.3cqw]");
    const bloc = boite.parentElement as HTMLElement;
    expect(bloc.className).toContain("pt-[6.3cqw]");
    expect(boite.className).not.toMatch(/\bmt-/);
    for (const li of liste.querySelectorAll("li")) {
      expect(li.className).toContain("md:w-[28.69cqw]");
    }
  });

  // ⚠️ Accueil mobile du 2026-10-02 (Jérôme : « juste une seule carte », puis « centrée, sans la
  // bouger ») : sous `md`, une photo seule remplit le conteneur, et sa marge droite égale sa marge
  // gauche. Quatre nombres répartis sur deux éléments doivent rester d'accord — le calcul est refait
  // ici sur les classes elles-mêmes, pour qu'un réglage de l'un sans les autres casse ce test.
  // Son intérieur (arrondi, cartouche, bulles, texte) est en `cqw` DE LA TUILE — sans `@container`
  // sur le `<li>`, ces valeurs se résoudraient sur la section et tout serait 3,5 fois trop grand.
  it("montre une seule photo sous md, centrée, trois au-dessus, et garde les proportions de la tuile", () => {
    const container = rendu();
    const liste = container.querySelector("ul") as HTMLElement;
    // ul → enveloppe des voiles (`FilaPortada`) → conteneur marine → bloc décalé.
    const marine = liste.parentElement?.parentElement as HTMLElement;
    const bloc = marine.parentElement as HTMLElement;
    // La valeur d'une classe de BASE (la variante mobile, sans `md:`) en cqw : `ml-[7.5cqw]` → 7.5.
    const cqw = (el: Element, prefixe: string) => {
      const classe = el.className
        .split(/\s+/)
        .find((c) => c.startsWith(`${prefixe}-[`) && c.endsWith("cqw]"));
      expect(classe, `${prefixe}-[…cqw] absent de « ${el.className} »`).toBeDefined();
      return Number(classe!.slice(prefixe.length + 2, -4));
    };
    const margeInterieure = cqw(marine, "p");
    const bordGauche = cqw(bloc, "ml") + margeInterieure;
    const interieur = cqw(bloc, "max-w") - 2 * margeInterieure;
    for (const li of liste.querySelectorAll("li")) {
      const classes = li.className.split(/\s+/);
      expect(classes).toContain("md:w-[28.69cqw]");
      expect(classes).toContain("@container");
      const largeur = cqw(li, "w");
      // Centrée : autant de marge à droite qu'à gauche, au centième près (arrondi à la baisse).
      expect(100 - bordGauche - largeur).toBeGreaterThanOrEqual(bordGauche);
      expect(100 - bordGauche - largeur).toBeLessThan(bordGauche + 0.02);
      // Une photo pile dans le conteneur : aucune amorce de la suivante.
      expect(interieur - largeur).toBeGreaterThanOrEqual(0);
      expect(interieur - largeur).toBeLessThan(0.02);
    }
  });

  // ⚠️ Tuiles carrées arrondies à 16 px (Jérôme, 2026-10-02). Deux fichiers doivent rester d'accord :
  // la tuile (`Tesela`) et les voiles de bord (`FilaPortada`), qui recouvrent son arrondi — un voile
  // plus ou moins arrondi qu'elle déborderait sur le marine ou laisserait un coin net. Et pas
  // `rounded-2xl` : le thème vitrine le calcule à 8 px (2 × `--radius`, mesuré au rendu).
  it("rend des tuiles carrées arrondies à 16 px, et des voiles au même arrondi", () => {
    const container = rendu();
    const tuile = container.querySelector('[data-testid="tarjeta-oferta-1"]') as HTMLElement;
    const classes = tuile.className.split(/\s+/);
    expect(classes).toContain("aspect-square");
    expect(classes).toContain("rounded-[16px]");
    expect(tuile.className).not.toMatch(/aspect-\[|rounded-\[[\d.]+cqw\]/);
    const voile = (cote: string) =>
      (container.querySelector(`[data-testid="seccion-activity-fila-velo-${cote}"]`) as HTMLElement).className;
    expect(voile("izquierda").split(/\s+/)).toContain("rounded-l-[16px]");
    expect(voile("derecha").split(/\s+/)).toContain("rounded-r-[16px]");
    // Un seul arrondi à toute largeur : plus de variante `md:` qui reprendrait l'ancien.
    expect(`${voile("izquierda")} ${voile("derecha")}`).not.toMatch(/md:rounded-/);
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
