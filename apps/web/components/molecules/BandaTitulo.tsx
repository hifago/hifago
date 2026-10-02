"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// LE BANDEAU DÉFILANT QUI PORTE LE TITRE D'UNE SECTION (2026-10-01, référence fournie par Jérôme :
// la bande « PROJETS À LA UNE » d'ateliercestparla.com).
//
// Le titre de section n'est plus un `<h2>` posé au-dessus des cartes : c'est une bande pleine
// largeur, en très gros, qui défile horizontalement AU SCROLL DE LA PAGE — vers la gauche quand on
// descend, vers la droite quand on remonte. Ce n'est donc pas une animation en boucle : rien ne
// bouge tant que la page ne bouge pas, et le mouvement est exactement réversible.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ UNE SEULE COPIE EST RENDUE PAR LE SERVEUR, LES AUTRES NAISSENT APRÈS HYDRATATION
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// C'est la décision structurante du fichier, et elle est dictée par le référencement. Une bande
// défilante a besoin d'assez de copies du texte pour qu'aucun vide n'apparaisse jamais à droite —
// ici huit. Les écrire dans le HTML servi mettrait « Actividades ↓ Actividades ↓ … » huit fois
// dans la page la plus stratégique du site : du bourrage de mot-clé, que ni `aria-hidden` ni une
// classe décorative n'effacent (ils cachent au lecteur d'écran, pas au robot).
//
// Le rendu serveur ne contient donc QUE le vrai titre, une fois — exactement ce qu'il y avait
// avant ce lot. Les sept doublures sont ajoutées par le navigateur, après hydratation, en
// `aria-hidden`. Conséquence assumée et voulue : sans JavaScript, la bande affiche un grand titre
// immobile plutôt qu'une bande à moitié vide.
//
// ⚠️ Le NIVEAU du titre vient de la page, jamais deviné ici — même règle que l'atome `Title`
// (`apps/web/components/README.md`) : c'est ce qui garantit un seul `<h1>` et une hiérarchie sans
// saut. Seule la PREMIÈRE copie est ce titre ; les doublures sont des `<span>`, jamais des
// `<h2>` — huit `<h2>` identiques casseraient le plan du document.
export type BandaTituloProps = {
  /** Déjà traduit — ce composant ne traduit rien. */
  titulo: string;
  tituloAs?: "h2" | "h3";
  /**
   * Retrait du DÉBUT du titre depuis le bord gauche de l'écran, en classes de marge écrites en
   * toutes lettres (`ml-7 sm:ml-9`) — c'est le parent qui sait sur quoi aligner le titre.
   */
  sangria?: string;
  testId?: string;
};

// ⚠️ UN PLANCHER, PAS UN COMPTE — et c'est une correction, pas une subtilité. Il faut assez de
// copies pour couvrir la fenêtre PLUS un segment entier (le modulo ci-dessous ramène le décalage
// dans [0, segment[, donc le vide potentiel vaut au plus un segment). Or ce nombre dépend de DEUX
// inconnues au moment d'écrire ce fichier : la largeur de l'écran et la longueur du titre.
//
// Mesuré au rendu réel le 2026-10-01, à cette taille de police : « Camps » occupe 279 px par copie,
// « Alojamientos » 476. À 2 560 px de large, huit copies suffisent largement au second (3 809 px
// pour 3 036 requis) et laissent un VIDE À DROITE au premier (2 235 px pour 2 839 requis). Aucune
// constante ne peut être juste pour les deux — la première version de ce fichier en posait une,
// estimée à vue de nez, et elle était fausse.
//
// Huit reste le point de départ : il couvre un écran de 1 920 px dans le pire cas du catalogue, ce
// qui évite un second rendu sur la quasi-totalité des visites. Au-delà, le compte est MESURÉ.
const COPIAS_MINIMAS = 8;

// Le rapport entre les pixels scrollés et les pixels parcourus par la bande. 0.35 : assez pour que
// le lien entre les deux gestes soit évident dès le premier coup de molette, assez peu pour que le
// texte reste lisible pendant un défilement rapide.
const VITESSE = 0.35;

// La flèche qui sépare deux copies — SVG fait main, jamais une dépendance d'icônes : `apps/web`
// n'en a AUCUNE (même gabarit `viewBox="0 0 24 24"` que `IconLink`/`IconButton`). `currentColor`
// la fait suivre le marine posé sur la bande, sans second jeton.
function FlechaAbajo() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[0.7em] w-[0.7em] shrink-0"
      aria-hidden="true"
    >
      <path d="M12 4v16M5 13l7 7 7-7" />
    </svg>
  );
}

