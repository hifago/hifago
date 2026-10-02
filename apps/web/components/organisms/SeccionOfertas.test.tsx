import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TarjetaOferta as OfertaTarjeta } from "@/lib/catalog/tipos";
import { SeccionOfertas } from "./SeccionOfertas";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} data-localized="true" {...props}>
      {children}
    </a>
  ),
}));

// ⚠️ La carte est REMPLACÉE par une doublure, et c'est le point de ce fichier : on teste la
// SECTION — le niveau du titre, le nombre de `<li>`, la mise en page, le lien « Ver más » et la
// propagation de `prioridad`. La vraie carte appelle `useTranslations` et monte un carrousel ;
// la garder ici ferait échouer ces tests pour des raisons qui n'ont rien à voir avec la section,
// et les rendrait dépendants d'un composant écrit par un autre agent. Même geste que
// `ProductDetailView.test.tsx`, qui neutralise ses quatre formulaires et sa galerie.
//
// La doublure REND ses props en attributs `data-*` : c'est la seule façon d'observer ce que la
// section transmet réellement, plutôt que de faire confiance au type.
vi.mock("@/components/molecules/TarjetaOferta", () => ({
  TarjetaOferta: ({
    oferta,
    variante,
    locale,
    prioridad,
  }: {
    oferta: OfertaTarjeta;
    variante: "grilla" | "lista" | "carrusel";
    locale: string;
    prioridad?: boolean;
  }) => (
    <article
      data-testid={oferta.testId}
      data-variante={variante}
      data-locale={locale}
      data-prioridad={String(prioridad)}
    >
      {oferta.nombre}
    </article>
  ),
}));

// ⚠️ Même raison que pour `TarjetaOferta` ci-dessus : `CarruselConSombra` a son propre test dédié
// (mesure de `scrollWidth`/`clientWidth`, `ResizeObserver`) — le garder ici coupleraient ces tests
// de SECTION à son comportement interne, sans rien vérifier de plus sur `SeccionOfertas` elle-même.
// La doublure se contente de rendre ses enfants dans un conteneur identifiable par `testId`.
// ⚠️ Même raison que pour `TarjetaOferta` et `CarruselConSombra` : `BandaTitulo` a son propre
// fichier de test (le nombre de copies, le rendu serveur, la réaction au scroll), et son
// `useEffect` ferait dépendre CES tests-ci de `matchMedia` et `ResizeObserver`, que jsdom n'a pas.
// La doublure rend le titre au NIVEAU demandé — c'est ce que la section lui transmet, et donc la
// seule chose qu'on ait à observer d'ici.
vi.mock("@/components/molecules/BandaTitulo", () => ({
  BandaTitulo: ({
    titulo,
    tituloAs,
    testId,
  }: {
    titulo: string;
    tituloAs?: "h2" | "h3";
    testId?: string;
  }) => {
    const Etiqueta = tituloAs ?? "h2";
    return (
      <div data-testid={testId}>
        <Etiqueta data-testid={testId ? `${testId}-titulo` : undefined}>{titulo}</Etiqueta>
      </div>
    );
  },
}));

vi.mock("@/components/molecules/CarruselConSombra", () => ({
  CarruselConSombra: ({ children, testId }: { children: React.ReactNode; testId?: string }) => (
    <div data-testid={testId}>{children}</div>
  ),
}));

function tarjeta(n: number): OfertaTarjeta {
  return {
    clave: `p-${n}`,
    href: `/productos/oferta-${n}`,
    nombre: `Oferta ${n}`,
    establecimiento: "Casa Kayam",
    precio: { tipo: "monto", cop: 80000 },
    fotos: [{ url: "/globe.svg" }],
    tipo: "activity",
    capacidad: null,
    nAlojamientos: null,
    testId: `tarjeta-${n}`,
  };
}

const TARJETAS = [tarjeta(1), tarjeta(2), tarjeta(3)];

type Sobrecarga = Partial<React.ComponentProps<typeof SeccionOfertas>>;

