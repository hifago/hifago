"use client";

import { Alert, Button } from "@hifago/ui";

export type ActionConfirmationStatus = "success" | "pending";

// Écran de fin de parcours (création/édition, produit et établissement) — jamais un simple toast
// qui s'efface : la distinction admin (déjà publié, définitif) vs partenaire (en attente de
// révision par un admin Hifago) doit rester lisible le temps que l'utilisateur choisit son
// prochain geste. Agnostique du texte — chaque appelant fournit ses propres chaînes selon qui agit
// et création/édition. `contained` adapte seulement le gabarit : `false` remplace un
// wizard/panel plein écran, `true` tient dans l'empreinte d'une carte déjà existante (blocs
// d'édition établissement à bouton explicite, jamais plein écran — les autres blocs de la même
// page restent visibles).
export function ActionConfirmation({
  status,
  title,
  body,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  contained = false,
  testId,
}: {
  status: ActionConfirmationStatus;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  contained?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={
        contained
          ? "flex flex-col gap-4"
          : "flex w-full max-w-xl flex-col items-center gap-4 self-center py-12 text-center"
      }
      data-testid={testId}
    >
      <Alert status={status === "success" ? "success" : "warning"} className={contained ? undefined : "w-full text-left"}>
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{title}</Alert.Title>
          <Alert.Description>{body}</Alert.Description>
        </Alert.Content>
      </Alert>
      <div className={contained ? "flex flex-wrap gap-2" : "flex flex-wrap justify-center gap-2"}>
        <Button type="button" onPress={onAction} data-testid={testId ? `${testId}-action` : undefined}>
          {actionLabel}
        </Button>
        {secondaryActionLabel && onSecondaryAction ? (
          <Button
            type="button"
            variant="outline"
            onPress={onSecondaryAction}
            data-testid={testId ? `${testId}-secondary-action` : undefined}
          >
            {secondaryActionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