// `font-[family-name:var(--font-titre)]` : la police de TITRE de la charte (Anton, confirmée le
// 2026-10-02 à la place de Sugo Display — cf. `.claude/rules/ui.md`), celle dans laquelle le PDF
// compose ce genre de bande.
// Les tailles montent jusqu'à `text-6xl` : « beaucoup plus gros » (Jérôme), puis réduites d'un cran
// à sa demande le 2026-10-01 (étaient `text-5xl sm:text-6xl lg:text-7xl`).
// `normal-case` (Jérôme, 2026-10-01, avec Sugo Pro Display) : le titre s'affiche dans la casse de
// ses messages — majuscule initiale seulement, « Actividades » — après `uppercase` puis
// `lowercase`. Aucune transformation : c'est le texte servi, tel que l'écrivent les messages.
// `tracking-[var(--tracking-titre)]` : l'interlettrage de la police de titre, défini UNE fois dans
// `globals.css` (règle d'usage du 2026-10-01 ; 0.04em en Anton depuis le 2026-10-02) — jamais une valeur ici. Les doublures sont des
// `<span>` et non des `<h2>` : sans cette classe, elles n'hériteraient pas de la règle des titres.
// Écrite en toutes lettres, jamais construite : Tailwind v4 scanne ce fichier comme du texte.
const CLASES_COPIA =
  "flex shrink-0 items-center gap-4 pr-4 text-4xl leading-none tracking-[var(--tracking-titre)] normal-case sm:gap-6 sm:pr-6 sm:text-5xl lg:text-6xl font-[family-name:var(--font-titre)]";

const CONSULTA_MOVIMIENTO = "(prefers-reduced-motion: reduce)";

/**
 * `true` seulement dans un navigateur dont le propriétaire n'a pas demandé moins de mouvement.
 *
 * ⚠️ `useSyncExternalStore` et non un `useState` posé depuis un effet, pour deux raisons qui vont
 * dans le même sens :
 *   · c'est le mécanisme que React prévoit pour rendre AUTREMENT côté serveur et côté client — le
 *     troisième argument est l'instantané servi, et il décide à lui seul que le HTML ne contient
 *     qu'une copie du titre (voir l'en-tête : c'est une décision de référencement, pas de style) ;
 *   · un `setState` dans le corps d'un effet déclenche une cascade de rendus, et la règle
 *     `react-hooks/set-state-in-effect` le refuse — à raison.
 * Bénéfice de bord : le réglage système peut changer EN COURS DE ROUTE, et la bande s'arrête ou
 * repart sans rechargement, là où une lecture unique au montage l'aurait figée.
 */
function useMovimientoPermitido() {
  return useSyncExternalStore(
    (alCambiar) => {
      const consulta = window.matchMedia(CONSULTA_MOVIMIENTO);
      consulta.addEventListener("change", alCambiar);
      return () => consulta.removeEventListener("change", alCambiar);
    },
    () => !window.matchMedia(CONSULTA_MOVIMIENTO).matches,
    () => false
  );
}

