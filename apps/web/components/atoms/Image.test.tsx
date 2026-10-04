import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Image } from "./Image";

// Pas de @testing-library/jest-dom dans ce monorepo (cf. CatalogBrowser.test.tsx) — assertions DOM
// natives uniquement.
//
// Ce que ces tests protègent vraiment, c'est le contrat d'accessibilité et de performance qui
// justifie l'existence de l'atome : `alt` et `sizes` traversent bien jusqu'au <img>, la priorité de
// chargement produit bien un preload, et un produit sans photo rend un substitut plutôt qu'un trou
// (ou pire, une balise <img> sans source).

// ⚠️ Source MATRICIELLE, pas le `/globe.svg` des stories, et c'est le point du test suivant :
// next/image reconnaît un SVG comme non optimisable et supprime alors `sizes` ET `srcset` de la
// balise rendue. Tester le contrat `sizes` sur un SVG l'aurait donc validé à vide.
const SRC = "/photo-produit.jpg";
const SIZES = "(max-width: 640px) 100vw, 50vw";

function rendre(props: Partial<React.ComponentProps<typeof Image>> = {}) {
  const { container } = render(
    <Image src={SRC} alt="Vue du embalse" sizes={SIZES} loading="lazy" {...props} />
  );
  return container;
}

// ⚠️ `document.head` n'est PAS nettoyé entre deux tests : `ReactDOM.preload` écrit dans le document
// et dédoublonne par URL, donc un preload posé par un test précédent survit au démontage. D'où une
// source DISTINCTE par test de priorité — sinon « aucun preload » passerait au vert sur un preload
// laissé par le test d'à côté, ou l'inverse.
function preloadDe(src: string): Element | undefined {
  return Array.from(document.head.querySelectorAll('link[rel="preload"][as="image"]')).find((lien) => {
    // Raster : la source est dans `imagesrcset`, encodée (`%2F`), et `href` est délibérément omis
    // par next/image. Vectoriel : pas de srcset du tout, la source est dans `href`, telle quelle.
    const cible = `${lien.getAttribute("imagesrcset") ?? ""} ${lien.getAttribute("href") ?? ""}`;
    return cible.includes(encodeURIComponent(src)) || cible.includes(src);
  });
}

