import { afterEach, describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { BandaTitulo } from "./BandaTitulo";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// jsdom ne fait AUCUNE mise en page : `scrollWidth` vaut 0 quel que soit le contenu, et le
// composant s'arrête alors avant de poser la moindre transformation (sa garde `segmento <= 0`,
// qui existe pour ne pas diviser par zéro au premier rendu). La largeur de la piste est donc
// redéfinie à la main — exactement le geste de `CarruselConSombra.test.tsx`, pour la même raison.
//
// `matchMedia` et `ResizeObserver` n'existent pas non plus dans jsdom : les deux stubs suivent les
// idiomes déjà employés par `BuscadorInicio.estado.test.tsx` et `CarruselConSombra.test.tsx`.
//
// ⚠️ `requestAnimationFrame` est mis EN FILE, jamais exécuté sur-le-champ. Une doublure qui
// appellerait son rappel immédiatement casserait la garde anti-rafale du composant : il remet son
// handle à zéro DANS le rappel, donc un rappel synchrone s'exécute avant que `imagen` ne reçoive
// le handle, et la garde reste armée pour toujours — plus aucun scroll n'est traité. Mesuré :
// c'est la première version de ce fichier qui est tombée dessus, et le symptôme était un
// `transform` vide, indiscernable d'un composant qui ne ferait rien.

let mouvementReduit = false;

window.matchMedia = ((query: string) => ({
  matches: mouvementReduit,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

class ObservateurInerte {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
window.ResizeObserver ??= ObservateurInerte as unknown as typeof window.ResizeObserver;

let imagenesEnEspera: FrameRequestCallback[] = [];
window.requestAnimationFrame = ((rappel: FrameRequestCallback) =>
  imagenesEnEspera.push(rappel)) as typeof window.requestAnimationFrame;
window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;

/** La piste : l'enfant du conteneur, celui qui porte le `transform`. */
function piste(container: HTMLElement) {
  return container.querySelector('[data-testid="banda"] > div') as HTMLElement;
}

/**
 * jsdom ne mesure rien : la largeur de la piste est posée à la main.
 *
 * ⚠️ Un GETTER dérivé du nombre de copies, et non une valeur figée : le composant ajoute des copies
 * quand il en manque, et une largeur totale constante ferait rétrécir le segment à chaque ajout —
 * donc en redemander, indéfiniment. Un vrai navigateur n'a pas ce problème (la piste s'allonge avec
 * son contenu) ; la doublure doit se comporter pareil, sinon le test prouve une boucle qui n'existe
 * que dans le test.
 */
function definirSegmento(el: HTMLElement, largeurCopie: number) {
  Object.defineProperty(el, "scrollWidth", {
    configurable: true,
    get: () => el.children.length * largeurCopie,
  });
}

function desplazar(a: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value: a });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
    for (const rappel of imagenesEnEspera.splice(0)) rappel(0);
  });
}

/**
 * Les px du `translate3d`, en nombre. Comparer la CHAÎNE serait otage de l'arithmétique flottante
 * (`20000 * 0.35` ne vaut pas exactement 7000 en binaire) — on compare donc des nombres, avec la
 * tolérance qui va avec.
 */
function decalage(el: HTMLElement) {
  const trouve = /translate3d\((-?[\d.e-]+)px/.exec(el.style.transform);
  return trouve ? Number(trouve[1]) : null;
}

afterEach(() => {
  mouvementReduit = false;
  imagenesEnEspera = [];
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
});

describe("BandaTitulo", () => {
  // ⚠️ LE TEST QUI COMPTE, ET IL N'EST PAS VISUEL. La bande a besoin de huit copies du titre pour
  // qu'aucun vide n'apparaisse jamais à droite. Les servir dans le HTML mettrait huit fois
  // « Actividades » dans la page la plus stratégique du site : du bourrage de mot-clé, que ni
  // `aria-hidden` ni une classe décorative n'effacent (ils cachent au lecteur d'écran, pas au
  // robot). Le rendu SERVEUR ne doit donc en contenir qu'une — et aucun rendu client ne le
  // prouverait, d'où `renderToStaticMarkup`, qui est littéralement ce que Google reçoit.
  it("ne sert qu'UNE copie du titre dans le HTML rendu par le serveur", () => {
    const html = renderToStaticMarkup(<BandaTitulo titulo="Actividades" tituloAs="h2" />);
    expect(html.split("Actividades").length - 1).toBe(1);
    expect(html.split("<h2").length - 1).toBe(1);
  });

  it("porte le niveau de titre demandé par la page, jamais un niveau deviné", () => {
    const { container } = render(<BandaTitulo titulo="Camps" tituloAs="h3" testId="banda" />);
    const titre = container.querySelector('[data-testid="banda-titulo"]') as HTMLElement;
    expect(titre.tagName).toBe("H3");
    expect(titre.textContent).toContain("Camps");
  });

  // Les sept doublures naissent APRÈS hydratation. Une seule reste un vrai titre : huit `<h2>`
  // identiques casseraient le plan du document autant que le bourrage qu'on vient d'éviter.
  it("ajoute ses doublures au navigateur, en aria-hidden, et garde un seul titre", () => {
    const { container } = render(<BandaTitulo titulo="Actividades" tituloAs="h2" testId="banda" />);
    const copies = piste(container).children;
    expect(copies.length).toBe(8);
    expect(container.querySelectorAll("h2").length).toBe(1);
    expect(copies[0].hasAttribute("aria-hidden")).toBe(false);
    for (const doublure of [...copies].slice(1)) {
      expect(doublure.getAttribute("aria-hidden")).toBe("true");
    }
  });

  // ⚠️ LE COMPORTEMENT DEMANDÉ PAR JÉRÔME : « un bandeau déroulant au scroll haut ET bas ». Ce
  // n'est pas une animation en boucle — rien ne bouge tant que la page ne bouge pas, et le
  // mouvement est exactement réversible. Un défilement automatique passerait un test qui se
  // contenterait de « ça bouge » ; celui-ci vérifie que ça REVIENT.
  it("avance quand la page descend, et revient quand elle remonte", () => {
    const { container } = render(<BandaTitulo titulo="Actividades" tituloAs="h2" testId="banda" />);
    const p = piste(container);
    definirSegmento(p, 1000); // 8 copies de 1 000 px = une piste de 8 000 px

    // Chaque valeur porte le segment de recul permanent (− 1 000) qui comble le retrait `sangria`.
    desplazar(0);
    expect(decalage(p)).toBeCloseTo(-1000, 6);

    desplazar(600); // 600 × 0.35 = 210
    expect(decalage(p)).toBeCloseTo(-1210, 6);

    desplazar(200); // on remonte : la bande revient là où elle était à l'aller
    expect(decalage(p)).toBeCloseTo(-1070, 6);
  });

  // Le modulo ramène le décalage dans [0, segment[ : c'est ce qui rend la boucle invisible sans
  // jamais rien déplacer dans le DOM. Avec un segment de 1 000 px, 7 000 px parcourus doivent
  // redonner 0 — sans quoi la piste finirait par sortir de l'écran et laisser un vide derrière elle.
  it("boucle sur la largeur d'une copie plutôt que de dériver à l'infini", () => {
    const { container } = render(<BandaTitulo titulo="Actividades" tituloAs="h2" testId="banda" />);
    const p = piste(container);
    definirSegmento(p, 1000);

    desplazar(20000); // × 0.35 = 7 000, soit sept segments pleins
    expect(decalage(p)).toBeCloseTo(-1000, 6); // le seul segment de recul permanent
  });

  // Un `scrollY` négatif arrive pour de vrai : rebond élastique d'iOS ou d'un trackpad macOS. Sans
  // la remise en forme du modulo, `%` garderait le signe de son opérande gauche et la bande
  // sauterait d'un segment entier à chaque rebond.
  it("ne saute pas quand le navigateur rend un scroll négatif (rebond élastique)", () => {
    const { container } = render(<BandaTitulo titulo="Actividades" tituloAs="h2" testId="banda" />);
    const p = piste(container);
    definirSegmento(p, 1000);

    desplazar(-100); // −35 px bruts → doit se lire 965 px dans le segment, jamais +35
    expect(decalage(p)).toBeCloseTo(-1965, 6); // + le segment de recul permanent
  });

  // Le titre s'aligne sur la première photo (Jérôme, 2026-10-01) : le retrait est une MARGE de la
  // piste, posée par le parent — et une marge n'entre pas dans `scrollWidth`, donc pas dans le
  // segment ni dans la boucle.
  it("pose le retrait demandé par le parent sur la piste", () => {
    const { container } = render(
      <BandaTitulo titulo="Actividades" tituloAs="h2" sangria="ml-7 sm:ml-9" testId="banda" />
    );
    expect(piste(container).className).toContain("ml-7 sm:ml-9");
  });

  // ⚠️ LE GARDE-FOU DE LA CORRECTION DU 2026-10-01, et il vient d'une MESURE, pas d'une relecture :
  // huit copies couvrent « Alojamientos » (476 px chacune) sur un écran de 2 560 px, mais pas
  // « Camps » (279 px) — 2 235 px de piste pour 2 839 requis, donc un vide visible à droite dès
  // qu'on scrolle. Le compte ne peut pas être une constante : il dépend de la largeur de l'écran ET
  // de la longueur du titre. Avec un segment étroit (100 px) et la fenêtre de 1 024 px de jsdom, il
  // en faut 13 (11 pour couvrir, + 2 de marge de boucle) — et le compte doit se STABILISER là,
  // sans repartir à chaque mesure.
  it("ajoute des copies quand le titre est trop court pour couvrir l'écran, puis s'arrête", () => {
    const { container } = render(<BandaTitulo titulo="Camps" tituloAs="h2" testId="banda" />);
    const p = piste(container);
    definirSegmento(p, 100);

    desplazar(0);
    expect(p.children.length).toBe(Math.ceil(window.innerWidth / 100) + 2);

    // La piste couvre bien la fenêtre PLUS deux segments : le modulo décale de moins d'un segment,
    // et la piste recule en permanence d'un segment de plus pour combler le retrait `sangria`.
    expect(p.scrollWidth).toBeGreaterThanOrEqual(window.innerWidth + 200);

    // Et elle ne grandit plus : les copies étant identiques, en ajouter ne rétrécit pas le segment.
    const estable = p.children.length;
    desplazar(400);
    desplazar(900);
    expect(p.children.length).toBe(estable);
  });

  // ⚠️ `prefers-reduced-motion` n'est pas une politesse : une bande qui défile est un déclencheur
  // vestibulaire reconnu (WCAG 2.3.3). En mouvement réduit, la bande redevient ce qu'elle est sans
  // JavaScript — un grand titre immobile — et les doublures, qui n'auraient plus aucune raison
  // d'exister, ne sont pas même ajoutées.
  it("reste immobile, et sans doublure, en mouvement réduit", () => {
    mouvementReduit = true;
    const { container } = render(<BandaTitulo titulo="Actividades" tituloAs="h2" testId="banda" />);
    const p = piste(container);
    definirSegmento(p, 1000);

    expect(p.children.length).toBe(1);
    desplazar(600);
    expect(decalage(p)).toBeNull();
  });
});
