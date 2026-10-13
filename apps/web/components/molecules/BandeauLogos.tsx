import type { CSSProperties } from "react";
import Image from "next/image";

// Le bandeau déroulant de logos (demande de Jérôme, 2026-10-13). Il remplace la bande décorative
// du bord haut du pied (plan 41, A6) : des logos d'institutions défilent en continu, et la liste
// s'allonge sans rien toucher ici — le composant reçoit ses logos, il n'en connaît aucun.
//
// N'importe rien de `@hifago/ui` (ni `cn`) : il reste importable d'un Server Component
// (`components/README.md`, règle RSC par transitivité).
//
// COMMENT ÇA DÉFILE. Deux groupes identiques côte à côte, chacun glissant de sa propre largeur
// (plus l'écart) : quand le premier est sorti, le second est exactement à sa place et la boucle
// repart sans à-coup. Chaque groupe fait AU MOINS la largeur du bandeau (`min-w-full`), sinon un
// trou apparaîtrait à droite sur un grand écran ; et la liste y est répétée jusqu'à
// `LOGOS_MIN_PAR_GROUPE`, sinon deux logos seuls flotteraient à 900 px l'un de l'autre.
//
// ACCESSIBILITÉ. Chaque logo est nommé UNE fois : seule la première occurrence porte son `alt`,
// toutes les répétitions sont `aria-hidden` (un lecteur d'écran n'entend pas huit fois la mairie).
// Le défilement se met en pause au survol et au focus, et S'ARRÊTE sous `prefers-reduced-motion` :
// les répétitions disparaissent alors (`hidden` : elles sont décoratives) et les logos se posent
// centrés, sans mouvement.

export type LogoBandeau = {
  src: string;
  /** Nom de l'institution, tel qu'il s'écrit — un nom propre ne se traduit pas. */
  alt: string;
  /** Dimensions INTRINSÈQUES du fichier, rogné à son dessin. */
  width: number;
  height: number;
};

export type BandeauLogosProps = {
  logos: readonly LogoBandeau[];
  testId?: string;
};

// Hauteur d'un logo CARRÉ, en px. Les autres en dérivent à SURFACE égale (hauteur ÷ √ratio) : à
// hauteur égale, un logo en longueur écrase un logo ramassé ; à largeur égale, c'est l'inverse.
// Un nouveau logo trouve donc sa taille seul, d'après ses seules dimensions.
const HAUTEUR_REFERENCE = 104;
const LOGOS_MIN_PAR_GROUPE = 8;
// Vitesse constante quel que soit le nombre de logos : la durée suit la longueur du groupe.
const SECONDES_PAR_LOGO = 5;

export function tailleAffichee({ width, height }: Pick<LogoBandeau, "width" | "height">) {
  const ratio = width / height;
  const hauteur = Math.round(HAUTEUR_REFERENCE / Math.sqrt(ratio));
  return { width: Math.round(hauteur * ratio), height: hauteur };
}

const GROUPE =
  "flex min-w-full shrink-0 items-center justify-around gap-[var(--bandeau-ecart)] animate-[bandeau_var(--bandeau-duree)_linear_infinite] group-hover/bandeau:[animation-play-state:paused] group-focus-within/bandeau:[animation-play-state:paused] motion-reduce:animate-none";

export function BandeauLogos({ logos, testId }: BandeauLogosProps) {
  if (logos.length === 0) return null;

  const repetitions = Math.max(1, Math.ceil(LOGOS_MIN_PAR_GROUPE / logos.length));
  const groupe = Array.from({ length: repetitions }, () => logos).flat();

  return (
    <div
      // Le fondu des deux bords est un MASQUE (alpha), pas une couleur peinte : il vaut sur
      // n'importe quelle surface. Retiré sans mouvement, où il rognerait un logo immobile.
      className="group/bandeau flex gap-[var(--bandeau-ecart)] overflow-hidden border-b border-separator py-5 [--bandeau-ecart:3rem] [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)] motion-reduce:px-4 motion-reduce:[mask-image:none] md:[--bandeau-ecart:5rem]"
      style={{ "--bandeau-duree": `${groupe.length * SECONDES_PAR_LOGO}s` } as CSSProperties}
      data-testid={testId}
    >
      {[0, 1].map((copie) => (
        <ul
          key={copie}
          aria-hidden={copie > 0 ? true : undefined}
          className={
            copie > 0
              ? `${GROUPE} motion-reduce:hidden`
              : `${GROUPE} motion-reduce:w-full motion-reduce:flex-wrap motion-reduce:justify-center motion-reduce:gap-y-4`
          }
        >
          {groupe.map((logo, i) => {
            const repetition = copie > 0 || i >= logos.length;
            const taille = tailleAffichee(logo);
            return (
              <li
                key={i}
                aria-hidden={repetition && copie === 0 ? true : undefined}
                className={repetition ? "shrink-0 motion-reduce:hidden" : "shrink-0"}
              >
                <Image
                  src={logo.src}
                  alt={repetition ? "" : logo.alt}
                  width={taille.width}
                  height={taille.height}
                  sizes={`${taille.width}px`}
                  loading="lazy"
                  className="max-w-none"
                />
              </li>
            );
          })}
        </ul>
      ))}
    </div>
  );
}
