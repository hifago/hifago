"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

// L'affordance « il reste des cartes à gauche/droite » du carrusel de `SeccionOfertas.tsx`
// (2026-09-15).
//
// POURQUOI CE COMPOSANT EXISTE À PART, ET PAS DANS `SeccionOfertas.tsx`. Savoir si le conteneur a
// encore de la place à droite exige de LIRE `scrollLeft`/`scrollWidth`/`clientWidth` — une donnée
// qui n'existe qu'au navigateur, jamais au rendu serveur. `SeccionOfertas.tsx` est un Server
// Component par décision structurante (voir son en-tête) : lui ajouter `"use client"` ferait
// descendre cinq sections × huit cartes dans le navigateur pour ce seul besoin. Ici, seul CE
// wrapper — pas la liste qu'il enveloppe, toujours rendue par la page — porte l'état.
//
// `children` reste le `<ul>` de `SeccionOfertas.tsx`, rendu CÔTÉ SERVEUR comme avant : un Server
// Component peut passer du JSX déjà résolu à un Client Component en `children` sans que ce JSX
// devienne lui-même client (même motif que `Toast.Provider`, `apps.md`) — ce composant ne fait
// qu'entourer ce `<ul>` d'un conteneur qui défile et d'un dégradé, il ne le recompose pas.
export type CarruselConSombraProps = {
  children: ReactNode;
  /**
   * Sur QUELLE couleur le dégradé de bord s'éteint. Un dégradé qui part d'une couleur que le
   * conteneur ne porte pas ne fond pas : il peint une bande franche d'une AUTRE couleur sur les
   * cartes — exactement ce qui arrivait quand ce carrusel a déménagé sur le conteneur bleu poudre
   * du 2026-10-01 en gardant `from-background`. Défaut `"pagina"` : le fond de page, l'usage
   * d'origine. `"contenedor"` = le bleu poudre de la charte (`--default`).
   */
  fondo?: "pagina" | "contenedor";
  testId?: string;
};

// `p-2` sur les QUATRE côtés : marge qui laisse peindre l'anneau de survol/focus d'une carte
// (`hover:ring-2`) sans qu'il soit rogné par `overflow-x-auto` — constaté au rendu deux fois : le
// haut de l'anneau d'abord (conteneur collé à la hauteur des cartes, `py-2` seul y avait suffi),
// puis les bords gauche/droit de la PREMIÈRE et de la DERNIÈRE carte (même rognage, sur l'axe qui
// défile cette fois — `px-2` répare l'un sans l'autre). Toutes les cartes du milieu ont déjà leurs
// voisines pour respirer (`gap-4`) ; seules les deux extrémités touchaient un bord sans marge.
//
// ⚠️ `scroll-px-2` DOIT accompagner `px-2`, sinon le dégradé de GAUCHE s'affiche par défaut au
// chargement, sans qu'aucun scroll n'ait eu lieu. Constaté au rendu : `scrollLeft` valait `8` (pas
// `0`) dès le montage. Cause — `scroll-snap-align: start` (posé sur chaque `<li>`) veut que le
// bord de la PREMIÈRE carte s'aligne avec le bord du viewport de scroll ; ce bord est à 8px à
// cause du `padding-left` qu'on vient d'ajouter, donc le navigateur corrige tout seul la position
// de repos à `scrollLeft: 8` pour satisfaire cet alignement — et notre seuil `scrollLeft > 1`
// prenait ce réajustement pour un vrai scroll utilisateur. `scroll-px-2` (scroll-padding, pas
// padding) redéfinit le point d'ancrage du snap à 8px du bord réel : `scrollLeft: 0` redevient une
// position de repos valide, padding visuel ET alignement de scroll cohabitent.
// ⚠️ Barre de défilement volontairement STYLÉE, pas laissée à la valeur par défaut du navigateur.
// Sans ça, la barre native (~15-17px sur Chrome/Windows, épaisse) colle directement sous les
// cartes malgré le `p-2` : elle prend sa place DANS la boîte du conteneur, pas en dessous d'elle —
// constaté au rendu, elle touchait visuellement le bas des cartes plutôt que de s'en détacher.
//
// Couleur reprise de `--scrollbar-thumb`/`--scrollbar-track` — PAS le jeton piste-gated de
// `packages/ui/src/styles/globals.css:444` (`[data-theme="vitrine"][data-piste]`, que la vraie
// vitrine ne pose jamais), mais leur définition de BASE, posée sans condition par `@heroui/styles`
// lui-même (`:root, .light, .default…`) : `color-mix(in oklch, var(--foreground) 15%, transparent)`
// et `transparent`. Vérifié dans le CSS compilé — ce sont ces jetons-là qui gagnent en production,
// jamais la variante piste. Les réutiliser (plutôt que recopier la même couleur à la main) fait
// suivre cette barre si la valeur de base change un jour.
//
// ⚠️ `[data-scrollbar="thin"]` (HeroUI, même fichier compilé) ne suffit PAS ici : il ne fait que
// POSER ces variables CSS sur l'élément qui le porte, sans jamais écrire `scrollbar-width`/
// `scrollbar-color` lui-même — seules les classes internes de HeroUI (`.dropdown__popover` etc.)
// les CONSOMMENT. La classe `.scrollbar` (même origine, `@heroui/styles`) fait l'inverse et c'est
// elle qu'il faut : `scrollbar-width: var(--scrollbar-width); scrollbar-color: var(--scrollbar-color);`
// posés directement, applicables à n'importe quel élément qui défile — celui-ci y compris. `thin`
// est déjà la valeur PAR DÉFAUT de `--scrollbar-width` (`:root`), donc `.scrollbar` seul suffit
// pour Firefox et Chrome/Edge récents (propriétés standard, supportées nativement depuis peu).
//
// `[&::-webkit-scrollbar*]` reste nécessaire À CÔTÉ de `.scrollbar` : Safari ne connaît que le
// pseudo-élément, jamais les propriétés standard — vérifié généré dans le CSS compilé (`grep
// webkit-scrollbar` sur le chunk servi). Aucun équivalent en classe utilitaire pour CE
// pseudo-élément précis (pas de plugin scrollbar dans ce dépôt), d'où les valeurs arbitraires.
const CLASES_CONTENEDOR =
  "flex snap-x snap-proximity gap-4 overflow-x-auto p-2 scroll-px-2 scrollbar [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--scrollbar-thumb)]";

