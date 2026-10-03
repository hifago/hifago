"use client";

import { useTranslations } from "next-intl";
import { Carousel, type CarouselSlide } from "@hifago/ui";
import { Image, type ImageProps } from "@/components/atoms/Image";

// La galerie de photos d'une fiche — produit ou établissement (2026-09-02, vague 4).
//
// Reprend `products/[slug]/ProductPhotos.tsx`, qui portait déjà les bonnes décisions : le
// `Carousel` d'Embla reste dans `packages/ui`, VOLONTAIREMENT indépendant de Next.js (c'est écrit
// dans son en-tête), et c'est l'appelant qui lui fournit ses images via `renderSlide`. Ce fichier
// est cet appelant côté vitrine ; `apps/admin/components/catalog-card.tsx` est son équivalent côté
// back-office. Le `Carousel` n'est modifié qu'additivement (prop `controles`, plan 41 S9).
//
// `"use client"` obligatoire : le `Carousel` est un composant client (Embla), et importer le barrel
// `@hifago/ui` depuis un Server Component casse `next build` (CLAUDE.md §11.16).
//
// Ce que cette molécule apporte par-dessus `ProductPhotos` :
//
//   1. Elle rend ses slides avec l'atome `Image`, jamais `next/image` en direct. `alt`, `sizes` et
//      `loading` deviennent donc obligatoires PAR LE TYPE, et un visuel manquant reçoit le
//      substitut de l'atome au lieu d'un trou.
//   2. ⚠️ Au plus UN slide prioritaire, et c'est le premier (docs/specs/04-gestion-images.md §8).
//      C'est exactement ce que la prop obligatoire de l'atome existe pour rendre impossible à
//      oublier : Embla monte TOUS les slides dans le DOM, y compris ceux qui sont hors écran. Sans
//      la distinction, ou bien tout est lazy et le LCP part en retard, ou bien tout est prioritaire
//      et le navigateur précharge cinq photos dont quatre invisibles — deux régressions Core Web
//      Vitals silencieuses, dans les deux sens.
//
//      ⚠️ Mais « le premier slide est prioritaire » n'est vrai que si la BANDE l'est. Ce n'était
//      pas prévu au montage du composant et c'est la story `DansUneCarte` qui l'a montré, mesuré :
//      une grille de cartes portant chacune une bande posait un `<link rel=preload>` PAR CARTE —
//      trois cartes, trois preloads, donc vingt sur un catalogue de vingt produits, dont dix-huit
//      sous la ligne de flottaison. D'où la prop `loading`, requise, transposition exacte du
//      raisonnement de l'atome d'un cran plus haut : la bande ne peut pas savoir où elle est dans
//      la page, la page si. Arbitré par Jérôme le 2026-09-02, contre la consigne initiale du lot
//      qui figeait la règle à l'intérieur du composant.
//   3. ⚠️ Galerie VIDE : elle rend le substitut, là où `ProductPhotos` ne rendait rien du tout.
//      C'est la seule différence de COMPORTEMENT avec le composant qu'elle remplace, et elle est
//      délibérée — c'est le repli générique demandé par le §9 du spec, que ce dernier signale
//      explicitement comme « à vérifier, jamais silencieusement supposé acquis ». À arbitrer par
//      Jérôme au moment de migrer les pages : sur la fiche produit, le bloc « établissement »
//      afficherait désormais un aplat au ratio 4/3 au lieu de disparaître.
//
// Ce que ce composant ne refait PAS : masquer les flèches et les points quand il n'y a qu'une
// seule photo. Le `Carousel` le fait déjà (règle §8 du spec, comportement legacy conservé) — le
// refaire par-dessus dupliquerait la règle à deux endroits.

/** `CarouselSlide` fournit déjà `id` et `alt` — mêmes champs que `CatalogCardPhoto` côté admin. */
export type PhotoStripPhoto = CarouselSlide & { url: string };