describe("Image", () => {
  it("rend une <img> avec son alt et son sizes quand la source existe", () => {
    const img = rendre().querySelector("img");
    if (!img) throw new Error("aucune <img> rendue");
    expect(img.getAttribute("alt")).toBe("Vue du embalse");
    expect(img.getAttribute("sizes")).toBe(SIZES);
    // `sizes` n'a de valeur que s'il pilote vraiment un jeu de sources : sans srcset, il ne sert
    // à rien et la raison d'être de l'atome tombe.
    expect(img.getAttribute("srcset")).toContain("w=640");
  });

  it("⚠️ constat : next/image ignore sizes et srcset pour un SVG (source non optimisable)", () => {
    // Non corrigé, à connaître : rendre `sizes` obligatoire par le type ne fait respecter la règle
    // que pour les images matricielles. Sur un SVG la prop est acceptée puis jetée en silence —
    // sans conséquence de bande passante (le vectoriel n'a pas de variantes de taille), mais toute
    // vérification faite sur un SVG mesurerait le vide.
    const img = rendre({ src: "/vectoriel-test.svg" }).querySelector("img");
    expect(img?.getAttribute("sizes")).toBeNull();
    expect(img?.getAttribute("srcset")).toBeNull();
  });

  it('loading="lazy" pose loading="lazy" sur la balise, et AUCUN preload', () => {
    const img = rendre({ src: "/lazy-mesure.jpg" }).querySelector("img");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(preloadDe("/lazy-mesure.jpg")).toBeUndefined();
  });

  it('loading="priority" retire loading="lazy" et fait injecter un <link rel="preload"> dans <head>', () => {
    const img = rendre({ src: "/priority-mesure.jpg", loading: "priority" }).querySelector("img");
    if (!img) throw new Error("aucune <img> rendue");

    // ⚠️ Mesuré sur Next 16.3.0, pas supposé : `priority` ne pose RIEN sur la balise. Pas de
    // `loading="eager"`, et — changement de Next 16 — plus de `fetchpriority="high"` non plus
    // (jusqu'à Next 15, `priority` l'impliquait). La seule différence visible sur le <img> est
    // l'absence de `loading="lazy"`.
    expect(img.hasAttribute("loading")).toBe(false);
    expect(img.hasAttribute("fetchpriority")).toBe(false);

    // Le vrai effet est ici : c'est le preload qui fait découvrir l'image au navigateur sans
    // attendre la mise en page — donc la seule assertion qui prouve la priorité.
    const preload = preloadDe("/priority-mesure.jpg");
    expect(preload).toBeDefined();
    expect(preload?.getAttribute("imagesizes")).toBe(SIZES);
  });

  it("⚠️ constat : sur un SVG, priority SURVIT là où sizes et srcset sont jetés", () => {
    // L'asymétrie vaut d'être figée : la même source non optimisable perd son jeu de tailles mais
    // garde sa priorité de chargement. Une vérification de priorité faite sur un SVG mesure donc
    // bien quelque chose, contrairement à une vérification de `sizes`.
    const img = rendre({ src: "/priority-mesure.svg", loading: "priority" }).querySelector("img");
    expect(img?.getAttribute("srcset")).toBeNull();
    expect(img?.hasAttribute("loading")).toBe(false);

    const preload = preloadDe("/priority-mesure.svg");
    expect(preload).toBeDefined();
    // Pas de srcset à annoncer : next/image retombe sur `href`, et `imagesizes` disparaît avec lui.
    expect(preload?.getAttribute("href")).toBe("/priority-mesure.svg");
    expect(preload?.getAttribute("imagesizes")).toBeNull();
  });

  it("n'injecte aucun preload quand src vaut null, même en priority", () => {
    // La prop reste exigée par le type, mais sans source il n'y a rien à précharger : le substitut
    // ne doit pas laisser un `<link rel=preload>` pointant nulle part dans le <head>. Compté avant
    // et après, parce que le <head> porte déjà les preloads des tests précédents.
    const compter = () => document.head.querySelectorAll('link[rel="preload"][as="image"]').length;
    const avant = compter();
    rendre({ src: null, loading: "priority" });
    expect(compter()).toBe(avant);
  });

  it("rend le substitut et AUCUNE balise <img> quand src vaut null", () => {
    const container = rendre({ src: null, testId: "photo" });
    expect(container.querySelector("img")).toBeNull();

    const substitut = container.querySelector('[data-testid="photo-placeholder"]');
    expect(substitut).not.toBeNull();
    // Le substitut n'annonce rien à un lecteur d'écran : il n'y a pas d'image à décrire.
    expect(substitut?.getAttribute("aria-hidden")).toBe("true");
  });

  it("garde le même ratio avec et sans visuel — la carte qui l'accueille ne s'effondre pas", () => {
    const avec = rendre({ ratio: "16/9" }).firstElementChild?.getAttribute("class");
    const sans = rendre({ ratio: "16/9", src: null }).firstElementChild?.getAttribute("class");
    expect(avec).toBe(sans);
  });

  it("applique le ratio 4/3 par défaut, et un ratio différent quand on le demande", () => {
    const defaut = rendre().firstElementChild?.getAttribute("class");
    const explicite = rendre({ ratio: "4/3" }).firstElementChild?.getAttribute("class");
    const carre = rendre({ ratio: "1/1" }).firstElementChild?.getAttribute("class");

    expect(defaut).toBe(explicite);
    expect(carre).not.toBe(defaut);
  });

  it("ne fixe aucune largeur en dur : le conteneur prend celle de son parent", () => {
    const classes = (rendre().firstElementChild?.getAttribute("class") ?? "").split(" ");
    // Une largeur en dur (`w-64`, `max-w-*`) réintroduirait le débordement horizontal que le
    // README interdit ; seul `w-full` est attendu ici.
    expect(classes.filter((c) => c.startsWith("w-") || c.startsWith("max-w-"))).toEqual(["w-full"]);
  });

  it("expose testId en data-testid sur le conteneur, et rien quand il est absent", () => {
    expect(rendre({ testId: "photo" }).firstElementChild?.getAttribute("data-testid")).toBe("photo");
    expect(rendre().firstElementChild?.hasAttribute("data-testid")).toBe(false);
  });
});
