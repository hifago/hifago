import NextImage from "next/image";
import type { ReactNode } from "react";
import { COLUMNA_PORTADA } from "@/components/atoms/PageShell";

// LE HÉROS DE L'ACCUEIL — maquette fournie par Jérôme le 2026-10-01 (« page d'accueil 1 » du
// parcours « réserver une activité »), reprise le 2026-10-02 sur sa seconde maquette : sur l'or de
// la charte, la rue aux zócalos de Guatapé dans le coin haut droit, le logo hifaGO · Guatapé, le
// titre « Guatapé merece más de un día. » et son sous-titre, puis la navigation par type et la
// recherche.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// TOUT EST PROPORTIONNEL À LA COLONNE (`cqw`), ET C'EST CE QUI REND LA MAQUETTE À TOUTE LARGEUR
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// La maquette est une composition d'une seule colonne. La seconde maquette est le rendu à 1 280 px
// de large agrandi ×1,346 (le header, le menu et la recherche y tombent au pixel près) : ses
// écarts et ses tailles ont été MESURÉS sur l'image ramenée à 1 280 px (colonne de 960 px), puis
// convertis en pourcentage de la colonne — le logo en occupe 26 %, le titre a un œil de 5,79 %…
// Exprimés en `cqw` (unité de conteneur, `@container` sur la colonne), ils redonnent les
// proportions de la maquette à 390 comme à 1 280 px. Les `clamp()` ne bornent que ce qui
// deviendrait illisible ou démesuré aux extrêmes. ⚠️ Les `cqw` sont posés sur des ENFANTS de la
// colonne, jamais sur elle-même : sur l'élément conteneur lui-même, `cqw` se résout contre
// l'ancêtre suivant (ici aucun, donc l'écran).
//
// ⚠️ PAS DE "use client" : rien ici n'a d'état. La navigation et la recherche arrivent par props —
// la recherche est un composant client (`BuscadorInicio`), qu'un Server Component peut rendre sans
// le devenir lui-même.
export type PortadaInicioProps = {
  /**
   * Le texte du `<h1>`, déjà traduit — le titre VISIBLE du héros. Un `\n` y marque la coupure de
   * ligne de la maquette (« Guatapé merece / más de un día. »), rendue par `whitespace-pre-line` :
   * un `<br>` collerait les deux mots dans le `textContent` que lisent moteurs et lecteurs d'écran.
   */
  titulo: string;
  /** Le sous-titre sous le `<h1>`, déjà traduit, même convention de coupure (`\n`). */
  lema: string;
  /** La navigation par type (« Actividades • Alojamiento • … »). */
  navegacion: ReactNode;
  /** Le bloc de recherche (barre, puis Fechas / Personas). */
  busqueda: ReactNode;
  testId?: string;
};

