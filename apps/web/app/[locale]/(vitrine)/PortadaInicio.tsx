import NextImage from "next/image";
import type { ReactNode } from "react";
import { COLUMNA_PORTADA } from "@/components/atoms/PageShell";

// LE HÉROS DE L'ACCUEIL — maquette fournie par Jérôme le 2026-10-01 (« page d'accueil 1 » du
// parcours « réserver une activité »), reproduite à l'identique avec les assets qu'il a fournis :
// sur l'or de la charte, la rue aux zócalos de Guatapé en traits clairs dans le coin haut droit, le
// grand logo hifaGO · Guatapé, puis la navigation par type et la recherche.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// TOUT EST PROPORTIONNEL À LA COLONNE (`cqw`), ET C'EST CE QUI REND LA MAQUETTE À TOUTE LARGEUR
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// La maquette est une composition d'une seule colonne. Ses écarts et ses tailles ont été MESURÉS au
// pixel sur l'image fournie (colonne de 572 px de large) puis convertis en pourcentage de la
// colonne : le logo en occupe 39 %, l'espace entre le header et le logo 13 %… Exprimés en `cqw`
// (unité de conteneur, `@container` sur la colonne), ils redonnent les proportions de la maquette
// à 390 comme à 1 280 px. Les `clamp()` ne bornent que ce qui deviendrait illisible ou démesuré aux
// extrêmes. ⚠️ Les `cqw` sont posés sur des ENFANTS de la colonne, jamais sur elle-même : sur
// l'élément conteneur lui-même, `cqw` se résout contre l'ancêtre suivant (ici aucun, donc l'écran).
//
// ⚠️ PAS DE "use client" : rien ici n'a d'état. La navigation et la recherche arrivent par props —
// la recherche est un composant client (`BuscadorInicio`), qu'un Server Component peut rendre sans
// le devenir lui-même.
export type PortadaInicioProps = {
  /**
   * Le texte du `<h1>`, déjà traduit. ⚠️ Le `<h1>` de la page EST le logo : le texte reste dans le
   * DOM (`sr-only`) pour les lecteurs d'écran et les moteurs, le logo le montre à l'œil — une page
   * sans `<h1>` lisible serait une faute d'accessibilité comme de référencement (spec 28 §5).
   */
  titulo: string;
  /** La navigation par type (« Actividades • Alojamiento • … »). */
  navegacion: ReactNode;
  /** Le bloc de recherche (barre, puis Fechas / Personas). */
  busqueda: ReactNode;
  testId?: string;
};

export function PortadaInicio({ titulo, navegacion, busqueda, testId }: PortadaInicioProps) {
  return (
    // `isolate` : l'illustration passe DERRIÈRE le contenu (`-z-10`) sans passer derrière la page —
    // l'index négatif reste enfermé dans ce contexte d'empilement. `overflow-hidden` : sur un écran
    // très large l'illustration est plus haute que le héros, et elle se peindrait sinon par-dessus
    // la première section.
    <div className="relative isolate overflow-hidden" data-testid={testId}>
      {/* L'ILLUSTRATION — l'asset de Jérôme (traits de la rue aux zócalos sur fond transparent),
          `filigrane guatape bleu.png` converti TEL QUEL en `public/brand/calle-zocalos.webp`, dans
          ses bleus d'origine et sans opacité ajoutée (décision Jérôme, 2026-10-01 : un premier
          passage le recolorait au bleu poudre à 55 %, ce qui le rendait beige sur l'or). Ancrée au
          coin haut droit de l'ÉCRAN, comme sur
          la maquette (70,5 % de la largeur, mesuré), et plafonnée à 64rem pour ne pas envahir un
          très grand écran. Décorative : `alt=""` + `aria-hidden`.
          `priority` : c'est le plus grand visuel au-dessus de la ligne de flottaison, donc le
          candidat LCP le plus probable — le charger paresseusement dégraderait le LCP. */}
      <NextImage
        src="/brand/calle-zocalos.webp"
        alt=""
        aria-hidden
        width={1536}
        height={1024}
        priority
        sizes="(min-width: 1452px) 1024px, 71vw"
        className="pointer-events-none absolute right-0 top-0 -z-10 h-auto w-[70.5%] max-w-[64rem] select-none"
      />

      <div className={`${COLUMNA_PORTADA} @container`}>
        {/* `pt-16` : la hauteur EXACTE du header transparent (`SiteHeader`, `h-16`), qui est posé
            par-dessus ce héros. Les deux valeurs bougent ensemble. */}
        <div className="flex flex-col pt-16 pb-[clamp(1.25rem,5cqw,3rem)]">
          {/* `+ 150px` (demande de Jérôme, 2026-10-01) : tout le contenu de la page descend de
              150 px, l'illustration NON — elle est en `absolute`, hors du flux, et reste collée au
              haut de l'écran. Valeur fixe volontaire, hors de la proportion `cqw`. */}
          <h1 className="mt-[calc(clamp(1.75rem,11cqw,6.5rem)_+_150px)]">
            <span className="sr-only">{titulo}</span>
            {/* Le logo de la maquette : `logo-horizontal-marine-bleu.png` de la charte (marine et
                bleu ciel, la déclinaison sans or — l'autre disparaîtrait sur l'or), recadré au
                contenu (`logo-portada.webp`, ratio 1.86, celui mesuré sur la maquette). 39 % de la
                colonne ; jamais sous 136 px, en dessous « Guatapé » devient illisible. */}
            <NextImage
              src="/brand/logo-portada.webp"
              alt=""
              aria-hidden
              width={900}
              height={483}
              priority
              sizes="(min-width: 1088px) 400px, 39vw"
              className="h-auto w-[39cqw] min-w-[8.5rem] max-w-[25rem]"
            />
          </h1>

          {/* Les liens du menu font 44 px de haut (cible tactile) pour un texte de 16 à 28 px : leur
              boîte porte déjà l'écart de la maquette au-dessus et au-dessous du texte — d'où une
              marge réduite au-dessus du menu, et aucune entre le menu et la recherche. */}
          <div className="mt-[clamp(0rem,1.6cqw,1rem)]">{navegacion}</div>
          <div>{busqueda}</div>
        </div>
      </div>
    </div>
  );
}
