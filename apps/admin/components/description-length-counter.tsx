"use client";

import { cn } from "@hifago/ui";
import { ESTABLISHMENT_DESCRIPTION_MAX, descriptionLength } from "@/lib/establishments/descriptionLimit";

// Compteur affiché sous la description d'un établissement (lib/establishments/descriptionLimit.ts).
// Le dépassement est dit en toutes lettres, pas seulement par la couleur.
export function DescriptionLengthCounter({ value, testId }: { value: string; testId?: string }) {
  const length = descriptionLength(value);
  const isOver = length > ESTABLISHMENT_DESCRIPTION_MAX;
  return (
    <p
      data-testid={testId}
      aria-live="polite"
      className={cn("text-right text-xs", isOver ? "font-medium text-danger" : "text-muted")}
    >
      {length}/{ESTABLISHMENT_DESCRIPTION_MAX} caracteres
      {isOver ? ` — máximo ${ESTABLISHMENT_DESCRIPTION_MAX}` : ""}
    </p>
  );
}