export function PortadaInicio({ titulo, lema, navegacion, busqueda, testId }: PortadaInicioProps) {
  return (
    // `isolate` : l'illustration passe DERRIÈRE le contenu (`-z-10`) sans passer derrière la page —
    // l'index négatif reste enfermé dans ce contexte d'empilement. `overflow-hidden` : l'illustration
    // déborde à droite de l'écran (voulu, voir plus bas), et sur un écran très large elle est plus
    // haute que le héros — elle se peindrait sinon par-dessus la première section.
    <div className="relative isolate overflow-hidden" data-testid={testId}>
      {/* L'ILLUSTRATION — l'asset de Jérôme (traits de la rue aux zócalos sur fond transparent),
          `filigrane guatape bleu.png` converti TEL QUEL en `public/brand/calle-zocalos.webp`, dans
          ses bleus d'origine et sans opacité ajoutée (décision Jérôme, 2026-10-01 : un premier
          passage le recolorait au bleu poudre à 55 %, ce qui le rendait beige sur l'or).

          RECALÉE sur la seconde maquette (2026-10-02), où elle s'écarte pour laisser la place au
          titre : sur l'ancien cadrage, le pan gauche de la maison passait sous « merece ». Mesuré
          sur la maquette ramenée à 1 280 px : 61,3 % de la largeur de l'écran, 13 % de sa propre
          largeur hors de l'écran à droite (le grand pilier reste entier, la maison voisine est
          coupée), et descendue de 16,6 % de sa propre hauteur — les deux décalages en `translate`,
          qui se résolvent sur l'image elle-même et gardent donc ce cadrage à toute largeur.
          ⚠️ Plafonnée à 49rem (784 px), SA taille à 1 280 px : la colonne du texte, elle, cesse de
          grandir à 1 024 px. Au-delà, une illustration qui grandirait encore glisse sous la
          colonne — mesuré à 1 723 px avec l'ancien plafond de 64rem : la ligne de la rue
          traversait « Eventos » et le bout de la barre de recherche.

          ⚠️ LE FONDU DU HAUT : le dessin de l'asset touche le bord haut de son cadre (toit, pilier,
          plantes). Descendu, il serait coupé net à mi-hauteur du header. Sur la maquette il monte
          jusqu'en haut de l'écran — un prolongement que l'asset ne contient pas. Le masque le fait
          apparaître en fondu sur ses 14 premiers pour cent plutôt que sur une coupe franche.

          ⚠️ DESCENDUE DE 50 PX SOUS `md` (`top-[50px] md:top-0`), avec le logo, le titre et le
          sous-titre — voir `DESCENSO_MOVIL` plus bas. Ceux-ci sont descendus de 10 px de plus
          ensuite ; elle, non (la demande ne la citait pas).

          ⚠️ SOUS `md`, DEUX RETOUCHES DE PLUS (Jérôme, 2026-10-02) : décalée de 10 px vers la
          gauche (`right-[10px]`), et le fondu du haut réduit de moitié (7 % au lieu de 14 %, soit
          ≈ 11 px au lieu de 22 à 390). Puis agrandie de 10 px de large (« le bas ne doit pas
          bouger, c'est le haut qui va monter, et le gauche ») : un `scale` autour du coin
          BAS-DROIT (`origin-bottom-right`), qui laisse ce coin exactement en place — les `translate`
          en % se résolvent sur la boîte non agrandie. 1.042 = (239 + 10) / 239, sa largeur à 390 ;
          plus large, l'écart grandit en proportion. Pas un `w-[calc(…+10px)]` : il aurait fallu
          recalculer `top` et `right` pour garder le coin, et `top` porte la descente de 50 px
          que le test vérifie. À partir de `md`, inchangé.

          Décorative : `alt=""` + `aria-hidden`. `priority` : c'est le plus grand visuel au-dessus
          de la ligne de flottaison, donc le candidat LCP le plus probable — le charger
          paresseusement dégraderait le LCP. */}
      <NextImage
        src="/brand/calle-zocalos.webp"
        alt=""
        aria-hidden
        width={1536}
        height={1024}
        priority
        sizes="(min-width: 1280px) 784px, 62vw"
        className="pointer-events-none absolute right-[10px] top-[50px] -z-10 h-auto w-[61.3%] max-w-[49rem] translate-x-[13%] translate-y-[16.6%] origin-bottom-right scale-[1.042] select-none [mask-image:linear-gradient(to_bottom,transparent,black_7%)] md:right-0 md:top-0 md:scale-100 md:[mask-image:linear-gradient(to_bottom,transparent,black_14%)]"
      />

      <div className={`${COLUMNA_PORTADA} @container`}>
        {/* `pt-16` : la hauteur EXACTE du header transparent (`SiteHeader`, `h-16`), qui est posé
            par-dessus ce héros. Les deux valeurs bougent ensemble. */}
        <div className="flex flex-col pt-16 pb-[clamp(1.25rem,5cqw,3rem)]">
          {/* Le logo de la maquette : `logo-horizontal-marine-bleu.png` de la charte (marine et
              bleu ciel, la déclinaison sans or — l'autre disparaîtrait sur l'or), recadré au
              contenu (`logo-portada.webp`, ratio 1.86). Seconde maquette : 26 % de la colonne
              (250 px à 1 280), 31 px sous le header ; jamais sous 136 px, en dessous « Guatapé »
              devient illisible. Décoratif : ce n'est plus le `<h1>` — le titre visible l'est
              devenu — et le nom du site est déjà dans le `<title>` et le JSON-LD.

              ⚠️ DESCENSO_MOVIL — SOUS `md` SEULEMENT, LE HAUT DU HÉROS DESCEND DE 60 PX (Jérôme,
              2026-10-02 : « descends le logo, la phrase d'accroche et le filigrane de 50 points, sans
              toucher au reste de la page — seulement en mobile », puis « baisse le logo, le titre
              et le sous-titre ensemble de dix pixels »). Le logo prend `+ 60px` de marge, le titre
              et le sous-titre suivent ; le menu en reprend AUTANT (voir sa marge) : le menu, la
              recherche et les sections restent où ils étaient. Le menu, resserré et redescendu de
              25 px le même jour (voir sa marge), garde un écart avec le sous-titre.
              Le filigrane, lui, n'a suivi que les 50 premiers px. Le logo et le menu bougent
              ENSEMBLE — un test le vérifie. À partir de `md`, les valeurs d'avant, inchangées. */}
          <NextImage
            src="/brand/logo-portada.webp"
            alt=""
            aria-hidden
            width={900}
            height={483}
            priority
            sizes="(min-width: 1088px) 250px, (min-width: 524px) 26vw, 136px"
            className="mt-[calc(clamp(0.75rem,3.2cqw,2rem)_+_60px)] h-auto w-[26cqw] min-w-[8.5rem] md:mt-[clamp(0.75rem,3.2cqw,2rem)]"
          />

          {/* LE <h1>, ENFIN VISIBLE. La spec 28 l'avait posé masqué « provisoirement », en attendant
              le « bloc titré » que Jérôme annonçait au-dessus de la recherche : c'est celui-ci.

              Poppins et non la police de titre : la maquette le compose en Poppins très grasse et
              serrée. La règle de base des `<h1>`–`<h3>` (`globals.css`) pose la police de titre, sa
              graisse 400 et son interlettrage `--tracking-titre` : les trois sont rendus à Poppins
              sur le `<span>`, et pas sur le `<h1>` — l'interlettrage du jeton ne vaut que pour la
              police de titre (`check-tokens.sh`), et ce texte n'y est pas composé.
              Mesures (maquette à 1 280 px) : œil de 31,2 px → Poppins 800 de 55,6 px (5,79cqw),
              interlettrage −0,04 em (seule valeur qui redonne à la fois la largeur des deux lignes
              et la hauteur d'œil), 61,7 px de ligne à ligne (1,11). Jamais sous 34 px à partir de
              `md`.
              ⚠️ SOUS `md`, 5 PX DE MOINS (Jérôme, 2026-10-02 : « réduis de 10 points », puis
              « augmente de nouveau de cinq points »), titre ET sous-titre : 29 px au lieu de 34 à
              390. Même geste que `DESCENSO_MOVIL` — un `calc` sur la valeur d'origine, que `md:`
              rétablit telle quelle. */}
          <h1 className="mt-[clamp(1rem,5.4cqw,3.25rem)]">
            <span className="block whitespace-pre-line font-sans text-[length:calc(clamp(2.125rem,5.79cqw,3.5rem)_-_5px)] font-extrabold leading-[1.11] tracking-[-0.04em] md:text-[clamp(2.125rem,5.79cqw,3.5rem)]">
              {titulo}
            </span>
          </h1>
          {/* Le sous-titre : Poppins 400 de 37,8 px (3,94cqw), interligne 1,22, 6,5 px sous le
              titre. `mb` : avec la marge (inchangée) du menu au-dessous, il redonne les 72 px de la
              maquette entre le sous-titre et le menu — qui reste ainsi EXACTEMENT où il était à
              1 280 px (y = 574), comme la recherche sous lui.
              ⚠️ Sous `md`, 18 px fixes (Jérôme, 2026-10-02 : « passe le sous-titre à 18 pixels »),
              après deux retouches en relatif le même jour (−10, puis +5). */}
          <p
            className="mt-[clamp(0.25rem,0.68cqw,0.5rem)] mb-[1.63cqw] whitespace-pre-line text-[18px] leading-[1.22] md:text-[clamp(1.375rem,3.94cqw,2.5rem)]"
            data-testid={testId ? `${testId}-lema` : undefined}
          >
            {lema}
          </p>

          {/* Les liens du menu font 44 px de haut (cible tactile) pour un texte de 16 à 28 px : leur
              boîte porte déjà l'écart de la maquette au-dessus et au-dessous du texte — d'où une
              marge réduite au-dessus du menu, et aucune entre le menu et la recherche. */}
          {/* `+ 40px` (demande de Jérôme, 2026-10-01) : le menu, et tout ce qui le suit, descend
              de 40 px — sous le logo à l'époque, sous le sous-titre depuis la seconde maquette, dont
              la marge basse complète l'écart. Valeur fixe.
              ⚠️ SOUS `md`, LE MENU EST RECALÉ ENTRE SOUS-TITRE ET RECHERCHE, qui ne bougent pas :
                · `− 60px` : les 60 px dont le logo est descendu (`DESCENSO_MOVIL`), repris ici ;
                · `+ 30px` puis `-mb-[10px]` (Jérôme, 2026-10-02 : « rapproche les deux lignes du menu
                  de 10 et le menu de la barre de 15, en descendant le menu, sans toucher à la barre »).
                  Les liens passent de 44 à 34 px (`MenuTiposPortada`) : deux lignes = 20 px de moins.
                  La 2e ligne descend de 15 (plus près de la barre de 15), la 1re de 25 (plus près
                  de la 2e de 10) — d'où le haut du menu à + 30 ; la marge basse négative rend les
                  20 + 10 px qui manqueraient sinon sous le menu : la recherche reste au pixel près.
              ⚠️ Réglé pour DEUX lignes (téléphones, mesuré de 360 à 430 px). Là où le menu tient sur
              une seule ligne sous `md` (≈ 520 à 767 px), la recherche descend de 10 px : le CSS ne
              sait pas d'avance si le menu passera à la ligne. Un test refait le compte. */}
          <div className="mt-[calc(clamp(0rem,1.6cqw,1rem)_+_10px)] -mb-[10px] md:mt-[calc(clamp(0rem,1.6cqw,1rem)_+_40px)] md:mb-0">
            {navegacion}
          </div>
          {/* `mt-[20px]` (demande de Jérôme, 2026-10-01) : la recherche, et tout ce qui la suit,
              descend de 20 px sous le menu. */}
          <div className="mt-[20px]">{busqueda}</div>
        </div>
      </div>
    </div>
  );
}