export type PhotoStripProps = {
  photos: PhotoStripPhoto[];
  /**
   * REQUIS. `"priority"` = cette bande est au-dessus de la ligne de flottaison (la galerie d'une
   * fiche) : son PREMIER slide devient le LCP, les suivants restent `"lazy"`. `"lazy"` = elle ne
   * l'est pas (une carte dans une grille) : aucun slide n'est prioritaire, pas même le premier.
   */
  loading: "lazy" | "priority";
  /**
   * REQUIS, même raisonnement que sur l'atome : une galerie ne connaît pas la largeur du conteneur
   * qui l'accueille, la page si. Valeur employée en production sur la fiche produit :
   * `"(max-width: 640px) 100vw, 640px"`.
   */
  sizes: string;
  /**
   * Le ratio de chaque photo, relayé tel quel à l'atome `Image` — qui le porte déjà, avec ses
   * trois valeurs. Même raisonnement que `sizes` ci-dessus : une bande ne connaît pas la forme que
   * le conteneur attend d'elle, la carte si. Défaut `"4/3"` (celui de l'atome) : les deux usages
   * antérieurs — galerie de fiche produit, carte de grille — sont inchangés. `"1/1"` sert les
   * cartes carrées du carrusel de `SeccionOfertas` (référence de Jérôme, 2026-10-01).
   */
  ratio?: ImageProps["ratio"];
  testId?: string;
};

export function PhotoStrip({ photos, sizes, loading, ratio, testId }: PhotoStripProps) {
  // ⚠️ Les trois libellés d'accessibilité du carrousel étaient en ESPAGNOL EN DUR dans
  // `packages/ui` — correct pour `apps/admin`, qui n'est pas localisé, mais une fuite ici : un
  // visiteur anglophone au lecteur d'écran entendait « Foto siguiente » sur l'élément principal
  // d'une fiche. La prop `labels` du `Carousel` est optionnelle et garde l'espagnol par défaut,
  // donc l'admin ne change pas d'un caractère (spec 30 §7d).
  const t = useTranslations("Common");
  // ⚠️ Cette enveloppe n'est pas décorative : le `Carousel` porte un `data-testid="carousel"` FIXE,
  // qu'il n'expose pas en prop, et la fiche produit affiche DEUX galeries (produit puis
  // établissement). Sans elle, aucun test ne peut désigner l'une plutôt que l'autre — et le
  // `Carousel` est hors périmètre, donc on ne lui ajoute pas de prop pour ça.
  return (
    <div data-testid={testId}>
      {photos.length === 0 ? (
        // `alt=""` : le substitut de l'atome est `aria-hidden`, il ne rend aucune balise <img> et
        // n'a donc rien à décrire. `loading` n'a lui non plus aucun effet sans source — il est
        // relayé tel quel plutôt que forcé, pour que le contrat se lise pareil dans les deux
        // branches. Même arrondi que la galerie. Plus de rangée de points à réserver dessous : les
        // commandes sont SUR la photo depuis le plan 41 (S9).
        <div className="overflow-hidden rounded-[24px]">
          <Image
            src={null}
            alt=""
            sizes={sizes}
            loading={loading}
            ratio={ratio}
            testId={testId ? `${testId}-photo-0` : undefined}
          />
        </div>
      ) : (
        // PLAN 41, S9 (2026-10-03) : flèches rondes de 44 px et compteur « 1 / 5 » posés SUR la
        // photo, lisibles sur une photo claire comme sombre ; photo arrondie à 24 px (l'arrondi de
        // la racine, que le cadre du carrousel hérite). Les points de 8 px disparaissent.
        <Carousel
          slides={photos}
          variant="gallery"
          controles="sobreFoto"
          className="rounded-[24px]"
          labels={{
            anterior: t("carruselAnterior"),
            siguiente: t("carruselSiguiente"),
            irA: (n) => t("carruselIrA", { n }),
          }}
          renderSlide={(photo, index) => (
            // Pas de conteneur `relative aspect-[4/3]` autour, contrairement à ProductPhotos :
            // l'atome porte déjà le sien, c'est la moitié de son travail en mode `fill`.
            <Image
              src={photo.url}
              alt={photo.alt}
              sizes={sizes}
              ratio={ratio}
              // Le premier slide n'est prioritaire QUE si la bande l'est : `index === 0` seul
              // ferait de chaque carte d'une grille un préchargement.
              loading={index === 0 && loading === "priority" ? "priority" : "lazy"}
              testId={testId ? `${testId}-photo-${index}` : undefined}
            />
          )}
        />
      )}
    </div>
  );
}
