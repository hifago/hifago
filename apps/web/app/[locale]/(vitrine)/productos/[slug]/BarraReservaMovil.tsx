"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/atoms/Button";

// La barre « prix · Reservar » collée en bas de la fiche produit, sous `lg` (plan 41, P3 ; arbitrage
// D10 = A de Jérôme, 2026-10-02). Sur mobile, le panneau de réservation vient APRÈS la galerie et la
// description : sans elle, le prix et l'action disparaissent pendant la lecture. C'est la seule
// nouveauté de comportement de l'item, et elle ne porte AUCUNE logique métier : le bouton fait
// défiler jusqu'au panneau, qui reste le seul endroit où l'on réserve.
//
// Trois décisions :
//   - MASQUÉE QUAND LE PANNEAU EST À L'ÉCRAN (IntersectionObserver) : deux boutons « réserver » côte
//     à côte n'en font pas un meilleur. `invisible` et pas `hidden` : la place reste réservée, rien ne
//     saute ; et `visibility: hidden` la retire de l'arbre d'accessibilité et de la tabulation ;
//   - `lg:hidden` : au-dessus, le panneau colle à droite et reste visible. Ce n'est pas du contenu
//     masqué selon la largeur (`.claude/rules/ui.md`) : prix et action sont dans le panneau, à toutes
//     les largeurs ; la barre n'en est qu'un raccourci ;
//   - le focus suit le défilement (`tabIndex={-1}` sur la cible, posé par la fiche) : un lecteur
//     d'écran ou un clavier arrive bien au panneau, pas seulement les yeux.
//
// ⚠️ Elle porte aussi sa PLACE dans la grille de la fiche (`row-start-1 col-span-full self-end`,
// sous-grille des trois colonnes de `PageShell pagina`) : elle partage la zone de grille du contenu,
// sinon elle ne collerait à rien — un élément collant ne sort jamais de son bloc conteneur, et celui
// d'un élément de grille est sa propre cellule. Fond et filet sont sur CET élément, celui qu'on rend
// invisible : posés sur un parent, ils restaient à l'écran en bande blanche vide (vu au rendu).
export function BarraReservaMovil({
  objetivoId,
  precio,
  etiqueta,
  testId,
}: {
  /** L'`id` du panneau de réservation : cible du défilement et de l'observation. */
  objetivoId: string;
  /** Le prix déjà rendu, ou `null` (prix libre absent) : le bouton reste seul. */
  precio: ReactNode;
  /** Le libellé du bouton, déjà traduit. */
  etiqueta: string;
  testId?: string;
}) {
  const [panelVisible, setPanelVisible] = useState(false);

  useEffect(() => {
    const objetivo = document.getElementById(objetivoId);
    // jsdom et vieux navigateurs : la barre reste affichée, ce qui est le défaut sûr.
    if (!objetivo || typeof IntersectionObserver === "undefined") return;
    const observador = new IntersectionObserver(([entrada]) => setPanelVisible(entrada?.isIntersecting ?? false), {
      threshold: 0,
    });
    observador.observe(objetivo);
    return () => observador.disconnect();
  }, [objetivoId]);

  function irAlPanel() {
    const objetivo = document.getElementById(objetivoId);
    if (!objetivo) return;
    const reducido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    objetivo.scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "start" });
    objetivo.focus({ preventScroll: true });
  }

  return (
    <div
      data-testid={testId}
      className={[
        "sticky bottom-0 z-20 col-span-full row-start-1 grid grid-cols-subgrid self-end border-t border-border bg-surface lg:hidden",
        panelVisible ? "invisible" : "",
      ].join(" ")}
    >
      <div className="col-start-2 flex min-w-0 items-center justify-between gap-4 py-3">
        <div className="min-w-0">{precio}</div>
        <Button size="lg" onPress={irAlPanel} testId={testId ? `${testId}-boton` : undefined}>
          {etiqueta}
        </Button>
      </div>
    </div>
  );
}
