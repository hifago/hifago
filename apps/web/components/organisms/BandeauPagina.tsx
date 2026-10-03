import type { ReactNode } from "react";
import { TituloRubrica } from "@/components/molecules/TituloRubrica";

// Le bandeau or des pages intérieures : plan 41, item S2 (docs/specs/41-charte-hifago-toute-la-vitrine.md,
// 2026-10-03 ; constats T1 et T16, arbitrage D1 = A). C'est le pont visuel entre l'accueil et le
// reste du site : sous le header or (C1), la page continue sur l'or le temps de dire où l'on est,
// puis passe au clair pour lire, remplir et payer. Il porte le SEUL `<h1>` de la page.
//
//     ┌──────────── header or ────────────┐
//     │ Inicio › Actividades › Agua       │  ← fil d'Ariane (`migas`, déjà rendu)
//     │ ← Volver al catálogo              │  ← lien retour (`volver`)
//     │ Agua●                             │  ← <h1>, `TituloRubrica tamano="pagina"`
//     │ Kayak, jetski y paseos…           │  ← chapô (rôle `chapo`, 60 caractères par ligne)
//     │ [meta] [acción]          [imagen] │  ← puces, adresse… ; recherche ou CTA ; décor (≥ lg)
//     └───────────────────────────────────┘
//
// Deux variantes :
//   - `navegacion` : la page est DÉJÀ or (`PageShell fondo="acento"`, index et catégories) — le
//     bandeau n'a pas de fond propre, il est le haut de la page or ;
//   - `contenido`  : la page est claire (fiche, tunnel, compte) — le bandeau peint lui-même l'or À
//     FOND PERDU (`data-bleed`, que `PageShell pagina` sort de la colonne) et pose sa surface or
//     (`data-superficie="or"`, F3 : texte, liens et focus y passent au marine). Le contenu dessous
//     reste clair. ⚠️ Il doit être un enfant DIRECT du `<main>` de `PageShell pagina`.
// Collé au header or (même or, sans filet) : `PageShell pagina` n'a pas de padding haut (F7).
//
// Disposition : la colonne de la page ; 24 px au-dessus (32 à partir de `sm`), 32 au-dessous (48) en
// `contenido`, 0 au-dessous (24) en `navegacion` (voir `contenu`) ; 12 puis 16 px entre les éléments. L'image (D16 : celle d'une catégorie) passe à droite à partir de
// `lg`, et disparaît en dessous : c'est un DÉCOR (`aria-hidden`), la seule chose qu'on ait le droit
// de masquer selon la largeur (`.claude/rules/ui.md`).
//
// Ce qu'il ne fait PAS, volontairement :
//   - aucun JSON-LD : il reste dans `page.tsx`, rendu côté serveur (`.claude/rules/seo.md` §6), et
//     le fil visible doit rester celui du JSON-LD — la page passe le même tableau aux deux ;
//   - aucune image `priority` : le LCP d'une page intérieure est sa première photo de CONTENU ;
//   - aucun autre titre : la page ne doit plus rendre de `<h1>` (le test le vérifie ici, la page
//     le vérifie dans son item P).
//
// ⚠️ Composant serveur : ni `"use client"`, ni le barrel du design system (CLAUDE.md §11.16). Le fil
// d'Ariane (`Migas`, client) et la recherche lui arrivent DÉJÀ RENDUS, en `ReactNode`.
export type BandeauPaginaProps = {
  /** Le fil d'Ariane, déjà rendu (`Migas`). */
  migas?: ReactNode;
  /** Le lien retour, déjà rendu (`BackLink`). */
  volver?: ReactNode;
  /** Le `<h1>` de la page, déjà traduit. */
  titulo: string;
  /**
   * Le `data-testid` du `<h1>`, quand un e2e en lit un autre que `<testId>-titulo` : les fiches
   * gardent `product-name` et `establishment-name` (plan 41, P3 et P4 ; même raison que `chapoTestId`).
   */
  tituloTestId?: string;
  /** Le point du titre à point. Vrai par défaut ; faux pour un nom propre (produit, établissement). */
  conPunto?: boolean;
  /** La phrase sous le titre, déjà traduite. */
  chapo?: string;
  /**
   * Le `data-testid` du chapô, quand un e2e en lit un autre que `<testId>-chapo` : la page de
   * catégorie garde `categoria-descripcion` (`e2e/categorias.spec.ts`, plan 41, P2).
   */
  chapoTestId?: string;
  /** Puces, adresse, lien vers l'établissement… déjà rendus. */
  meta?: ReactNode;
  /** La recherche ou le CTA de la page, déjà rendu. */
  accion?: ReactNode;
  /** Décor à droite à partir de `lg` (image de catégorie, D16), déjà rendu, `alt=""`, sans `priority`. */
  imagen?: ReactNode;
  variante: "navegacion" | "contenido";
  testId?: string;
};

