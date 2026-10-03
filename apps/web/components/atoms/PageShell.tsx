import type { ReactNode } from "react";

// La coquille publique rend l'unique <main> de la page. Elle n'importe volontairement rien de
// `@hifago/ui` : elle est consommée directement par des Server Components.
export type PageShellProps = {
  children: ReactNode;
  /** `portada` pour l'accueil ; `pagina` pour toutes les pages intérieures. */
  variant: "portada" | "pagina";
  /** Déclare la surface or et permet au CSS de propager ce fond au document. */
  fondo?: "acento";
  testId?: string;
};

const VARIANT_CLASSES: Record<PageShellProps["variant"], string> = {
  // L'accueil dessine lui-même ses colonnes : aucun padding ni largeur ici.
  portada: "flex w-full flex-1 flex-col",
  // Colonne unique du site, alignée sur COLUMNA_PORTADA. Les enfants `data-bleed` peuvent sortir
  // de la colonne centrale sans unité vw, donc sans débordement horizontal.
  pagina:
    "grid w-full flex-1 content-start gap-y-6 pb-12 grid-cols-[1fr_min(60rem,100%_-_2.5rem)_1fr] sm:grid-cols-[1fr_min(60rem,100%_-_4rem)_1fr] [&>*:not([data-bleed])]:col-start-2",
};

// Colonne commune du héros, des sections d'accueil, du header et du pied de page.
export const COLUMNA_PORTADA = "mx-auto w-full max-w-5xl px-5 sm:px-8";

export function PageShell({ children, variant, fondo, testId }: PageShellProps) {
  return (
    <main
      className={VARIANT_CLASSES[variant]}
      data-fondo={fondo}
      data-superficie={fondo === "acento" ? "or" : undefined}
      data-testid={testId}
    >
      {children}
    </main>
  );
}
