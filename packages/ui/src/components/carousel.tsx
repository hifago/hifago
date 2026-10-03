"use client";

import * as React from "react";
import useEmblaCarousel from "embla-carousel-react";
import { Button } from "@heroui/react";
import { cn } from "../lib/utils";

/**
 * Carrousel/galerie client (spec docs/specs/04-gestion-images.md §10) — Embla plutôt qu'un
 * portage fidèle du carrousel 3D maison (~400 lignes JS vanilla, `reservar.js` legacy) : ce
 * dernier n'est pas une décision de conception à préserver, seulement un palliatif de l'absence de
 * composant réutilisable à l'époque. Embla est headless (même raisonnement qu'`ImageCrop`) — le
 * style visuel (dots, flèches, mode "hero") est posé par-dessus en HeroUI/Tailwind, jamais fourni
 * par la lib. Comportement legacy explicitement conservé : les dots/flèches n'apparaissent que si
 * `slides.length > 1` (règle §8 du spec).
 *
 * `packages/ui` reste indépendant de Next.js (même règle que `ServerPagination`) : ce composant ne
 * rend jamais `<img>`/`next/image` lui-même — l'appelant fournit `renderSlide`, ce qui permet à
 * `apps/web` de brancher `next/image` (lazy loading + `priority` sur le premier slide, cf. §8 du
 * spec) sans que ce package partagé ne dépende de Next.js.
 */
export type CarouselSlide = {
  id: string;
  alt: string;
};

/**
 * Les trois libellés d'accessibilité du carrousel.
 *
 * ⚠️ POURQUOI CETTE PROP EXISTE (2026-09-08, spec 30 §7d). Ils étaient en espagnol EN DUR. C'est
 * correct pour `apps/admin`, qui n'est pas localisé — mais `apps/web` sert es ET en, et un
 * visiteur anglophone au lecteur d'écran entendait « Foto siguiente » sur l'élément principal
 * d'une fiche. Aucune règle ni aucun test ne l'attrapait.
 *
 * OPTIONNELLE, avec les valeurs espagnoles d'origine en défaut : aucun appelant existant ne
 * change, et l'admin garde son comportement au caractère près.
 */
export type CarouselLabels = {
  anterior: string;
  siguiente: string;
  /** Reçoit le numéro de la photo (1-indexé). */
  irA: (n: number) => string;
};

const LABELS_POR_DEFECTO: CarouselLabels = {
  anterior: "Foto anterior",
  siguiente: "Foto siguiente",
  irA: (n) => `Ir a la foto ${n}`,
};

/**
 * L'habillage des commandes (2026-10-03, plan 41 de la vitrine, item S9). ADDITIF : `defecto` est
 * le rendu d'origine, au caractère près — l'admin (`catalog-card.tsx`) ne passe rien et ne change
 * pas.
 *
 * `sobreFoto` — les commandes posées SUR la photo, lisibles quelle qu'elle soit (constat T15 : des
 * boutons `outline` de 32 px à glyphe « ‹ » disparaissaient sur une photo sombre) :
 *   - flèches : boutons ronds de 44 px (cible tactile), fond `--surface` à 90 %, flou d'arrière-plan
 *     léger, ombre `--overlay-shadow`, chevron SVG à la couleur `--surface-foreground` (marine en
 *     vitrine, et qui ne bascule pas avec les surfaces) ; à 12 px du bord, centrées verticalement ;
 *   - au lieu des points de 8 px (cibles de 8 px, sous tous les seuils) : un COMPTEUR « 1 / 5 » en
 *     bulle, en bas à droite — la bulle des tuiles photo, blanc sur voile noir à 55 % (4,74:1 au pire
 *     cas, photo blanche). Décoratif pour un lecteur d'écran : le texte alternatif de chaque photo
 *     dit déjà « foto i de n » côté vitrine ;
 *   - l'arrondi de la photo est celui de la racine (`className`) : le cadre qui rogne les slides
 *     prend `rounded-[inherit]`.
 */
export type CarouselControles = "defecto" | "sobreFoto";

export type CarouselProps<T extends CarouselSlide> = {
  slides: T[];
  renderSlide: (slide: T, index: number) => React.ReactNode;
  /** "gallery" = dots + flèches (fiche produit/établissement) ; "hero" = flèches seules, plus grand. */
  variant?: "gallery" | "hero";
  /** Voir `CarouselLabels`. Omise → espagnol, le comportement d'origine. */
  labels?: CarouselLabels;
  /** Voir `CarouselControles`. Omise → `defecto`, le rendu d'origine. */
  controles?: CarouselControles;
  className?: string;
};

// `sobreFoto` : chaînes littérales complètes (Tailwind ne génère pas une classe interpolée).
const FLECHE_SUR_PHOTO =
  "absolute top-1/2 z-[1] flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-surface-foreground shadow-[var(--overlay-shadow)] backdrop-blur-sm outline-none transition-transform active:scale-95 focus-visible:status-focused motion-reduce:transition-none";
