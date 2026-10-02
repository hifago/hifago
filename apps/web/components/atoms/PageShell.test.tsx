import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PageShell } from "./PageShell";

// Pas de @testing-library/jest-dom dans ce monorepo (cf. CatalogBrowser.test.tsx) — assertions sur
// des propriétés/queries DOM natives uniquement.
//
// Ce fichier teste la SÉMANTIQUE, pas l'apparence : qu'il n'y a qu'un <main>, qu'il ne contient
// aucun landmark ni titre de sa propre initiative, et que chaque variant garde sa largeur. Les
// classes exactes sont vérifiées parce qu'elles SONT le contrat de cet atome — il n'a rien d'autre.
function shell(variant: "large" | "narrow" | "centered", children = <p>contenu</p>) {
  const { container } = render(<PageShell variant={variant}>{children}</PageShell>);
  const main = container.firstElementChild as HTMLElement;
  return { container, main };
}

describe("PageShell", () => {
  it("rend un <main>, et un seul élément racine", () => {
    const { container, main } = shell("large");
    expect(container.children.length).toBe(1);
    expect(main.tagName).toBe("MAIN");
    expect(container.querySelectorAll("main").length).toBe(1);
  });

  // ⚠️ Le garde-fou principal : une coquille qui rendrait un titre ou un landmark de son côté
  // produirait plusieurs <h1>/<header> par page dès qu'une page en ajoute un. Le niveau appartient
  // à Title, <header>/<footer> appartiennent au layout (vague 2).
  it("ne rend ni titre, ni <header>, ni <footer>, ni <nav>", () => {
    const { main } = shell("centered");
    expect(main.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(main.querySelector("header, footer, nav")).toBeNull();
  });

  // ⚠️ LE CONTRAT DE `large` A CHANGÉ LE 2026-10-01 : ce n'est plus une colonne bornée par
  // `max-w-3xl`, c'est une grille `1fr | lecture | 1fr` — la seule structure qui laisse un enfant
  // dépasser la colonne de lecture sans unité `vw` (le raisonnement complet est en tête de
  // PageShell.tsx). Ces deux `min()` ne sont PAS des valeurs choisies : elles REPRODUISENT la boîte
  // de contenu de `max-w-3xl p-6 sm:p-8` (48rem − 3rem = 45rem ; 48rem − 4rem = 44rem), et c'est ce
  // qui garantit qu'aucune page n'a bougé d'un pixel en gagnant le fond perdu — vérifié au rendu
  // réel le 2026-10-01 : 704 px de lecture à 1280, 342 px à 390, les mêmes qu'avant.
  it("rend une grille à trois colonnes en variant large, sans borner le <main> lui-même", () => {
    const { main } = shell("large");
    expect(main.className).toContain("grid-cols-[1fr_min(45rem,100%_-_3rem)_1fr]");
    expect(main.className).toContain("sm:grid-cols-[1fr_min(44rem,100%_-_4rem)_1fr]");
    // Le <main> fait toute la largeur du viewport : c'est précisément ce qui permet le fond perdu.
    // Ni `max-w-`, ni `mx-auto` — ce sont les deux colonnes `1fr` qui centrent la lecture.
    expect(main.className).toContain("w-full");
    expect(main.className).not.toContain("max-w-");
    expect(main.className).not.toContain("mx-auto");
  });

  // ⚠️ Le garde-fou de la règle de colonne, et il ne peut PAS être une comparaison de chaînes : une
  // variante arbitraire mal écrite (crochets déséquilibrés, `&` oublié) produit un sélecteur qui ne
  // matche simplement jamais, et la page se rend alors en trois colonnes de contenu sans qu'aucun
  // test de classe ne bronche. On extrait donc le sélecteur de la classe elle-même et on le fait
  // TOURNER sur un vrai DOM — jamais un sélecteur jumeau recopié ici, qui resterait juste tout seul.
  it("vise l'enfant ordinaire et épargne celui marqué data-bleed", () => {
    const { container, main } = shell(
      "large",
      <>
        <p data-testid="ordinaire">colonne de lecture</p>
        <section data-bleed="" data-testid="fond-perdu">
          rangée de cartes
        </section>
      </>
    );

    const variante = main.className.split(" ").find((c) => c.startsWith("[&>*")) as string;
    expect(variante).toContain(":col-start-2");
    const selecteur = variante.slice(1, variante.indexOf("]:")).replace("&", "main");

    const vises = [...container.querySelectorAll(selecteur)].map((el) =>
      el.getAttribute("data-testid")
    );
    expect(vises).toContain("ordinaire");
    expect(vises).not.toContain("fond-perdu");
  });

  it("borne la largeur à max-w-2xl en variant narrow", () => {
    const { main } = shell("narrow");
    expect(main.className).toContain("max-w-2xl");
    expect(main.className).not.toContain("max-w-3xl");
  });

  it("centre sans borner la largeur en variant centered", () => {
    const { main } = shell("centered");
    expect(main.className).toContain("items-center");
    expect(main.className).toContain("justify-center");
    expect(main.className).not.toContain("max-w-");
    // Le `text-center` de verify-email est l'alignement du contenu de cette page, pas la coquille.
    expect(main.className).not.toContain("text-center");
  });

  it("applique le même gap-6 et le même p-6 sm:p-8 à narrow et centered", () => {
    for (const variant of ["narrow", "centered"] as const) {
      const { main } = shell(variant);
      // Un seul gap : le `gap-4` de deux pages était une dérive, pas une décision.
      expect(main.className).toContain("gap-6");
      expect(main.className).not.toContain("gap-4");
      // Mobile d'abord : 24 px de marge sur petit écran, 32 px à partir de `sm`.
      expect(main.className).toContain("p-6");
      expect(main.className).toContain("sm:p-8");
    }
  });

  // `large` est la seule variante exclue de la règle ci-dessus, et les deux écarts se justifient
  // l'un comme l'autre par la grille — pas par un goût.
  it("remplace le padding horizontal de large par ses deux colonnes latérales", () => {
    const { main } = shell("large");
    // Mêmes 24/32 px qu'ailleurs, mais sur l'axe vertical SEULEMENT : à l'horizontale ce sont les
    // colonnes `1fr`, et un enfant à fond perdu doit pouvoir les traverser — un `px-*` résiduel le
    // rognerait de 24 px à chaque bord sans que rien ne le signale.
    expect(main.className).toContain("py-6");
    expect(main.className).toContain("sm:py-8");
    // `gap-y-6` et non `gap-6` : un `column-gap` rognerait les trois pistes de la grille.
    expect(main.className).toContain("gap-y-6");

    // La variante est retirée avant comparaison : `sm:px-8` rognerait les bords aussi sûrement
    // que `px-8`, et une regex ancrée sur le début de la classe l'aurait laissé passer.
    const utilitaire = (classe: string) => classe.slice(classe.lastIndexOf(":") + 1);
    const classes = main.className.split(" ").map(utilitaire);
    expect(classes.filter((c) => c.startsWith("p-") || c.startsWith("px-"))).toEqual([]);
    expect(classes.filter((c) => c.startsWith("gap-") && !c.startsWith("gap-y-"))).toEqual([]);
  });

  it("expose testId sur le <main>", () => {
    const { container } = render(
      <PageShell variant="large" testId="page-accueil">
        <p>contenu</p>
      </PageShell>
    );
    expect(container.querySelector('[data-testid="page-accueil"]')?.tagName).toBe("MAIN");
  });

  it("rend ses enfants tels quels", () => {
    const { main } = shell("narrow", <p data-testid="enfant">bonjour</p>);
    expect(main.querySelector('[data-testid="enfant"]')?.textContent).toBe("bonjour");
  });

  // Le contrat avec `globals.css` (fond or de l'accueil, 2026-10-01) : la coquille ne peint rien,
  // elle DÉCLARE — c'est `body:has(main[data-fondo="acento"])` qui propage l'or au body et au header.
  it("déclare le fond or par `data-fondo`, et seulement quand on le demande", () => {
    const avec = render(
      <PageShell variant="large" fondo="acento">
        <p>x</p>
      </PageShell>
    ).container.querySelector("main") as HTMLElement;
    expect(avec.getAttribute("data-fondo")).toBe("acento");
    const { main } = shell("large", <p>x</p>);
    expect(main.hasAttribute("data-fondo")).toBe(false);
  });
  // `portada` — l'accueil de la maquette du 2026-10-01 : son héros commence SOUS le header
  // transparent, tout en haut de l'écran. La coquille ne doit donc RIEN poser : ni padding (le héros
  // démarrerait 24 px trop bas), ni grille, ni largeur — la page s'aligne sur `COLUMNA_PORTADA`.
  it("ne pose ni padding, ni grille, ni largeur en variant portada", () => {
    const { container } = render(
      <PageShell variant="portada">
        <p>x</p>
      </PageShell>
    );
    const main = container.querySelector("main") as HTMLElement;
    const utilitaires = main.className.split(" ").map((c) => c.slice(c.lastIndexOf(":") + 1));
    expect(utilitaires.filter((c) => /^(p[xytblr]?|gap(-[xy])?|grid|max-w)-/.test(c) || c === "grid")).toEqual([]);
    // Elle garde ce qui fait d'elle LA coquille : elle pousse le pied de page en bas.
    expect(utilitaires).toContain("flex-1");
  });
});
