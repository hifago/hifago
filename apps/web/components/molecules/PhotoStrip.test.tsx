import { describe, expect, it } from "vitest";
import { render as renderBrut } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/messages";
import { PhotoStrip, type PhotoStripPhoto } from "./PhotoStrip";

// ⚠️ `PhotoStrip` traduit désormais les trois libellés d'accessibilité du carrousel (spec 30 §7d),
// donc il lui faut un contexte i18n. Sans lui, l'erreur est « Failed to call useTranslations
// because the context from NextIntlClientProvider was not found » — un message qui parle de Server
// Components et envoie chercher le problème au mauvais endroit.
const messages = loadMessages("es");
const render = (ui: React.ReactNode) =>
  renderBrut(
    <NextIntlClientProvider locale="es" messages={{ Common: messages.Common }}>
      {ui}
    </NextIntlClientProvider>
  );

// Pas de @testing-library/jest-dom dans ce monorepo (cf. CatalogBrowser.test.tsx) — assertions DOM
// natives uniquement.
//
// Ce que ces tests protègent : la règle du §8 de docs/specs/04-gestion-images.md, « le premier
// slide en priorité, tous les autres en lazy ». Elle n'est visible NULLE PART à l'œil (le rendu est
// identique dans les deux cas) et se casserait donc en silence — c'est exactement le genre de règle
// qui n'existe que si un test la tient.

// ⚠️ Sources MATRICIELLES : sur un SVG, next/image jette `sizes` et `srcset`, et la moitié des
// assertions ci-dessous mesurerait le vide (cf. Image.test.tsx). Elles n'ont pas besoin d'exister
// sur le disque — rien n'est chargé en jsdom.
//
// ⚠️ Une URL DISTINCTE par test : `ReactDOM.preload` écrit dans le `<head>` du document, dédoublonne
// par URL, et rien ne nettoie le `<head>` entre deux tests. Réutiliser une URL ferait passer au vert
// un « aucun preload » sur le preload d'un test précédent.
function photos(prefixe: string, nombre: number): PhotoStripPhoto[] {
  return Array.from({ length: nombre }, (_, i) => ({
    id: `${prefixe}-${i}`,
    alt: `Photo ${i + 1} de la cabaña`,
    url: `/${prefixe}-${i}.jpg`,
  }));
}

const SIZES = "(max-width: 640px) 100vw, 640px";

// ⚠️ Trois API de navigateur qu'Embla appelle au MONTAGE et que jsdom n'implémente pas : sans ces
// bouchons, tout rendu du Carousel lève depuis un effet passif (« undefined is not a function » sur
// `matchMedia`, puis « IntersectionObserver is not defined »). Bouchonnés ICI et pas dans une
// configuration partagée : `vitest.config.ts` et `.storybook/**` sont communs à tous les agents.
//
// Aucun des trois ne ment sur le comportement mesuré ensuite : le composant ne déclare aucun point
// de rupture Embla (`matches: false` est la vérité), et ni l'observateur d'intersection ni celui de
// redimensionnement ne décident du chargement des images — c'est `next/image` qui s'en charge, à
// partir des attributs que ces tests vérifient. Ils ne servent qu'à laisser Embla se monter.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