const COMPTEUR_SUR_PHOTO =
  "pointer-events-none absolute bottom-3 right-3 z-[1] rounded-full border-[1.5px] border-white bg-black/55 px-2.5 py-0.5 text-xs font-bold tabular-nums text-white backdrop-blur-sm";

function Chevron({ sens }: { sens: "gauche" | "droite" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={sens === "gauche" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

export function Carousel<T extends CarouselSlide>({
  slides,
  renderSlide,
  variant = "gallery",
  labels = LABELS_POR_DEFECTO,
  controles = "defecto",
  className,
}: CarouselProps<T>) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false });
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const hasMultiple = slides.length > 1;

  React.useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setSelectedIndex(emblaApi.selectedScrollSnap());
    emblaApi.on("select", onSelect);
    onSelect();
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi]);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (!hasMultiple || !emblaApi) return;
    if (event.key === "ArrowLeft") emblaApi.scrollPrev();
    if (event.key === "ArrowRight") emblaApi.scrollNext();
  }

  if (slides.length === 0) return null;

  if (controles === "sobreFoto") {
    return (
      <div
        className={cn("relative", className)}
        data-testid="carousel"
        onKeyDown={handleKeyDown}
        tabIndex={hasMultiple ? 0 : undefined}
      >
        <div className="overflow-hidden rounded-[inherit]" ref={emblaRef}>
          <div className="flex touch-pan-y">
            {slides.map((slide, index) => (
              <div className="w-full min-w-0 shrink-0 grow-0" key={slide.id} data-testid="carousel-slide">
                {renderSlide(slide, index)}
              </div>
            ))}
          </div>
        </div>

        {hasMultiple ? (
          <>
            <button
              type="button"
              className={cn(FLECHE_SUR_PHOTO, "left-3")}
              onClick={() => emblaApi?.scrollPrev()}
              aria-label={labels.anterior}
              data-testid="carousel-prev"
            >
              <Chevron sens="gauche" />
            </button>
            <button
              type="button"
              className={cn(FLECHE_SUR_PHOTO, "right-3")}
              onClick={() => emblaApi?.scrollNext()}
              aria-label={labels.siguiente}
              data-testid="carousel-next"
            >
              <Chevron sens="droite" />
            </button>
            <span className={COMPTEUR_SUR_PHOTO} aria-hidden="true" data-testid="carousel-counter">
              {selectedIndex + 1} / {slides.length}
            </span>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn("relative", className)}
      data-testid="carousel"
      onKeyDown={handleKeyDown}
      tabIndex={hasMultiple ? 0 : undefined}
    >
      <div className="overflow-hidden rounded-md" ref={emblaRef}>
        <div className="flex touch-pan-y">
          {slides.map((slide, index) => (
            <div className="w-full min-w-0 shrink-0 grow-0" key={slide.id} data-testid="carousel-slide">
              {renderSlide(slide, index)}
            </div>
          ))}
        </div>
      </div>

      {hasMultiple ? (
        <>
          <Button
            variant="outline"
            size="sm"
            className="absolute left-2 top-1/2 -translate-y-1/2"
            onPress={() => emblaApi?.scrollPrev()}
            aria-label={labels.anterior}
            data-testid="carousel-prev"
          >
            ‹
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="absolute right-2 top-1/2 -translate-y-1/2"
            onPress={() => emblaApi?.scrollNext()}
            aria-label={labels.siguiente}
            data-testid="carousel-next"
          >
            ›
          </Button>
        </>
      ) : null}

      {variant === "gallery" ? (
        hasMultiple ? (
          <div className="mt-2 flex justify-center gap-1.5" data-testid="carousel-dots">
            {slides.map((slide, index) => (
              <button
                key={slide.id}
                type="button"
                aria-label={labels.irA(index + 1)}
                onClick={() => emblaApi?.scrollTo(index)}
                className={cn(
                  "h-2 w-2 rounded-full transition-colors",
                  index === selectedIndex ? "bg-primary" : "bg-muted"
                )}
                data-testid="carousel-dot"
              />
            ))}
          </div>
        ) : (
          // Comportement legacy inchangé : une seule photo n'affiche jamais de points RÉELS
          // (§8 du spec). Mais un espace réservé et invisible (mêmes classes/dimensions que la
          // vraie rangée) évite qu'une carte à une seule photo soit plus basse qu'une carte qui
          // en a plusieurs dans la même grille — c'est ce défaut, pas le point d'origine, qui a
          // été signalé. `aria-hidden` : rien ici n'est interactif ni à annoncer.
          <div className="invisible mt-2 flex justify-center gap-1.5" aria-hidden="true">
            <span className="h-2 w-2 rounded-full" />
          </div>
        )
      ) : null}
    </div>
  );
}
