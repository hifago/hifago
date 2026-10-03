import type { ReactNode } from "react";

// Le message contextuel de la vitrine : information, succès, alerte, erreur — plan 41, item S6
// (docs/specs/41-charte-hifago-toute-la-vitrine.md, 2026-10-02). Il remplace les encadrés écrits à
// la main, chacun avec ses classes (constat T22 : six formes différentes pour le même besoin).
//
// Trois décisions de la charte, tenues ici une fois pour toutes :
//   - TOUJOURS un fond blanc, sur sa propre surface `clara` : les couleurs d'état passent sur le
//     blanc (7,02 / 5,36 / 7,74:1) mais échouent sur l'or (3,39 / 2,58 / 3,73:1, §3.1 du plan). Posé
//     sur une page or ou sur le marine, l'encadré remet donc les jetons du clair pour son contenu ;
//   - la couleur du ton n'est que sur la bordure et l'icône. Le texte reste marine : la couleur ne
//     porte jamais seule l'information, c'est l'icône (forme distincte par ton) et les mots qui la
//     disent (components/README.md, « Lisibilité ») ;
//   - aucun `role` par défaut. Un `role="alert"` posé au montage d'un message déjà présent n'annonce
//     rien et pollue le premier rendu ; chaque appelant garde le rôle qu'il avait avant S6.
//
// `compacto` : la variante qui vit DANS une ligne (la ligne indisponible de `CartSummary`, plan 41
// F6) — moins de padding, rayon de 12 px comme les tuiles d'édition, texte à la taille de la ligne.
//
// ⚠️ N'importe RIEN de `@hifago/ui`, pas même `cn`, et ne porte pas `"use client"` : il sera rendu
// par des Server Components (bandeau camp de l'index, « hébergement requis » de Mi viaje), et
// l'import du barrel casse `next build` par transitivité (CLAUDE.md §11.16). Les classes sont des
// chaînes fixes, assemblées par tableau.
export type AvisoTono = "info" | "exito" | "alerta" | "error";

export type AvisoProps = {
  tono: AvisoTono;
  /** Déjà traduit. Un `<p>`, jamais un titre HTML : l'encadré n'entre pas dans la hiérarchie. */
  titulo?: string;
  children: ReactNode;
  /** Rangée d'actions sous le texte (bouton, lien, formulaire de confirmation). */
  accion?: ReactNode;
  /** Le rôle ARIA de l'appelant, conservé tel quel sur l'élément extérieur. */
  rol?: "status" | "alert";
  compacto?: boolean;
  testId?: string;
};

// Bordure et icône à la couleur du ton. L'info prend le bleu moyen (`--link`, 6,05:1 sur blanc) :
// la charte n'a pas de couleur d'information à part, et c'est celle des liens et du focus.
const TONO_CLASSES: Record<AvisoTono, { borde: string; icono: string }> = {
  info: { borde: "border-link", icono: "text-link" },
  exito: { borde: "border-success", icono: "text-success" },
  alerta: { borde: "border-warning", icono: "text-warning" },
  error: { borde: "border-danger", icono: "text-danger" },
};

// Les tracés, à la grille 24 et au trait de 2 px : un i, une coche, un triangle, une croix. Quatre
// formes différentes, pas quatre couleurs du même rond — c'est ce qui garde le ton lisible sans la
// couleur (daltonisme, impression, écran en plein soleil).
const TRACES: Record<AvisoTono, ReactNode> = {
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-5M12 8h.01" />
    </>
  ),
  exito: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12.5l3 3 5-6" />
    </>
  ),
  alerta: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </>
  ),
};

export function Aviso({
  tono,
  titulo,
  children,
  accion,
  rol,
  compacto = false,
  testId,
}: AvisoProps) {
  const sousId = (suffixe: string) => (testId ? `${testId}-${suffixe}` : undefined);
  const { borde, icono } = TONO_CLASSES[tono];

  return (
    <div
      data-superficie="clara"
      data-tono={tono}
      role={rol}
      data-testid={testId}
      className={[
        // `bg-surface` (utilitaire) bat le `--background` bleuté que `clara` pose en couche `base` :
        // l'encadré est blanc, comme une carte.
        "flex border bg-surface text-foreground",
        borde,
        compacto ? "gap-2 rounded-[12px] p-3 text-sm" : "gap-3 rounded-[16px] p-4 text-base sm:p-5",
      ].join(" ")}
    >
      {/* 20 px. Décalé de 2 px en taille normale pour se centrer sur la première ligne (24 px de
          hauteur de ligne en `text-base`, 20 px en `text-sm`). */}
      <svg
        viewBox="0 0 24 24"
        className={["size-5 shrink-0", compacto ? "" : "mt-0.5", icono].join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        data-testid={sousId("icono")}
      >
        {TRACES[tono]}
      </svg>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {titulo ? (
          <p className="font-semibold" data-testid={sousId("titulo")}>
            {titulo}
          </p>
        ) : null}
        <div data-testid={sousId("cuerpo")}>{children}</div>
        {accion ? (
          <div className="flex flex-wrap items-center gap-2 pt-2" data-testid={sousId("accion")}>
            {accion}
          </div>
        ) : null}
      </div>
    </div>
  );
}