function rendu(sobrecarga: Sobrecarga = {}) {
  const { container } = render(
    <SeccionOfertas
      titulo="Actividades"
      hrefVerMas="/actividades?personas=2"
      labelVerMas="Ver todas las actividades"
      variante="grilla"
      tarjetas={TARJETAS}
      locale="es"
      testId="seccion"
      {...sobrecarga}
    />
  );
  return {
    container,
    seccion: container.querySelector("section") as HTMLElement,
    lista: container.querySelector("ul") as HTMLElement,
  };
}

describe("SeccionOfertas", () => {
  it("rend un <section> nommé, avec son titre en <h2>", () => {
    const { seccion } = rendu();
    expect(seccion).not.toBeNull();
    // Sans nom accessible, un <section> n'est pas un repère de navigation : c'est une div.
    expect(seccion.getAttribute("aria-label")).toBe("Actividades");
    const titre = seccion.querySelector("h2") as HTMLElement;
    expect(titre).not.toBeNull();
    expect(titre.textContent).toBe("Actividades");
    // Le niveau ne se devine pas : aucun autre niveau n'est posé par la section.
    expect(seccion.querySelector("h1")).toBeNull();
    expect(seccion.querySelector("h3")).toBeNull();
  });

  it("respecte le niveau demandé par la page plutôt qu'un niveau deviné", () => {
    const { seccion } = rendu({ tituloAs: "h2" });
    expect((seccion.querySelector("h2") as HTMLElement).textContent).toBe("Actividades");
  });

  it("rend exactement un <li> par carte, jamais un de plus", () => {
    const { lista } = rendu();
    const items = lista.querySelectorAll("li");
    expect(items.length).toBe(TARJETAS.length);
    for (const [index, t] of TARJETAS.entries()) {
      const carte = items[index].querySelector(`[data-testid="${t.testId}"]`) as HTMLElement;
      expect(carte).not.toBeNull();
      expect(carte.textContent).toBe(t.nombre);
    }
  });

  it("ne rend aucun <li> quand la section n'a pas de carte, sans planter", () => {
    const { lista, container } = rendu({ tarjetas: [] });
    expect(lista.querySelectorAll("li").length).toBe(0);
    // Le lien reste servi : c'est la page qui décide de ne pas rendre une section vide (spec §8),
    // pas le composant, qui n'a pas la vue d'ensemble pour ça.
    expect(container.querySelector('[data-testid="seccion-ver-mas"]')).not.toBeNull();
  });

  it("porte le href et le libellé reçus sur son lien « Ver más »", () => {
    const { container } = rendu();
    const lien = container.querySelector('[data-testid="seccion-ver-mas"]') as HTMLAnchorElement;
    expect(lien.tagName).toBe("A");
    expect(lien.getAttribute("href")).toBe("/actividades?personas=2");
    expect(lien.textContent).toBe("Ver todas las actividades");
    // ⚠️ Le lien passe par le `Link` de @/i18n/navigation (que la doublure marque) : lui seul
    // conserve le préfixe de langue. Un <a href="/actividades"> renverrait un anglophone sur une
    // page sans langue.
    expect(lien.getAttribute("data-localized")).toBe("true");
    // 44 px de cible tactile, et une zone cliquable qui s'arrête au texte.
    expect(lien.className).toContain("min-h-11");
  });

  it("ne rend PAS le lien « Ver más » quand `mostrarVerMas` vaut faux — une catégorie sur son propre écran", () => {
    // Le pattern par catégorie (`/alojamientos`, `/actividades`, etc.) ne veut le lien QUE si la
    // catégorie a plus d'offres que celles montrées — contrairement à l'accueil, qui le rend
    // toujours (défaut `true`, testé juste avant/après).
    const { container } = rendu({ mostrarVerMas: false });
    expect(container.querySelector('[data-testid="seccion-ver-mas"]')).toBeNull();
  });

  it("rend le lien « Ver más » par défaut, et explicitement quand `mostrarVerMas` vaut vrai", () => {
    const parDefaut = rendu();
    expect(parDefaut.container.querySelector('[data-testid="seccion-ver-mas"]')).not.toBeNull();
    const explicite = rendu({ mostrarVerMas: true });
    expect(explicite.container.querySelector('[data-testid="seccion-ver-mas"]')).not.toBeNull();
  });

  it("accepte un libellé DIFFÉRENT pour les activités, dont le « Ver más » mène à un index de tags", () => {
    const { container } = rendu({
      hrefVerMas: "/actividades",
      labelVerMas: "Explorar por categoría",
    });
    const lien = container.querySelector('[data-testid="seccion-ver-mas"]') as HTMLAnchorElement;
    expect(lien.getAttribute("href")).toBe("/actividades");
    expect(lien.textContent).toBe("Explorar por categoría");
  });

  it("pose la grille responsive en variante « grilla » — 1 colonne, 2 à md, 3 à lg", () => {
    const { lista } = rendu({ variante: "grilla" });
    for (const classe of ["grid", "grid-cols-1", "md:grid-cols-2", "lg:grid-cols-3", "gap-4"]) {
      expect(lista.className).toContain(classe);
    }
    // Aucune largeur en dur : ce sont les colonnes qui s'ajoutent, jamais le conteneur qui se fige.
    expect(lista.className).not.toMatch(/\b(w|min-w|max-w)-\[/);
  });

  it("n'emploie AUCUNE classe de grille en variante « lista »", () => {
    const { lista } = rendu({ variante: "lista" });
    expect(lista.className).not.toContain("grid");
    expect(lista.className).toContain("flex");
    expect(lista.className).toContain("flex-col");
  });

  it("en variante « carrusel », délègue le défilement à CarruselConSombra et montre EXACTEMENT trois cartes à partir de md", () => {
    const { lista, container } = rendu({ variante: "carrusel" });
    // Le défilement (`overflow-x-auto`, `snap-*`) vit dans `CarruselConSombra` (testé à part), pas
    // sur le `<ul>` — cette section vérifie seulement qu'elle délègue bien à ce composant.
    expect(container.querySelector('[data-testid="seccion-carrusel"]')).not.toBeNull();
    expect(lista.className).not.toContain("grid");
    expect(lista.className).toContain("flex");
    // ⚠️ AUCUNE largeur sur ce `<ul>` depuis que le conteneur bleu ÉPOUSE les cartes (second
    // retour de Jérôme, 2026-10-01) : la rangée vaut la somme de ses cartes, et c'est cette
    // largeur naturelle que le conteneur `w-fit` enveloppe. Un `w-full` remis ici rendrait le
    // conteneur rectangulaire à nouveau — une section de deux cartes laisserait un tiers de bleu vide.
    expect(lista.className).toContain("shrink-0");
    expect(lista.className).not.toContain("w-full");

    // Le conteneur bleu épouse ses cartes, et les `cqw` des cartes lisent l'enveloppe au-dessus.
    const carrusel = container.querySelector('[data-testid="seccion-carrusel"]') as HTMLElement;
    const conteneur = carrusel.closest(".w-fit") as HTMLElement;
    expect(conteneur.className).toContain("w-fit");
    expect((conteneur.parentElement as HTMLElement).className).toContain("@container");

    const items = lista.querySelectorAll("li");
    // Exactement une carte par tarjeta : la carte « voir más » de fin de rangée a été remplacée
    // par un bouton sous le conteneur le 2026-10-01 (référence de Jérôme).
    expect(items.length).toBe(TARJETAS.length);
    for (const item of items) {
      // Un tiers de l'ENVELOPPE (`cqw`), paddings et gouttières déduits — jamais un `%` du
      // conteneur, qui serait circulaire maintenant qu'il prend la largeur de ses cartes. Sous
      // `md`, 82 % : une carte pleine plus l'amorce de la suivante. Rendu mesuré le 2026-10-01 à
      // 1280×900 : trois cartes remplissent l'enveloppe, deux cartes donnent un conteneur centré.
      expect(item.className).toContain("md:w-[calc((100cqw-4.5rem)/3)]");
      expect(item.className).toContain("w-[calc((100cqw-2rem)*0.82)]");
      expect(item.className).toContain("shrink-0");
      // Plus aucune largeur en pixels : la dérogation à `.claude/rules/ui.md` est levée.
      expect(item.className).not.toContain("w-64");
    }
  });

  // L'affordance « voir plus » a changé DEUX fois : lien après la liste (2026-09-08) → carte en
  // fin de rangée (2026-09-15) → bouton sous le conteneur (2026-10-01, la référence de Jérôme).
  // Ce test tient les trois états à la fois : il affirme le dernier ET l'absence des deux autres,
  // parce que le défaut à craindre n'est pas qu'il manque une affordance mais qu'il y en ait deux.
  it("en carrusel, l'affordance « voir plus » est UN bouton sous le conteneur, et rien d'autre", () => {
    const { lista, container } = rendu({ variante: "carrusel" });

    const bouton = container.querySelector('[data-testid="seccion-ver-mas"]') as HTMLAnchorElement;
    expect(bouton).not.toBeNull();
    expect(bouton.tagName).toBe("A");
    expect(bouton.getAttribute("href")).toBe("/actividades?personas=2");
    expect(bouton.textContent).toContain("Ver todas las actividades");
    // Le `Link` localisé, jamais un `<a href>` nu : le préfixe de langue est ce qui fait de ce
    // lien un vrai maillage interne. La doublure de `@/i18n/navigation` pose ce marqueur.
    expect(bouton.getAttribute("data-localized")).toBe("true");

    // Le bouton est dans la LANGUETTE qui sort du bas du conteneur bleu (2026-10-01) — ni dans
    // la rangée qui défile, ni dans le rectangle des cartes : c'est ce qui donne au conteneur sa
    // forme non rectangulaire. La languette est la sœur suivante du conteneur.
    const carrusel = container.querySelector('[data-testid="seccion-carrusel"]') as HTMLElement;
    const conteneur = carrusel.closest(".w-fit") as HTMLElement;
    expect(conteneur.contains(bouton)).toBe(false);
    const languette = conteneur.nextElementSibling as HTMLElement;
    expect(languette.contains(bouton)).toBe(true);
    expect(languette.className).toContain("rounded-b-3xl");

    // Aucune `<li>` sans carte d'offre : plus de carte « voir más » en fin de rangée.
    for (const item of lista.querySelectorAll("li")) {
      expect(item.querySelector("article")).not.toBeNull();
    }
  });

  // ⚠️ LE GARDE-FOU DU FOND PERDU (décision de Jérôme, 2026-10-01). Sans lui, « les cartes vont
  // d'un bord à l'autre » resterait un souhait (CLAUDE.md §11.20) : rien dans le rendu de cette
  // section ne trahirait sa disparition, puisque la mécanique vit dans `PageShell` et que jsdom ne
  // calcule aucune largeur. `data-bleed` EST le contrat entre les deux fichiers — c'est lui qui
  // sort la rangée de la colonne de lecture — et il ne doit exister QUE sur le carrusel : une
  // grille ou une liste à fond perdu décollerait du reste de la page sans raison.
  it("en carrusel SEULEMENT, la section prend les trois colonnes de la coquille", () => {
    const { seccion } = rendu({ variante: "carrusel" });
    expect(seccion.hasAttribute("data-bleed")).toBe(true);
    expect(seccion.className).toContain("col-span-full");
    // Le subgrid REPREND les pistes de `PageShell` au lieu d'en redéfinir d'équivalentes : c'est
    // ce qui garantit que le titre reste aligné sur le reste de la page sans que la largeur de la
    // colonne de lecture soit écrite à deux endroits.
    expect(seccion.className).toContain("grid-cols-subgrid");

    // ⚠️ LES DEUX COULEURS DE LA CHARTE, et le sens dans lequel elles vont. L'or EST le fond et le
    // marine est le texte — jamais l'inverse : « l'or ne porte jamais de texte sur fond clair »
    // (1.96:1) est l'un des trois interdits mesurés de `.claude/rules/ui.md`. Les JETONS, jamais
    // les hex : `#ddae09` écrit en dur ici ne suivrait ni le mode sombre ni une retouche de charte.
    expect(seccion.className).toContain("bg-accent");
    expect(seccion.className).toContain("text-accent-foreground");
    expect(seccion.className).not.toContain("text-accent ");
    expect(seccion.className).not.toMatch(/#[0-9a-f]{3,8}/i); // aucun hex en dur, quel qu'il soit

    for (const variante of ["grilla", "lista"] as const) {
      const autre = rendu({ variante }).seccion;
      expect(autre.hasAttribute("data-bleed")).toBe(false);
      expect(autre.className).not.toContain("col-span-full");
      // Ni l'or ni la bande : les deux autres variantes n'ont pas bougé d'un caractère.
      expect(autre.className).not.toContain("bg-accent");
    }
  });

  // ⚠️ LE TITRE PASSE PAR LA BANDE, ET SON NIVEAU NE S'Y PERD PAS. C'est le risque propre à la
  // refonte du 2026-10-01 : le titre de section n'est plus un `Title` posé par ce fichier mais un
  // composant client qui le reçoit en prop. Une section qui oublierait de transmettre `tituloAs`
  // rendrait un `<h2>` par défaut — juste par chance, et faux le jour où une page demande autre chose.
  it("en carrusel, le titre est porté par la bande défilante, au niveau demandé par la page", () => {
    const { seccion } = rendu({ variante: "carrusel" });

    const banda = seccion.querySelector('[data-testid="seccion-banda"]') as HTMLElement;
    expect(banda).not.toBeNull();
    const titre = banda.querySelector('[data-testid="seccion-banda-titulo"]') as HTMLElement;
    expect(titre.textContent).toBe("Actividades");
    expect(titre.tagName).toBe("H2");

    // Un seul titre de section dans tout le rendu : la bande ne doit pas s'ajouter au `Title` des
    // deux autres variantes, ni l'inverse.
    expect(seccion.querySelectorAll("h2").length).toBe(1);
    expect(seccion.querySelector('[data-testid="seccion-titulo"]')).toBeNull();
  });

  // Le conteneur bleu poudre longe les BORDS DE L'ÉCRAN, il ne revient pas dans la colonne de
  // lecture : c'est ce retrait constant qui laisse voir l'or tout autour, comme sur la référence.
  // Un `col-start-2` oublié ici le ramènerait à 704 px de large, encadré de 256 px d'or.
  it("en carrusel, le conteneur des cartes porte le bleu poudre et longe les bords de l'écran", () => {
    const { container } = rendu({ variante: "carrusel" });

    const conteneur = (container.querySelector('[data-testid="seccion-carrusel"]') as HTMLElement)
      .parentElement as HTMLElement;
    // Le jeton `--default` (le bleu poudre #b6cde8 de la charte), jamais l'hex en dur.
    expect(conteneur.className).toContain("bg-[var(--default)]");
    expect(conteneur.className).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(conteneur.className).toContain("rounded-3xl");

    const enveloppe = conteneur.parentElement as HTMLElement;
    expect(enveloppe.className).toContain("col-span-full");
    expect(enveloppe.className).toContain("px-3");
    expect(enveloppe.className).not.toContain("col-start-2");
  });

  it("en carrusel, `mostrarVerMas` à faux retire le bouton sans toucher aux cartes", () => {
    const { lista, container } = rendu({ variante: "carrusel", mostrarVerMas: false });
    expect(lista.querySelectorAll("li").length).toBe(TARJETAS.length);
    expect(container.querySelector('[data-testid="seccion-ver-mas"]')).toBeNull();
  });

  it("transmet la variante et la locale à chacune de ses cartes", () => {
    const { container } = rendu({ variante: "lista", locale: "en" });
    const cartes = container.querySelectorAll("article");
    expect(cartes.length).toBe(TARJETAS.length);
    for (const carte of cartes) {
      expect(carte.getAttribute("data-variante")).toBe("lista");
      expect(carte.getAttribute("data-locale")).toBe("en");
    }
  });

  // ⚠️ LE test du fichier. Une seule image de toute la page est le LCP : la première carte de la
  // première section. `prioridad` propagé à tout le monde poserait huit préchargements sur la
  // première section, dont sept sous la ligne de flottaison — la régression Core Web Vitals que
  // la prop `loading` de PhotoStrip existe précisément pour empêcher.
  it("ne rend prioritaire QUE la première carte d'une section prioritaire", () => {
    const { container } = rendu({ prioridad: true });
    const cartes = [...container.querySelectorAll("article")];
    expect(cartes.map((c) => c.getAttribute("data-prioridad"))).toEqual(["true", "false", "false"]);
  });

  it("ne rend AUCUNE carte prioritaire dans une section qui ne l'est pas", () => {
    const { container } = rendu();
    const cartes = [...container.querySelectorAll("article")];
    expect(cartes.map((c) => c.getAttribute("data-prioridad"))).toEqual(["false", "false", "false"]);
    // Absence de la prop ≠ prioritaire : le défaut est le cas le plus fréquent (4 sections sur 5).
    const { container: explicite } = rendu({ prioridad: false });
    expect(
      [...explicite.querySelectorAll("article")].every(
        (c) => c.getAttribute("data-prioridad") === "false"
      )
    ).toBe(true);
  });

  it("omet ses data-testid quand la page ne lui en donne pas", () => {
    const { container, seccion } = rendu({ testId: undefined });
    expect(seccion.hasAttribute("data-testid")).toBe(false);
    // Jamais de "undefined-ver-mas" : un testId absent ne fabrique pas un identifiant bancal.
    const identifiants = [...container.querySelectorAll("[data-testid]")].map((n) =>
      n.getAttribute("data-testid")
    );
    // Les seuls restants viennent des CARTES, qui portent le leur dans leurs données (spec §0).
    expect(identifiants).toEqual(TARJETAS.map((t) => t.testId));
    expect(container.innerHTML).not.toContain("undefined");
  });

  it("livre ses cartes et son lien dans le HTML SERVI, pas à l'hydratation", () => {
    // La raison d'être de ce test : les cinq sections SONT le contenu indexable de l'accueil. Si
    // elles n'arrivaient qu'après hydratation, Google verrait une page vide sous la barre de
    // recherche, et le maillage vers les listings n'existerait pas.
    const html = renderToStaticMarkup(
      <SeccionOfertas
        titulo="Actividades"
        hrefVerMas="/actividades"
        labelVerMas="Ver todas"
        variante="grilla"
        tarjetas={TARJETAS}
        locale="es"
        testId="seccion"
      />
    );
    expect(html).toContain("<h2");
    expect(html).toContain("Oferta 1");
    expect(html).toContain("Oferta 3");
    expect(html).toContain('href="/actividades"');
  });

  // ⚠️ Une règle documentée que rien ne vérifie n'est pas une règle : c'est un souhait
  // (CLAUDE.md §11.20). Celle-ci est invisible au typecheck, au lint ET en dev — un `"use client"`
  // ajouté ici par distraction ferait descendre cinq sections de huit cartes dans le navigateur
  // sans qu'aucun outil ne s'en plaigne, et un import de `@hifago/ui` casserait `next build` à
  // « Collecting page data » (CLAUDE.md §11.16). D'où une lecture du TEXTE du fichier.
  it("reste un Server Component : ni « use client », ni le moindre import de @hifago/ui", () => {
    // ⚠️ `new URL("./x", import.meta.url)` NE MARCHE PAS ici : sous l'environnement jsdom, le
    // constructeur `URL` global est celui de jsdom, qui résout un chemin relatif contre le
    // `baseURI` du document (`http://localhost:3000/…`) au lieu de la base passée en argument.
    // `fileURLToPath` de node:url n'a pas ce défaut.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "SeccionOfertas.tsx"),
      "utf8"
    );
    const sansCommentaires = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(sansCommentaires).not.toContain('"use client"');
    expect(sansCommentaires).not.toContain("@hifago/ui");
  });
});
