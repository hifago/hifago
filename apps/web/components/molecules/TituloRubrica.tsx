// Le titre à point de l'accueil, extrait pour toute la vitrine : plan 41, item S1
// (docs/specs/41-charte-hifago-toute-la-vitrine.md, 2026-10-02). C'est la signature des titres de
// rubrique Hifago (« Actividades● », « Mi viaje● »), qui ne vivait que dans `SeccionPortada`.
//
//     Actividades●                ← titre (classe de rôle de F1) + point décoratif
//     ──────────────────────      ← trait sous le titre, sur 68 % du conteneur
//
// Trois tailles, une par emploi :
//   - `portada` : les titres de section de l'accueil. Les classes en `cqw` de l'accueil sont reprises
//     TELLES QUELLES (28 → 60 px, 6,3 % de la colonne) : l'accueil doit rester identique au pixel, et
//     ce sont des réglages validés par Jérôme (journal du 01 au 02/10). ⚠️ `cqw` demande un ancêtre
//     `@container` : la section de l'accueil, ou celle du rail (S3) ;
//   - `pagina`  : le <h1> d'un bandeau de page intérieure (S2), rôle `titre-page`, sans trait par
//     défaut (« le bandeau suffit », §3.6 du plan) ;
//   - `seccion` : le <h2> d'une rubrique dans une page (« Habitaciones● »), rôle `titre-section`.
//
// Les couleurs viennent de la SURFACE, jamais du composant (F3, arbitrage D15) : le point est bleu
// poudre sur l'or et or sur le clair et sur le marine (`--punto-titulo`), le trait marine, or sur le
// marine (`--trazo-titulo`). Sur l'or, ce sont exactement les couleurs que l'accueil écrivait à la
// main (`--default` et la couleur du texte).
//
// Le nom d'un produit ou d'un établissement (nom propre, souvent long) prend `punto={false}` (§3.6).
//
// ⚠️ N'importe RIEN de `@hifago/ui`, pas même `cn`, et ne porte pas `"use client"` : il est rendu par
// des Server Components (l'accueil, les bandeaux), et l'import du barrel casse `next build` par
// transitivité (CLAUDE.md §11.16). Classes écrites en toutes lettres : Tailwind v4 ne génère pas une
// classe fabriquée par interpolation.
export type TituloRubricaTamano = "portada" | "pagina" | "seccion";

export type TituloRubricaProps = {
  /** Requis, jamais deviné : c'est la page qui sait où est son seul <h1>. */
  as: "h1" | "h2";
  /** Déjà traduit. */
  texto: string;
  tamano: TituloRubricaTamano;
  /** Faux pour un nom propre (produit, établissement). */
  punto?: boolean;
  /** Défaut : vrai pour `portada` et `seccion`, faux pour `pagina`. */
  trazo?: boolean;
  /** Posé sur la balise du titre : c'est elle que les e2e lisent (`seccion-<tipo>-titulo`). */
  testId?: string;
};

// La classe de RÔLE porte police, graisse 400 et `--tracking-titre` (globals.css, F1). Pour
// `portada`, les utilitaires `cqw` de l'accueil battent la taille du rôle (couche `utilities`).
const TITULO_CLASES: Record<TituloRubricaTamano, string> = {
  portada: "titre-section text-[clamp(1.75rem,6.3cqw,3.75rem)] leading-none",
  pagina: "titre-page",
  seccion: "titre-section",
};

// Le trait : celui de l'accueil en `cqw` de sa section ; ailleurs, 68 % de la largeur du titre
// (l'enveloppe est un bloc pleine largeur), à l'épaisseur que l'accueil a autour de 26 → 40 px de
// titre (2 à 4 px de 28 à 60).
const TRAZO_CLASES: Record<TituloRubricaTamano, string> = {
  portada: "mt-[0.8cqw] h-[clamp(2px,0.5cqw,4px)] w-[68cqw]",
  pagina: "mt-2 h-[3px] w-[68%]",
  seccion: "mt-1.5 h-[3px] w-[68%]",
};

export function TituloRubrica({ as, texto, tamano, punto = true, trazo, testId }: TituloRubricaProps) {
  const Tag = as;
  const conTrazo = trazo ?? tamano !== "pagina";

  const titulo = (
    <Tag className={TITULO_CLASES[tamano]} data-testid={testId}>
      {texto}
      {/* Le POINT est un bloc vide en ligne : sa base est son bord bas, il s'assied donc sur la
          ligne de base du texte. En `em` : il suit la taille du titre, quelle qu'elle soit. */}
      {punto ? (
        <span
          aria-hidden="true"
          className="ml-[0.14em] inline-block size-[0.3em] rounded-full bg-[var(--punto-titulo)]"
        />
      ) : null}
    </Tag>
  );

  if (!conTrazo) return titulo;

  // L'enveloppe garde le titre et son trait ensemble : posés dans un flex à `gap` (bandeau, S2), ils
  // seraient sinon séparés comme deux éléments.
  return (
    <div>
      {titulo}
      <div aria-hidden="true" className={["bg-[var(--trazo-titulo)]", TRAZO_CLASES[tamano]].join(" ")} />
    </div>
  );
}