class ObservateurInerte {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

window.IntersectionObserver ??= ObservateurInerte as unknown as typeof window.IntersectionObserver;
window.ResizeObserver ??= ObservateurInerte as unknown as typeof window.ResizeObserver;

function rendre(
  liste: PhotoStripPhoto[],
  { testId, loading = "priority" }: { testId?: string; loading?: "lazy" | "priority" } = {}
) {
  return render(<PhotoStrip photos={liste} sizes={SIZES} loading={loading} testId={testId} />)
    .container;
}

/** Un `<link rel=preload as=image>` pointant cette source a-t-il été injecté dans le `<head>` ? */
function preloadDe(url: string): boolean {
  return Array.from(document.head.querySelectorAll('link[rel="preload"][as="image"]')).some((lien) => {
    const cible = `${lien.getAttribute("imagesrcset") ?? ""} ${lien.getAttribute("href") ?? ""}`;
    return cible.includes(encodeURIComponent(url)) || cible.includes(url);
  });
}

describe("PhotoStrip", () => {
  it("rend une image par photo, avec son alt et le sizes reçu", () => {
    const liste = photos("alt", 3);
    const images = rendre(liste).querySelectorAll("img");

    expect(images.length).toBe(3);
    expect(Array.from(images).map((img) => img.getAttribute("alt"))).toEqual([
      "Photo 1 de la cabaña",
      "Photo 2 de la cabaña",
      "Photo 3 de la cabaña",
    ]);
    // `sizes` traverse la molécule jusqu'à chaque balise : c'est ce qui empêche de servir l'image
    // la plus grande à un téléphone, sur TOUS les slides et pas seulement le premier.
    for (const img of images) expect(img.getAttribute("sizes")).toBe(SIZES);
  });

  it("⚠️ ne charge en priorité QUE le premier slide — tous les suivants restent lazy", () => {
    const liste = photos("priorite", 4);
    const images = rendre(liste).querySelectorAll("img");

    // Premier slide : pas d'attribut `loading` du tout. Mesuré sur Next 16.3.0 — `priority` ne pose
    // rien sur la balise, il RETIRE `loading="lazy"` (cf. Image.test.tsx).
    expect(images[0].hasAttribute("loading")).toBe(false);
    expect(preloadDe(liste[0].url)).toBe(true);

    // Tous les autres : lazy, et surtout AUCUN preload. Sans cette moitié-là, une galerie de six
    // photos ferait précharger six images dont cinq hors écran — l'inverse exact du but.
    for (const photo of liste.slice(1)) expect(preloadDe(photo.url)).toBe(false);
    expect(Array.from(images).slice(1).map((img) => img.getAttribute("loading"))).toEqual([
      "lazy",
      "lazy",
      "lazy",
    ]);
  });

  it("⚠️ la priorité suit l'ORDRE, pas la position à l'écran : Embla monte tous les slides", () => {
    // Le test précédent pourrait passer avec un composant qui ne rendrait qu'un slide à la fois.
    // Celui-ci fixe le vrai comportement : les cinq slides sont DANS le DOM dès le premier rendu
    // (c'est ce que fait Embla), et c'est justement pour ça que la distinction lazy/priority est
    // nécessaire — sans elle, les cinq seraient traitées pareil.
    const liste = photos("ordre", 5);
    const container = rendre(liste);

    expect(container.querySelectorAll('[data-testid="carousel-slide"]').length).toBe(5);
    expect(container.querySelectorAll("img").length).toBe(5);
    expect(container.querySelectorAll('img[loading="lazy"]').length).toBe(4);
    // Aucune image ne doit porter `loading="eager"` : ce n'est pas la forme employée par le dépôt,
    // et posée avec `priority` elle ferait lever next/image.
    expect(container.querySelectorAll('img[loading="eager"]').length).toBe(0);
  });

  it("une seule photo : elle est prioritaire, et le carrousel n'affiche ni flèches ni points RÉELS", () => {
    // Comportement legacy conservé, porté par le Carousel lui-même (spec §8) — vérifié ici parce
    // que c'est le contrat rendu de PhotoStrip, pas pour le retester à sa place. Les points
    // restent absents FONCTIONNELLEMENT (aucun bouton, rien à cliquer) — seule leur hauteur est
    // désormais réservée en invisible, pour qu'une carte à une seule photo ait la même taille
    // qu'une carte qui en a plusieurs (cf. carousel.tsx).
    const liste = photos("seule", 1);
    const container = rendre(liste);

    expect(container.querySelectorAll("img").length).toBe(1);
    expect(container.querySelector("img")?.hasAttribute("loading")).toBe(false);
    expect(preloadDe(liste[0].url)).toBe(true);

    expect(container.querySelector('[data-testid="carousel-prev"]')).toBeNull();
    expect(container.querySelector('[data-testid="carousel-next"]')).toBeNull();
    expect(container.querySelector('[data-testid="carousel-dot"]')).toBeNull();
    expect(container.querySelector('[data-testid="carousel-dots"]')).toBeNull();
  });

  // ⚠️ PLAN 41, S9 : il n'y a plus de rangée de points SOUS la photo (les commandes sont posées
  // dessus), donc plus de hauteur à réserver quand il n'y a pas de photo. Le substitut prend
  // l'arrondi de la galerie.
  it("aucune photo : le substitut à l'arrondi de la galerie, sans rangée réservée dessous", () => {
    const container = rendre([], { testId: "vide" });

    expect(container.querySelector('[aria-hidden="true"].invisible')).toBeNull();
    const substitut = container.querySelector('[data-testid="vide-photo-0"]') as HTMLElement;
    expect(substitut.parentElement?.className).toContain("rounded-[24px]");
  });

  // ── Les commandes SUR la photo (plan 41, S9) ─────────────────────────────────────────────────
  // Le constat T15 : des boutons `outline` de 32 px à glyphe « ‹ » qui disparaissaient sur une
  // photo sombre, et des points de 8 px impossibles à viser. La lisibilité elle-même se juge au
  // rendu (photo claire, photo sombre) ; ces tests tiennent la structure.
  it("pose des flèches rondes de 44 px, nommées, à chevron SVG", () => {
    const container = rendre(photos("fleches", 3));
    for (const testId of ["carousel-prev", "carousel-next"]) {
      const bouton = container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement;
      expect(bouton.tagName).toBe("BUTTON");
      expect(bouton.getAttribute("type")).toBe("button");
      expect(bouton.className.split(/\s+/)).toEqual(expect.arrayContaining(["size-11", "rounded-full"]));
      expect(bouton.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      // Plus de glyphe typographique : le nom accessible vient du libellé traduit.
      expect(bouton.textContent).toBe("");
    }
    expect(container.querySelector('[data-testid="carousel-prev"]')?.getAttribute("aria-label")).toBe(
      "Foto anterior"
    );
  });

  it("remplace les points par un compteur « 1 / n », décoratif", () => {
    const container = rendre(photos("compteur", 4));
    expect(container.querySelector('[data-testid="carousel-dots"]')).toBeNull();
    const compteur = container.querySelector('[data-testid="carousel-counter"]') as HTMLElement;
    expect(compteur.textContent).toBe("1 / 4");
    // Le texte alternatif de chaque photo dit déjà « foto i de n » : le compteur ne le répète pas.
    expect(compteur.getAttribute("aria-hidden")).toBe("true");
  });

  it("arrondit la photo à 24 px : la racine porte l'arrondi, le cadre qui rogne l'hérite", () => {
    const container = rendre(photos("arrondi", 2));
    const racine = container.querySelector('[data-testid="carousel"]') as HTMLElement;
    expect(racine.className).toContain("rounded-[24px]");
    expect((racine.firstElementChild as HTMLElement).className).toContain("rounded-[inherit]");
  });

  it('⚠️ loading="lazy" sur la BANDE : plus aucun slide prioritaire, pas même le premier', () => {
    // Le cas de la grille de cartes. Sans cette prop, chaque carte préchargeait sa première photo :
    // mesuré à 3 preloads pour 3 cartes dans la story `DansUneCarte`, donc 20 sur un catalogue de
    // 20 produits, dont 18 sous la ligne de flottaison. « Le premier slide est prioritaire » n'est
    // vrai que si la bande elle-même l'est.
    const liste = photos("bande-lazy", 3);
    const images = rendre(liste, { loading: "lazy" }).querySelectorAll("img");

    expect(Array.from(images).map((img) => img.getAttribute("loading"))).toEqual([
      "lazy",
      "lazy",
      "lazy",
    ]);
    for (const photo of liste) expect(preloadDe(photo.url)).toBe(false);
  });

  it("galerie vide : le substitut de l'atome, aucune balise <img>, aucun carrousel", () => {
    // ⚠️ Différence de comportement assumée avec ProductPhotos, qui ne rendait RIEN (cf. l'en-tête
    // du composant) : le bloc garde sa place et son ratio plutôt que de disparaître.
    const container = rendre([], { testId: "photos" });

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-testid="carousel"]')).toBeNull();

    const substitut = container.querySelector('[data-testid="photos-photo-0-placeholder"]');
    expect(substitut).not.toBeNull();
    expect(substitut?.getAttribute("aria-hidden")).toBe("true");
  });

  it("expose testId sur la racine et le préfixe sur chaque photo, et rien quand il est absent", () => {
    const avec = rendre(photos("testid", 2), { testId: "photos" });
    expect(avec.firstElementChild?.getAttribute("data-testid")).toBe("photos");
    expect(avec.querySelector('[data-testid="photos-photo-0"]')).not.toBeNull();
    expect(avec.querySelector('[data-testid="photos-photo-1"]')).not.toBeNull();

    const sans = rendre(photos("sans-testid", 2));
    expect(sans.firstElementChild?.hasAttribute("data-testid")).toBe(false);
    // Aucun `data-testid` inventé sur les photos non plus : `undefined` ne doit pas devenir "".
    expect(sans.querySelectorAll("[data-testid^='undefined']").length).toBe(0);
  });
});
