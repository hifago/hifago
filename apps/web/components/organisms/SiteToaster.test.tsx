import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { toast } from "@hifago/ui";
import { SiteToaster } from "./SiteToaster";

// ⚠️ LA GARANTIE DU §11.9, ET ELLE N'EST PAS UN `it()`. Le piège : envelopper `{children}` dans
// `Toast.Provider` fait rendre `null` à toute l'app — page blanche, sans erreur console ni échec de
// build. `SiteToasterProps` ne déclare donc pas `children`, et la directive ci-dessous est ce qui
// l'empêche de revenir : si `children` était accepté un jour, l'erreur attendue disparaîtrait et
// `@ts-expect-error` deviendrait lui-même une erreur (« Unused '@ts-expect-error' »).
//
// Elle vit ici, au niveau du module, et plus dans un `it()` : `tsc` la vérifie, vitest ne peut pas.
// L'assertion qui l'accompagnait — `expect(<SiteToaster>…</SiteToaster>).toBeDefined()` — ne pouvait
// pas échouer (un élément JSX est toujours défini), et faisait donc annoncer un test vert de plus
// que ce que la suite mesure réellement.
// @ts-expect-error — SiteToasterProps ne déclare pas `children`, et c'est tout l'intérêt.
const PIEGE_11_9 = <SiteToaster>{"contenu de la page"}</SiteToaster>;
void PIEGE_11_9;

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Ce que ces tests protègent, c'est exactement ce que ce composant existe pour empêcher : le piège
// de CLAUDE.md §11 point 9 (page blanche, sans erreur console ni échec de build) et le placement
// tranché à la mesure, qui ne se voit dans AUCUN rendu — les deux valeurs produisent le même toast.

// ⚠️ jsdom n'implémente pas `window.matchMedia`, et `ToastProvider` l'appelle au rendu
// (`useMediaQuery`, pour savoir s'il rend le bouton d'action dans la carte ou à côté) : sans ce
// bouchon, tout rendu du composant lève « window.matchMedia is not a function ». Bouchonné ICI et
// pas dans une configuration partagée — `vitest.config.ts` et `.storybook/**` sont communs à tous
// les agents.
//
// ⚠️ Il ÉVALUE la requête au lieu de répondre `false` en dur : HeroUI se sert vraiment du résultat,
// donc un bouchon menteur ferait mesurer un autre composant que celui rendu en production. Les deux
// seules formes employées (`min-width` / `max-width` en px) sont comparées à `window.innerWidth`.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches =
      (max ? window.innerWidth <= Number(max[1]) : true) &&
      (min ? window.innerWidth >= Number(min[1]) : true);
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}

// ⚠️ `ResizeObserver` manque aussi : HeroUI mesure la HAUTEUR de chaque carte pour décaler
// l'empilement (`use-measured-height`). Le bouchon est inerte, donc les hauteurs restent à zéro —
// sans conséquence ici : aucune de ces assertions ne porte sur la géométrie, qui se mesure au
// navigateur (story `SurUnEcranReel`) et pas en jsdom, lequel ne fait aucune mise en page.
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof window.ResizeObserver;

// ⚠️ La file de toasts est un SINGLETON de module (`toastQueue`), pas un état de composant : ce qui
// est empilé dans un test survit au démontage et se retrouve dans le suivant. C'est la propriété
// qui fait qu'un toast survit à un `router.push()`, et c'est aussi ce qui rendrait ces tests
// dépendants de leur ordre.
afterEach(() => {
  act(() => toast.clear());
});

// ⚠️ Recherche au niveau du DOCUMENT, pas du conteneur de rendu : react-aria porte la région dans
// `document.body` (constaté — scopée au conteneur, elle est introuvable). Corollaire : un test qui
// monte deux `SiteToaster` en laisserait deux dans le document et le premier répondrait pour le
// second, d'où le `cleanup()` explicite entre les deux rendus du test de `testId`.
function region(): HTMLElement | null {
  return document.querySelector('[data-slot="toast-region"]');
}

describe("SiteToaster", () => {
  it("ne rend RIEN tant qu'aucun toast n'existe", () => {
    // ⚠️ C'est le comportement qui déclenche le piège du §11.9 quand on l'utilise en wrapper : la
    // région retourne `null` tant que `visibleToasts.length === 0`. Utilisé correctement — en
    // SIBLING — ce même `null` est inoffensif, et c'est ce que fige ce test.
    //
    // ⚠️ L'assertion porte sur le DOCUMENT, surtout pas sur le conteneur de rendu : mesuré, la
    // région est portée dans `document.body`, donc le conteneur reste vide MÊME avec un toast à
    // l'écran. `expect(container.innerHTML).toBe("")` aurait été vrai dans les deux cas — un test
    // au vert qui ne mesure rien.
    render(<SiteToaster />);
    expect(region()).toBeNull();
  });

  it("affiche le message d'un toast de succès, puis d'un toast d'erreur", () => {
    render(<SiteToaster />);

    act(() => {
      toast.success("Correo reenviado.");
    });
    expect(region()?.textContent).toContain("Correo reenviado.");

    act(() => {
      toast.danger("No se pudo reenviar el correo.");
    });
    expect(region()?.textContent).toContain("No se pudo reenviar el correo.");
  });

  it("⚠️ place la région en HAUT, jamais en bas — la décision du lot, invisible au rendu", () => {
    // Les deux placements produisent un toast identique : seule cette classe les distingue, et
    // seule elle décide si le toast recouvre le bouton principal à 390 px. Mesuré au navigateur :
    // en `bottom`, `elementFromPoint` au centre du bouton « Pagar y reservar » renvoie le toast.
    // Sans ce test, revenir au défaut HeroUI (`bottom`) ne casserait rien de visible.
    render(<SiteToaster />);
    act(() => {
      toast.success("Correo reenviado.");
    });

    const classes = region()?.className ?? "";
    expect(classes).toContain("toast-region--top");
    expect(classes).not.toContain("toast-region--bottom");
  });

  // Plan 41, item C4 : la bordure marine, et le rayon écrit en valeur fixe. jsdom ne calcule pas le
  // rendu : on vérifie que la région habille SES toasts (le rendu est mesuré au navigateur).
  it("habille ses toasts : bordure du thème, rayon de 12 px, surface", () => {
    render(<SiteToaster />);
    act(() => {
      toast.success("Correo reenviado.");
    });
    const classes = region()?.className ?? "";
    expect(classes).toContain("[&_.toast]:border-[var(--border)]");
    expect(classes).toContain("[&_.toast]:rounded-[12px]");
  });

  it("expose testId en data-testid sur la région, et rien quand il est absent", () => {
    render(<SiteToaster testId="toaster" />);
    act(() => {
      toast.success("Correo reenviado.");
    });
    expect(region()?.getAttribute("data-testid")).toBe("toaster");

    // Démontage explicite : sans lui, les deux régions coexistent dans `document.body` et la
    // première répond à la requête ci-dessous (constaté — l'assertion passait au vert à tort).
    act(() => toast.clear());
    cleanup();

    render(<SiteToaster />);
    act(() => {
      toast.success("Correo reenviado.");
    });
    expect(region()?.hasAttribute("data-testid")).toBe(false);
  });
});
