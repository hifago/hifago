"use client";

import { Fragment } from "react";
import { cn } from "@hifago/ui";

// Indicateur d'étape horizontal (pastilles + trait + libellés), partagé par les wizards produit et
// établissement (docs/specs/40). UNE SEULE grille CSS pour pastilles/traits ET libellés — piège
// vérifié en réel sur le prototype : deux grilles séparées auto-dimensionnent leurs colonnes
// indépendamment (largeur de la pastille vs largeur du texte), donc les colonnes ne tombent jamais
// à la même position d'une grille à l'autre, même avec le même gabarit de colonnes déclaré deux
// fois. Ici chaque cellule (pastille/trait/libellé) est placée explicitement par `gridColumn`/
// `gridRow` dans la même grille, donc leurs largeurs de colonne sont calculées une seule fois.
export function WizardStepper({
  titles,
  currentIndex,
  onStepClick,
}: {
  titles: string[];
  currentIndex: number;
  onStepClick: (index: number) => void;
}) {
  const cols: string[] = [];
  titles.forEach((_, index) => {
    cols.push("auto");
    if (index < titles.length - 1) cols.push("1fr");
  });
  const template = cols.join(" ");

  return (
    <div className="flex flex-col gap-2" data-testid="wizard-stepper">
      <div className="grid items-center gap-y-2" style={{ gridTemplateColumns: template }}>
        {titles.map((title, index) => {
          const status = index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";
          const col = index * 2 + 1;
          return (
            <Fragment key={title}>
              <button
                type="button"
                style={{ gridColumn: col, gridRow: 1 }}
                onClick={() => onStepClick(index)}
                disabled={index >= currentIndex}
                aria-current={status === "current" ? "step" : undefined}
                // Nom accessible explicite (2026-10-02) : la pastille n'affiche que « 1 » ou « ✓ », et
                // le titre de l'étape est masqué sous sm (`hidden sm:block` ci-dessous) — un lecteur
                // d'écran n'entendait rien d'autre que le chiffre.
                aria-label={`Paso ${index + 1} de ${titles.length}: ${title}${status === "done" ? " (completado)" : ""}`}
                className={cn(
                  "h-7 w-7 justify-self-center border text-xs font-bold",
                  status === "done" && "cursor-pointer border-foreground bg-foreground text-surface",
                  status === "current" && "border-accent bg-accent text-accent-foreground",
                  status === "upcoming" && "border-default bg-surface text-muted",
                )}
              >
                {status === "done" ? "✓" : index + 1}
              </button>
              <span
                style={{ gridColumn: col, gridRow: 2 }}
                className={cn(
                  "hidden justify-self-center text-center text-xs sm:block",
                  status === "upcoming" ? "text-muted" : "font-medium text-foreground",
                )}
              >
                {title}
              </span>
              {index < titles.length - 1 ? (
                <div
                  style={{ gridColumn: col + 1, gridRow: 1 }}
                  className={cn("h-0.5 w-full", index < currentIndex ? "bg-foreground" : "bg-default")}
                />
              ) : null}
            </Fragment>
          );
        })}
      </div>
      <p className="text-xs font-semibold text-muted sm:hidden">
        Paso {currentIndex + 1} de {titles.length} — <span className="text-foreground">{titles[currentIndex]}</span>
      </p>
    </div>
  );
}
