import type { ReactNode } from "react";
import type { OrderState } from "@/lib/orders/orderState";

// La puce de statut de la vitrine : plan 41, item S7 (docs/specs/41-charte-hifago-toute-la-vitrine.md,
// 2026-10-03). Un statut doit se lire d'un coup d'œil, et pas par la seule couleur (constat T23) :
// aujourd'hui l'état d'une commande est une phrase, celui d'une ligne un texte gris de 12 px.
//
//     ( ✓ Pagada )   ( ! Por pagar )   ( × Expirada )   ( i Confirmando )   ( • Anulada )
//
// Une pilule de 28 px, Poppins 600 à 13 px, une icône de 14 px puis le libellé. Cinq tons :
//   - `exito`, `alerta`, `error`, `info` : fond teinté de la couleur du ton, texte et icône du ton.
//     La teinte est mélangée au BLANC (`--surface`), jamais à la transparence : la puce garde son
//     contraste posée sur l'or, le clair ou le marine. Mesuré au navigateur (story
//     `Affichage/PuceEstado`, 2026-10-03) : succès 5,81:1, erreur 6,36, info 5,46 à 12 % de teinte ;
//     l'ALERTE tombait à 4,53:1 à 12 %, au ras du seuil de 4,5 — elle est teintée à 8 % (4,81:1) ;
//   - `neutro` : bleu poudre et marine, l'état sans enjeu (réservée, annulée, places restantes).
//
// JAMAIS LA COULEUR SEULE : chaque ton a une icône de forme différente (coche, point
// d'exclamation, croix, i, point), et le libellé dit l'état en toutes lettres.
//
// LA CORRESPONDANCE ÉTAT → TON est écrite ici, une fois, pour que « Mis reservas » (P8) et l'écran
// du jeton (P7) disent la même chose du même objet (même raison que `lib/orders/orderState.ts`).
// Les deux autres usages du plan se décident chez l'appelant, sans table : édition de camp « N
// cupos » → `neutro`, « Completo » → `error` ; événement « Gratis » → `exito`.
//
// ⚠️ Composant serveur : ni `"use client"`, ni le barrel du design system (CLAUDE.md §11.16). Il ne
// traduit rien : le libellé lui arrive en `children`.
export type PuceEstadoTono = "exito" | "alerta" | "error" | "info" | "neutro";

export type PuceEstadoProps = {
  tono: PuceEstadoTono;
  /** Le libellé, déjà traduit. C'est lui qui dit l'état ; l'icône le double, la couleur aussi. */
  children: ReactNode;
  testId?: string;
};

/** L'état d'une commande (`deriveOrderState`), plus `failed`, état d'ÉCRAN d'un paiement refusé. */
export const TONO_POR_ESTADO_PEDIDO: Record<OrderState | "failed", PuceEstadoTono> = {
  paid: "exito",
  confirmed: "exito",
  unpaid: "alerta",
  awaiting: "info",
  failed: "error",
  expired: "error",
  paid_not_honored: "error",
  cancelled: "neutro",
  refunded: "info",
};

/** L'état d'une ligne de commande (`order_lines.status`, messages `lineStatus.*`). */
export const TONO_POR_ESTADO_LINEA = {
  reserved: "neutro",
  fulfilled: "exito",
  no_show: "alerta",
  cancelled_by_client: "error",
  cancelled_by_provider: "error",
  expired: "error",
  superseded: "neutro",
} as const satisfies Record<string, PuceEstadoTono>;

/** Le ton d'une ligne. Un état inconnu (ajouté en base avant ce fichier) reste `neutro`. */
export function tonoDeLinea(status: string): PuceEstadoTono {
  return (TONO_POR_ESTADO_LINEA as Record<string, PuceEstadoTono>)[status] ?? "neutro";
}

// Chaînes littérales complètes : Tailwind v4 ne génère pas une classe fabriquée par interpolation.
const TONO_CLASES: Record<PuceEstadoTono, string> = {
  exito: "bg-[color-mix(in_oklab,var(--success)_12%,var(--surface))] text-success",
  alerta: "bg-[color-mix(in_oklab,var(--warning)_8%,var(--surface))] text-warning",
  error: "bg-[color-mix(in_oklab,var(--danger)_12%,var(--surface))] text-danger",
  info: "bg-[color-mix(in_oklab,var(--charte-bleu-moyen)_12%,var(--surface))] text-[var(--charte-bleu-moyen)]",
  neutro: "bg-[var(--default)] text-[var(--default-foreground)]", // 8,02:1
};

// Les tracés, grille 24, trait de 2,5 px (lisible à 14 px). Cinq formes distinctes.
const TRACES: Record<PuceEstadoTono, ReactNode> = {
  exito: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alerta: <path d="M12 5v9M12 19h.01" />,
  error: <path d="M7 7l10 10M17 7L7 17" />,
  info: <path d="M12 11v8M12 5h.01" />,
  neutro: <circle cx="12" cy="12" r="3.5" fill="currentColor" />,
};

export function PuceEstado({ tono, children, testId }: PuceEstadoProps) {
  return (
    <span
      data-tono={tono}
      data-testid={testId}
      className={[
        // `leading-normal` et non `leading-none` : le libellé est tronqué (`truncate`, donc
        // `overflow: hidden`), et une ligne de 13 px rognait les jambages (« pagar », vu au rendu).
        "inline-flex h-7 max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold leading-normal",
        TONO_CLASES[tono],
      ].join(" ")}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-3.5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {TRACES[tono]}
      </svg>
      <span className="truncate">{children}</span>
    </span>
  );
}