// Chaînes littérales complètes, jamais construites par interpolation : Tailwind v4 scanne ce
// fichier comme du texte, et une classe fabriquée à la volée n'existerait pas dans le CSS compilé —
// le dégradé ne peindrait alors RIEN, en silence.
const DEGRADADO = {
  pagina: { izquierda: "from-background", derecha: "from-background" },
  contenedor: { izquierda: "from-[var(--default)]", derecha: "from-[var(--default)]" },
} as const;

/**
 * Reste-t-il du contenu à faire défiler à gauche / à droite de `ref` ? Exporté le 2026-10-02 pour
 * les voiles flous des rails (`FilaRiel.tsx`) : même mesure, un seul endroit.
 */
export function useBordesDesplazables(ref: RefObject<HTMLElement | null>) {
  // `false` par défaut : tant que l'effet n'a pas mesuré le DOM réel, on ne peint aucun dégradé
  // plutôt qu'un dégradé qui suppose à tort qu'il reste du contenu à faire défiler.
  const [puedeIzquierda, setPuedeIzquierda] = useState(false);
  const [puedeDerecha, setPuedeDerecha] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // `1px` de marge : `scrollWidth - clientWidth - scrollLeft` (ou `scrollLeft` seul, à gauche)
    // peut rester à 0,4px d'une vraie fin de scroll (zoom navigateur, sous-pixel) — sans cette
    // tolérance, un dégradé resterait visible à l'arrêt exact que l'utilisateur perçoit pourtant
    // comme « tout au bord ».
    const actualizar = () => {
      setPuedeIzquierda(el.scrollLeft > 1);
      setPuedeDerecha(el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
    };

    actualizar();
    el.addEventListener("scroll", actualizar, { passive: true });
    // Une carte qui charge sa photo, ou un redimensionnement de fenêtre, change `scrollWidth` sans
    // déclencher de `scroll` — sans cet observateur, une ligne qui devient scrollable APRÈS le
    // montage initial garderait les deux dégradés éteints à tort.
    const observateur = new ResizeObserver(actualizar);
    observateur.observe(el);

    return () => {
      el.removeEventListener("scroll", actualizar);
      observateur.disconnect();
    };
  }, [ref]);

  return { puedeIzquierda, puedeDerecha };
}

export function CarruselConSombra({ children, fondo = "pagina", testId }: CarruselConSombraProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { puedeIzquierda, puedeDerecha } = useBordesDesplazables(ref);

  return (
    <div className="relative">
      <div ref={ref} className={CLASES_CONTENEDOR} data-testid={testId}>
        {children}
      </div>
      {/* `pointer-events-none` : décoratifs, ne doivent jamais intercepter un clic/survol destiné à
          une carte sous-jacente. `aria-hidden` : n'apportent aucune information qu'un lecteur
          d'écran n'ait pas déjà (le défilement reste utilisable au clavier via les cartes
          elles-mêmes). */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r ${
          DEGRADADO[fondo].izquierda
        } to-transparent transition-opacity duration-200 ${
          puedeIzquierda ? "opacity-100" : "opacity-0"
        }`}
        data-testid={testId ? `${testId}-sombra-izquierda` : undefined}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l ${
          DEGRADADO[fondo].derecha
        } to-transparent transition-opacity duration-200 ${
          puedeDerecha ? "opacity-100" : "opacity-0"
        }`}
        data-testid={testId ? `${testId}-sombra-derecha` : undefined}
      />
    </div>
  );
}
