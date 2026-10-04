import type { ReactNode } from "react";

// Un titre dont le NIVEAU est une décision de la page, pas du composant (2026-09-01, vague 1 des
// atomes, prompts/vague1-agent-A.md §3.2). C'est la règle SEO de components/README.md rendue
// impossible à contourner par distraction : `as` est requis, jamais deviné, donc « un seul <h1> et
// une hiérarchie sans saut » se décide à l'endroit qui en a la vue d'ensemble.
//
// ⚠️ Pourquoi `size` est décorrélé de `as` : « Disponibilidad », sous le <h1> d'une fiche, est un
// <h2> qui se lit comme un titre de bloc, pas comme une rubrique. Sans cette séparation, un
// développeur pressé écrit <h3> pour obtenir un titre plus discret et casse la hiérarchie —
// exactement ce que la règle cherche à empêcher. Le niveau est sémantique, la taille est visuelle,
// et ce ne sont pas la même décision.
//
// N'importe rien de "@hifago/ui" pour la même raison que PageShell (CLAUDE.md §11.16) : ce titre
// sera rendu par des pages Server Components.
export type TitleProps = {
  /** Requis, jamais deviné : c'est ce qui garantit un seul <h1> et une hiérarchie sans saut. */
  as: "h1" | "h2" | "h3";
  children: ReactNode;
  /** Le RÔLE typographique, décorrélé du niveau. Défaut dérivé de `as`. */
  size?: TitleSize;
  testId?: string;
};

export type TitleSize = "pagina" | "seccion" | "bloque" | "etiqueta";

// Les classes de RÔLE de la charte (plan 41, F1 et F2 ; tableau du §3.3), définies une fois dans
// `packages/ui/src/styles/globals.css` (`@layer components`) : police, taille (jeton `--taille-…`),
// interligne, interlettrage et graisse. Ce fichier ne pose AUCUNE classe de graisse ni de taille :
//   - `pagina`   → `titre-page`    : police de titre, 32 → 52 px — le <h1> des pages intérieures ;
//   - `seccion`  → `titre-section` : police de titre, 26 → 40 px — une rubrique (« Habitaciones ») ;
//   - `bloque`   → `titre-bloc`    : Anton, 20 → 22 px — « Disponibilidad », « Equipamiento » ;
//   - `etiqueta` → `etiquette`     : Poppins 600, 14 → 15 px — l'en-tête d'une liste.
// ⚠️ Avant le 2026-10-02, `text-2xl font-semibold` et `text-sm font-medium` : la police de titre à
// 14 px, et un FAUX GRAS synthétisé par le navigateur sur Anton, qui n'existe qu'en 400.
const SIZE_CLASSES: Record<TitleSize, string> = {
  pagina: "titre-page",
  seccion: "titre-section",
  bloque: "titre-bloc",
  etiqueta: "etiquette",
};

const DEFAULT_SIZE: Record<TitleProps["as"], TitleSize> = {
  h1: "pagina",
  h2: "seccion",
  h3: "bloque",
};

export function Title({ as, children, size, testId }: TitleProps) {
  const Tag = as;
  return (
    <Tag className={SIZE_CLASSES[size ?? DEFAULT_SIZE[as]]} data-testid={testId}>
      {children}
    </Tag>
  );
}