export function BandeauPagina({
  migas,
  volver,
  titulo,
  tituloTestId,
  conPunto = true,
  chapo,
  chapoTestId,
  meta,
  accion,
  imagen,
  variante,
  testId,
}: BandeauPaginaProps) {
  const sousId = (suffixe: string) => (testId ? `${testId}-${suffixe}` : undefined);

  const contenu = (
    <div
      className={[
        // ⚠️ La marge basse dépend de la variante (décision du 2026-10-03, déléguée par Jérôme) : en
        // `navegacion`, le contenu suit sur le MÊME or, et l'écart de 24 px du `<main>` de
        // `PageShell pagina` s'y ajoute — 32/48 px ici laissaient 64 puis 80 px vides sous la
        // recherche, plus que l'écart entre deux rails (32 → 58 px, celui de l'accueil). 0 puis 24 px
        // ramènent l'espace visible à 32 puis 56 px : un seul rythme sur la page. En `contenido`, la
        // marge est DANS l'or, avant le clair : elle reste.
        variante === "navegacion"
          ? "grid gap-x-8 pt-6 pb-0 sm:pt-8 sm:pb-6"
          : "grid gap-x-8 pt-6 pb-8 sm:pt-8 sm:pb-12",
        imagen ? "lg:grid-cols-[minmax(0,1fr)_auto]" : "",
      ].join(" ")}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:gap-4">
        {migas}
        {volver}
        <TituloRubrica as="h1" texto={titulo} tamano="pagina" punto={conPunto} testId={tituloTestId ?? sousId("titulo")} />
        {chapo ? (
          <p className="chapo max-w-[60ch]" data-testid={chapoTestId ?? sousId("chapo")}>
            {chapo}
          </p>
        ) : null}
        {meta ? (
          <div className="flex flex-wrap items-center gap-2" data-testid={sousId("meta")}>
            {meta}
          </div>
        ) : null}
        {accion ? <div data-testid={sousId("accion")}>{accion}</div> : null}
      </div>
      {imagen ? (
        // Décor : masqué sous `lg`, où il n'aurait pas de place à côté du texte.
        <div aria-hidden="true" className="hidden lg:block" data-testid={sousId("imagen")}>
          {imagen}
        </div>
      ) : null}
    </div>
  );

  if (variante === "navegacion") {
    return (
      <header data-variante="navegacion" data-testid={testId}>
        {contenu}
      </header>
    );
  }

  // `contenido` : l'or à fond perdu. Sous-grille des trois colonnes de `PageShell pagina` — la
  // même mécanique que `SeccionOfertas` — et le contenu revient dans la colonne du milieu.
  return (
    <header
      data-variante="contenido"
      data-bleed=""
      data-superficie="or"
      className="col-span-full grid grid-cols-subgrid"
      data-testid={testId}
    >
      <div className="col-start-2 min-w-0">{contenu}</div>
    </header>
  );
}