export function BandaTitulo({ titulo, tituloAs, sangria, testId }: BandaTituloProps) {
  const Etiqueta = tituloAs ?? "h2";
  const piste = useRef<HTMLDivElement>(null);
  const movimientoPermitido = useMovimientoPermitido();
  // Le compte réellement nécessaire, relevé par `aplicar` au fil des mesures (voir `COPIAS_MINIMAS`).
  // Il ne fait que croître, et il converge en un rendu : toutes les copies étant identiques, en
  // ajouter ne change pas la largeur d'un segment, donc pas le calcul qui vient de l'augmenter.
  const [copiasMedidas, setCopiasMedidas] = useState(COPIAS_MINIMAS);

  // 1 au rendu serveur comme en mouvement réduit. Les doublures n'existent que pour combler la
  // piste pendant qu'elle défile : sans défilement, elles n'auraient aucune raison d'être là — ni
  // à l'écran, ni dans le HTML servi (cf. l'en-tête, c'est une décision de référencement).
  const copias = movimientoPermitido ? copiasMedidas : 1;

  useEffect(() => {
    // ⚠️ Mouvement réduit : la bande reste alors ce qu'elle est sans JavaScript — un grand titre
    // immobile. Rien à brancher, rien à mesurer.
    if (!movimientoPermitido) return;

    const el = piste.current;
    if (!el) return;

    let bruto = 0;
    let imagen = 0;

    const aplicar = () => {
      imagen = 0;
      // Le segment est la largeur d'UNE copie : la piste n'en contient que des identiques, donc
      // décaler d'exactement un segment redonne une image indiscernable de la précédente. C'est
      // ce qui rend la boucle invisible sans jamais rien déplacer dans le DOM.
      //
      // ⚠️ `el.children.length` et NON la constante : le compte peut avoir grandi depuis le montage
      // (ci-dessous), et un effet qui ne se rejoue pas garderait l'ancienne valeur dans sa fermeture
      // — le segment serait alors faux, et la boucle sauterait. Le DOM, lui, est toujours à jour.
      const copiasActuales = el.children.length;
      const segmento = el.scrollWidth / copiasActuales;
      if (segmento <= 0) return;

      // ⚠️ Le compte nécessaire se MESURE, il ne se devine pas (cf. `COPIAS_MINIMAS`). Posé ici
      // plutôt que dans le corps de l'effet : c'est un retour d'un système extérieur — la mise en
      // page du navigateur — donc exactement le cas où React admet un `setState` depuis un rappel.
      // `innerWidth` et non `clientWidth` de la piste : elle est plus large que la fenêtre par
      // construction, c'est la FENÊTRE qu'il faut couvrir.
      //
      // `+ 2` et non `+ 1` : la piste est décalée d'un segment de plus vers la gauche (ci-dessous).
      const necesarias = Math.ceil(window.innerWidth / segmento) + 2;
      if (necesarias > copiasActuales) setCopiasMedidas(necesarias);
      // Modulo POSITIF : `%` garde le signe de son opérande gauche en JavaScript, et `scrollY`
      // peut devenir négatif pendant un rebond élastique (iOS, trackpad macOS). Sans cette remise
      // en forme, la bande sauterait d'un segment entier à chaque rebond.
      const desfase = ((bruto % segmento) + segmento) % segmento;
      // ⚠️ `- segmento` : la piste commence au RETRAIT (`sangria`, une marge), donc reculer d'à peine
      // `desfase` laisserait un trou à gauche tant que `desfase` est plus petit que le retrait. Un
      // segment de plus vers la gauche le comble — et au repos (`desfase` = 0) c'est la DEUXIÈME
      // copie qui tombe pile sur le retrait, indiscernable de la première rendue par le serveur.
      el.style.transform = `translate3d(${-(desfase + segmento)}px, 0, 0)`;
    };

    const alDesplazar = () => {
      bruto = window.scrollY * VITESSE;
      // ⚠️ On n'écrit JAMAIS dans un état React ici : un `setState` par événement de scroll rend
      // la page entière des dizaines de fois par seconde. La position vit dans le style de
      // l'élément, posée une fois par image d'animation — le composant, lui, ne se rend plus.
      if (imagen) return;
      imagen = requestAnimationFrame(aplicar);
    };

    alDesplazar();
    window.addEventListener("scroll", alDesplazar, { passive: true });
    // Une police qui finit de charger, ou un redimensionnement, change `scrollWidth` : sans cet
    // observateur le segment resterait calculé sur la largeur d'avant, et la boucle sauterait.
    const observador = new ResizeObserver(aplicar);
    observador.observe(el);

    return () => {
      window.removeEventListener("scroll", alDesplazar);
      observador.disconnect();
      cancelAnimationFrame(imagen);
    };
  }, [movimientoPermitido]);

  const contenido = (
    <span className={CLASES_COPIA}>
      {titulo}
      <FlechaAbajo />
    </span>
  );

  return (
    // `overflow-hidden` rogne les copies qui dépassent — c'est la fenêtre de la bande. Pas de
    // `tabIndex`/`role="region"` : rien ici ne défile à la souris ni au clavier, c'est un
    // `transform` piloté par le scroll de la PAGE. La règle de `.claude/rules/ui.md` vise
    // `overflow-x-auto`, un conteneur réellement défilant ; ce n'en est pas un.
    <div className="col-span-full overflow-hidden py-4" data-testid={testId}>
      <div ref={piste} className={`flex w-max items-center will-change-transform ${sangria ?? ""}`}>
        {/* `className="contents"` : la balise de titre ne doit rien peindre ni rien mesurer — elle
            n'est là que pour le PLAN du document. Sans ça, son `display: block` par défaut
            casserait la rangée `flex` de la piste. */}
        <Etiqueta className="contents" data-testid={testId ? `${testId}-titulo` : undefined}>
          {contenido}
        </Etiqueta>
        {/* Les doublures : décoratives de bout en bout. `aria-hidden` les retire de l'arbre
            d'accessibilité, et elles n'existent pas dans le HTML servi (cf. l'en-tête). */}
        {Array.from({ length: copias - 1 }, (_, indice) => (
          <span key={indice} aria-hidden="true" className="contents">
            {contenido}
          </span>
        ))}
      </div>
    </div>
  );
}
