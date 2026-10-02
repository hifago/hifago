"use client";

import { useRef } from "react";
import type { ReactNode } from "react";
import { useBordesDesplazables } from "@/components/molecules/CarruselConSombra";

// La rangée qui défile dans le conteneur marine de `SeccionPortada`, et ses deux VOILES FLOUS
// (Jérôme, 2026-10-02 : « ajoute un flou aux extrémités du conteneur pour marquer qu'il y a
// d'autres cartes à découvrir »).
//
// POURQUOI UN COMPOSANT CLIENT À PART. Trois photos remplissent exactement le conteneur : aucune
// amorce de la quatrième n'est visible, rien ne dit que la rangée défile. Le voile n'a de sens que
// là où il RESTE des cartes — à droite au repos, à gauche après un défilement, nulle part avec trois
// cartes ou moins. Le savoir exige de lire `scrollLeft`/`scrollWidth` : une donnée de navigateur.
// `SeccionPortada` reste un Server Component (son dernier test le vérifie) ; seule cette rangée
// porte l'état, et ses `children` — les tuiles — sont rendus et servis par le serveur comme avant
// (même montage que `CarruselConSombra` dans `SeccionOfertas`).
//
// Pas le composant `CarruselConSombra` lui-même : son défilant porte la barre visible, un `p-2` et
// des gouttières en rem — tout ce que la maquette de l'accueil n'a pas. On partage la MESURE
// (`useBordesDesplazables`), pas l'habillage.

// La rangée telle qu'elle était dans `SeccionPortada` : défilement natif, barre masquée (la
// maquette n'en a pas). Pas de `tabIndex`/`role="region"` : elle ne contient que des liens
// (`.claude/rules/ui.md`).
const CLASES_FILA =
  "flex snap-x snap-mandatory gap-[1.9cqw] overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

// LE VOILE : `backdrop-blur-sm` floute la photo qui passe dessous, et le `mask-image` fait
// décroître ce flou du bord vers l'intérieur — sans lui, il s'arrêterait sur une arête nette au
// milieu de la photo. Une teinte marine translucide (`/50`), sous le même masque, le fond dans le
// conteneur sans masquer la photo.
//   · `md:w-[6cqw]` de large, un cinquième de tuile : assez pour se voir, pas assez pour cacher le
//     nom. Sous `md`, où UNE tuile remplit le conteneur (`CLASE_TESELA` de `SeccionPortada`), un
//     cinquième flouterait 58 px de la seule photo visible : `8cqw` (28 px à 390), le minimum pour
//     porter l'arrondi de la tuile sans qu'il soit écrasé (un arrondi plus large que l'élément est
//     réduit par le navigateur).
//   · `rounded-*` : l'arrondi des tuiles, que le voile recouvre au bord — 16 px fixes à toute largeur
//     depuis les tuiles carrées (2026-10-02 ; avant, 2,4cqw de section au-dessus de `md` et 6,9cqw
//     en dessous). Suit `Tesela` de `SeccionPortada` ; `SeccionPortada.test.tsx` tient l'accord.
//   · `z-[2]` : au-dessus du calque de texte des tuiles (`z-[1]`) et du `::after` de leur lien.
//   · `pointer-events-none` : un clic sur le bord flouté atteint toujours la tuile dessous.
// Chaînes littérales complètes : Tailwind v4 ne génère pas une classe fabriquée par interpolation.
const CLASES_VELO =
  "pointer-events-none absolute inset-y-0 z-[2] w-[8cqw] backdrop-blur-sm to-transparent transition-opacity duration-200 motion-reduce:transition-none md:w-[6cqw]";
const VELO_IZQUIERDA =
  "left-0 rounded-l-[16px] bg-gradient-to-r from-[var(--accent-foreground)]/50 [mask-image:linear-gradient(to_right,black_30%,transparent)]";
const VELO_DERECHA =
  "right-0 rounded-r-[16px] bg-gradient-to-l from-[var(--accent-foreground)]/50 [mask-image:linear-gradient(to_left,black_30%,transparent)]";

export function FilaPortada({ children, testId }: { children: ReactNode; testId?: string }) {
  const ref = useRef<HTMLUListElement>(null);
  const { puedeIzquierda, puedeDerecha } = useBordesDesplazables(ref);

  return (
    <div className="relative">
      <ul ref={ref} className={CLASES_FILA}>
        {children}
      </ul>
      {/* `aria-hidden` : décoratifs, ils n'apprennent rien qu'un lecteur d'écran ne sache déjà —
          les tuiles cachées restent des liens atteignables à la tabulation. */}
      <div
        aria-hidden="true"
        className={`${CLASES_VELO} ${VELO_IZQUIERDA} ${puedeIzquierda ? "opacity-100" : "opacity-0"}`}
        data-testid={testId ? `${testId}-velo-izquierda` : undefined}
      />
      <div
        aria-hidden="true"
        className={`${CLASES_VELO} ${VELO_DERECHA} ${puedeDerecha ? "opacity-100" : "opacity-0"}`}
        data-testid={testId ? `${testId}-velo-derecha` : undefined}
      />
    </div>
  );
}
