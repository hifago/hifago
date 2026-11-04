"use client";

import { Alert } from "@hifago/ui";

// Migration 20261104130000 — le motif d'un refus, là où la proposition se corrige (portail
// partenaire) et là où la correction se relit (modération admin). Fichier client : les pages qui
// l'affichent sont des Server Components.
export function RejectionNotice({
  title,
  reason,
  children,
  testId = "rejection-notice",
}: {
  title: string;
  reason: string | null;
  children?: React.ReactNode;
  testId?: string;
}) {
  return (
    <Alert status="danger" data-testid={testId}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        <Alert.Description>
          {reason ? (
            <>
              Motivo: <span data-testid={`${testId}-reason`}>{reason}</span>
            </>
          ) : null}
          {children ? <span className="mt-1 block">{children}</span> : null}
        </Alert.Description>
      </Alert.Content>
    </Alert>
  );
}
