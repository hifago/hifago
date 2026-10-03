// Le bloc « aucun résultat » de l'accueil filtrée (2026-09-08, lot D, Tranche 1 de
// docs/specs/28-vitrine-accueil-et-resultats.md §0 — cas limite « Critères, aucun résultat nulle
// part : état vide explicite sous la barre, la barre reste utilisable »).
//
// Il n'existait NULLE PART dans le dépôt : l'ancien accueil (`CatalogBrowser`) filtrait en mémoire
// et affichait une chaîne `noResults` nue au milieu de sa grille. La spec 28 retire cette clé et
// remonte l'état vide au niveau de la page. Il vit dans `molecules/` et non dans le `page.tsx` de
// l'accueil parce que les pages de listing (spec 29) en auront besoin telles quelles — la
// convention « une spec d'écran NOMME les composants manquants » de components/README.md §« Quand
// une spec d'écran a besoin d'un composant qui n'existe pas » l'a d'ailleurs nommé d'avance.
//
// ⚠️ Aucun titre, au sens HTML : deux `<p>`, jamais un `<h*>`, et surtout pas l'atome `Title`.
// La spec 28 §0.152 impose « un seul `<h1>` ; les titres de section sont des `<h2>` », et l'accueil
// pose déjà ce `<h1>` (masqué visuellement) plus un `<h2>` par section. Un état vide qui entrerait
// dans cette hiérarchie y ajouterait un niveau parasite, variable selon qu'il y a des résultats ou
// non — c'est-à-dire une structure de titres qui change avec les données. Le test tient cette
// règle explicitement, parce que rien à l'écran ne la trahirait (§11.20 de CLAUDE.md : une règle
// que rien ne vérifie n'est pas une règle).
//
// ⚠️ N'importe RIEN de `@hifago/ui`, pas même `cn`, et ne porte donc PAS `"use client"` : il est
// rendu par le `page.tsx` de l'accueil, qui est un Server Component (CLAUDE.md §11.16 — l'import
// du barrel casse `next build` par transitivité). Il n'a besoin d'aucune primitive HeroUI : des
// classes fixes suffisent. Même raison pour le `sousId` local ci-dessous plutôt que celui de
// `atoms/Field.tsx`, qui est un fichier client.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ILLUSTRÉ, ET AVEC UNE ACTION — plan 41, item S8 (2026-10-03, constat T24)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// « Un état vide doit relancer le parcours. » Jusqu'au plan 41, ce bloc rendait un titre de 16 px et
// une description de 14 px en `text-muted`, sans rien d'autre : il fermait la page au lieu de la
// relancer. Depuis S8 :
//   - une ILLUSTRATION, décorative : une pastille de 128 → 160 px découpée dans le motif de la
//     charte (`motif-bleu-ciel.webp`, inutilisé jusque-là et destiné aux états vides, §3.7 du plan),
//     sur fond bleu poudre. Par défaut ; `ilustracion={null}` la retire. `next/image` la sert à sa
//     taille (`sizes`), en chargement différé : ce n'est jamais le LCP ;
//   - le titre au rôle `titre-bloc` (Anton, 20 → 22 px) — toujours sur un `<p>`, voir plus haut ;
//   - la description en corps de texte, 16 px. Sa couleur `text-muted` est marine sur l'or (F3) ;
//   - une ACTION facultative (`accion`) : un bouton ou un « GO → », passé tout rendu par l'appelant.
//     Pas sur l'accueil et les listings filtrés, où la recherche juste au-dessus EST l'action — un
//     « Réinitialiser » ici dupliquerait une commande déjà à l'écran, à trois centimètres de distance.
//
// Pas de `role="status"` : changer de critères provoque une navigation, pas une mise à jour en
// place, et un `aria-live` posé au montage n'annonce rien tout en polluant le premier rendu.
import NextImage from "next/image";
import type { ReactNode } from "react";

export type EstadoVacioProps = {
  /** Déjà traduit — une molécule reçoit son libellé, la page traduit. */
  titulo: string;
  /** Déjà traduite. Optionnelle : une phrase qui dit quoi faire ensuite. */
  descripcion?: string;
  /** Ce qui relance le parcours (bouton, « GO → »), déjà rendu. Rien quand l'action est ailleurs. */
  accion?: ReactNode;
  /** La pastille décorative du motif (défaut), ou rien. */
  ilustracion?: "motivo" | null;
  testId?: string;
};

export function EstadoVacio({
  titulo,
  descripcion,
  accion,
  ilustracion = "motivo",
  testId,
}: EstadoVacioProps) {
  const sousId = (suffixe: string) => (testId ? `${testId}-${suffixe}` : undefined);

  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center" data-testid={testId}>
      {ilustracion === "motivo" ? (
        // Décorative : `alt=""` et `aria-hidden` sur la pastille. `relative` + `fill` : l'image
        // couvre la pastille, rognée en cercle ; jamais répétée en mosaïque (§3.7 du plan).
        <div
          aria-hidden="true"
          className="relative mb-1 size-32 shrink-0 overflow-hidden rounded-full bg-[var(--default)] sm:size-40"
          data-testid={sousId("ilustracion")}
        >
          <NextImage
            src="/brand/motif-bleu-ciel.webp"
            alt=""
            fill
            sizes="160px"
            loading="lazy"
            className="object-cover"
          />
        </div>
      ) : null}
      {/*
        `max-w-prose` sur les deux paragraphes : ce n'est pas une largeur en dur (c'est `65ch`, donc
        exprimé en caractères) mais la borne de longueur de ligne exigée par components/README.md
        § Lisibilité. Sans elle, un texte centré s'étale sur toute la largeur d'un écran 1280 et
        devient illisible — ce que la story `TextoLargo` existe pour montrer.
      */}
      <p className="titre-bloc max-w-prose" data-testid={sousId("titulo")}>
        {titulo}
      </p>
      {descripcion ? (
        <p className="max-w-prose text-base text-muted" data-testid={sousId("descripcion")}>
          {descripcion}
        </p>
      ) : null}
      {accion ? (
        <div className="flex flex-wrap justify-center gap-2 pt-2" data-testid={sousId("accion")}>
          {accion}
        </div>
      ) : null}
    </div>
  );
}
