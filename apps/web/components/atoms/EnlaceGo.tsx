import NextImage from "next/image";
import { Link } from "@/i18n/navigation";

// Le « GO → » de l'accueil, extrait pour toute la vitrine : plan 41, item S5
// (docs/specs/41-charte-hifago-toute-la-vitrine.md, 2026-10-02). C'est le lien de marque : « voir
// tout » d'une section, « voir l'établissement », « voir le détail ». Pas une action de formulaire,
// qui reste un bouton (§3.6 du plan).
//
//     GO →     ← « GO » du LOGO (glyphes de la charte, `go.webp`) + flèche décorative
//
// Deux tailles :
//   - `portada` : les `clamp` en `cqw` de l'accueil, repris TELS QUELS (GO de 28 à 52 px) — l'accueil
//     doit rester identique au pixel. ⚠️ `cqw` demande un ancêtre `@container` (la section). Le
//     `-mr-1` annule le `p-1` du lien : le bord droit de la flèche est celui de son bloc, sur
//     lequel l'accueil aligne la pointe (voir `SeccionRiel`) ;
//   - `normal`  : GO de 32 px, flèche de 20 px, pour un lien posé dans une page.
//
// NOM ACCESSIBLE : « GO », le texte qu'on voit (WCAG 2.5.3), puis `label` en `sr-only` — « GO Más
// actividades ». C'est aussi le texte d'ancre que lit un moteur. ⚠️ `label` nomme TOUJOURS la cible
// (« Ver todo: Agua », « Ver Casa Kayam ») : dix liens au même nom vers dix URL ne disent rien à
// qui parcourt la liste des liens.
//
// La flèche lit `--flecha-go` (F3) : bleu poudre sur l'or, bleu moyen sur le clair. ⚠️ JAMAIS SUR UNE
// SURFACE MARINE : `go.webp` est marine et bleu ciel, il y disparaîtrait (la surface marine ne
// définit d'ailleurs pas `--flecha-go`).
//
// Au survol : GO à ×1,05, flèche décalée de 4 px ; rien ne bouge sous `prefers-reduced-motion`.
// Cible de 44 px (`min-h-11`).
//
// ⚠️ Composant serveur : ni `"use client"`, ni le barrel du design system (CLAUDE.md §11.16). Le
// `Link` de `@/i18n/navigation` : lui seul conserve le préfixe de langue.
export type EnlaceGoTamano = "portada" | "normal";

export type EnlaceGoProps = {
  href: string;
  /** Déjà traduit — un atome ne traduit rien. Nomme la cible, lu après « GO ». */
  label: string;
  tamano: EnlaceGoTamano;
  testId?: string;
};

// Chaînes littérales complètes : Tailwind v4 ne génère pas une classe fabriquée par interpolation.
const CLASES: Record<EnlaceGoTamano, { enlace: string; go: string; flecha: string }> = {
  portada: {
    enlace: "-mr-1 gap-[1.4cqw]",
    go: "h-[clamp(1.75rem,5.1cqw,3.25rem)]",
    flecha: "h-[clamp(1.1rem,3.6cqw,2.25rem)]",
  },
  normal: {
    enlace: "gap-2",
    go: "h-8",
    flecha: "h-5",
  },
};

export function EnlaceGo({ href, label, tamano, testId }: EnlaceGoProps) {
  const clases = CLASES[tamano];
  return (
    <Link
      href={href}
      className={[
        "group/go inline-flex min-h-11 items-center rounded-full p-1 focus-visible:status-focused",
        clases.enlace,
      ].join(" ")}
      data-testid={testId}
    >
      <NextImage
        src="/brand/go.webp"
        alt="GO"
        width={214}
        height={116}
        className={[
          "w-auto transition-transform duration-200 group-hover/go:scale-105 motion-reduce:transition-none",
          clases.go,
        ].join(" ")}
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 40 24"
        fill="none"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={[
          "w-auto stroke-[var(--flecha-go)] transition-transform duration-200 group-hover/go:translate-x-1 motion-reduce:transition-none",
          clases.flecha,
        ].join(" ")}
      >
        <path d="M3 12h32M25 3l10 9-10 9" />
      </svg>
      <span className="sr-only">{label}</span>
    </Link>
  );
}
