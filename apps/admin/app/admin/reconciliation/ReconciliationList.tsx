"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, Card, Chip } from "@hifago/ui";
import { statusChip, type ChipStyle } from "@/components/status-chip";
import { ResolveEntryDialog } from "./ResolveEntryDialog";
import { ResolvePmsRequestDialog, type PmsRequestAction } from "./ResolvePmsRequestDialog";

export type ReconciliationEntryRow = {
  id: string;
  status: string;
  attempts: number;
  /** Motif machine de l'échec (statut + corps LobbyPMS). `null` sur les entrées d'avant 2026-08-27. */
  detail: string | null;
  orderId: string;
  /** La ligne de la commande que l'entrée concerne (id de booking saisi à la main, confirm). */
  orderLineId: string;
  holderName: string;
  establishmentName: string;
  /**
   * Lobby APRÈS l'acompte : la demande de booking de la commande, quand elle est BLOQUÉE (`failed` ou
   * `needs_human`) — seule situation où l'admin dispose de « Reintentar / Confirmar / Anular ». Absente
   * (null) pour toute autre entrée.
   */
  pmsRequest: { id: string; status: string } | null;
};

// Vocabulaire de la feature 22 (check constraint pms_reconciliation_entries.status) — "resolved"
// n'apparaît dans aucun des deux groupes affichés (ni actionnable ni échec permanent) : une entrée
// résolue sort silencieusement de la file, cf. plan feature 22.
const STATUS_LABELS: Record<string, string> = {
  open: "Abierta",
  retrying: "Reintentando",
  resolved: "Resuelta",
  permanently_failed: "Fallo permanente",
};

const STATUS_CHIP_STYLE: Record<string, ChipStyle> = {
  open: { color: "accent", variant: "primary" },
  retrying: { color: "warning", variant: "soft" },
  resolved: { color: "success", variant: "soft" },
  permanently_failed: { color: "danger", variant: "primary" },
};

const PMS_REQUEST_ACTIONS: { action: PmsRequestAction; label: string }[] = [
  { action: "retry", label: "Reintentar con Lobby" },
  { action: "confirm", label: "Confirmar" },
  { action: "cancel", label: "Anular solicitud" },
];

function EntryCard({
  entry,
  onResolveClick,
  onPmsRequestClick,
}: {
  entry: ReconciliationEntryRow;
  onResolveClick?: (entryId: string) => void;
  onPmsRequestClick?: (entryId: string, action: PmsRequestAction) => void;
}) {
  const chipStyle = statusChip(STATUS_CHIP_STYLE, entry.status);

  return (
    <div
      data-testid="reconciliation-entry"
      className="flex flex-col gap-2 rounded-lg border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <Link href={`/admin/orders/${entry.orderId}`} className="font-medium hover:underline">
          {entry.holderName}
        </Link>
        <p className="text-sm text-muted">
          {entry.establishmentName} · {entry.attempts} intento{entry.attempts === 1 ? "" : "s"}
        </p>
        {/* Le motif de l'échec (2026-08-27). Sans lui, cet écran demandait à un admin d'enquêter
            sans lui donner le seul élément que la machine avait sous les yeux — la réponse de
            LobbyPMS. `null` sur les entrées créées avant l'ajout de la colonne : on n'affiche alors
            rien, plutôt qu'une ligne vide qui laisserait croire à une absence de motif. */}
        {entry.detail ? (
          <p className="text-xs text-muted break-all" data-testid="reconciliation-entry-detail">
            {entry.detail}
          </p>
        ) : null}
      </div>
      {/* Responsive : les boutons passent à la ligne sous 390 px au lieu de déborder. */}
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <Chip color={chipStyle.color} variant={chipStyle.variant}>
          {STATUS_LABELS[entry.status] ?? entry.status}
        </Chip>
        {onPmsRequestClick && entry.pmsRequest
          ? PMS_REQUEST_ACTIONS.map(({ action, label }) => (
              <Button
                key={action}
                size="sm"
                variant={action === "confirm" ? "primary" : "outline"}
                data-testid={`pms-request-${action}-button`}
                onPress={() => onPmsRequestClick(entry.id, action)}
              >
                {label}
              </Button>
            ))
          : null}
        {onResolveClick ? (
          <Button
            size="sm"
            variant="outline"
            data-testid="resolve-entry-button"
            onPress={() => onResolveClick(entry.id)}
          >
            Resolver
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ReconciliationList({ rows: initialRows }: { rows: ReconciliationEntryRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [dialogEntryId, setDialogEntryId] = useState<string | null>(null);
  const [pmsDialog, setPmsDialog] = useState<{ entryId: string; action: PmsRequestAction } | null>(null);

  // open/retrying = actionnable (un admin peut résolver) ; permanently_failed = échec permanent
  // (transition système, jamais un geste admin, cf. plan feature 22 — donc aucun bouton dessus).
  const actionableEntries = useMemo(
    () => rows.filter((row) => row.status === "open" || row.status === "retrying"),
    [rows]
  );
  const failedEntries = useMemo(
    () => rows.filter((row) => row.status === "permanently_failed"),
    [rows]
  );

  return (
    <div className="flex flex-col gap-6">
      <Card data-testid="reconciliation-actionable-group">
        <Card.Header>
          <Card.Title>Por resolver</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          {actionableEntries.length > 0 ? (
            actionableEntries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                onResolveClick={setDialogEntryId}
                onPmsRequestClick={(entryId, action) => setPmsDialog({ entryId, action })}
              />
            ))
          ) : (
            <p className="text-sm text-muted">Ninguna entrada por resolver.</p>
          )}
        </Card.Content>
      </Card>

      <Card data-testid="reconciliation-failed-group">
        <Card.Header>
          <Card.Title>Fallo permanente</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          {failedEntries.length > 0 ? (
            failedEntries.map((entry) => <EntryCard key={entry.id} entry={entry} />)
          ) : (
            <p className="text-sm text-muted">Ninguna entrada en fallo permanente.</p>
          )}
        </Card.Content>
      </Card>

      {dialogEntryId ? (
        <ResolveEntryDialog
          entryId={dialogEntryId}
          open={dialogEntryId !== null}
          onOpenChange={(open) => {
            if (!open) setDialogEntryId(null);
          }}
          onSuccess={() => {
            // Même mécanisme que ChangeStatusDialog (feature 10) : mise à jour de l'état local, pas
            // de router.refresh(). Une fois "resolved", l'entrée ne correspond plus au filtre
            // actionnable et sort donc silencieusement des deux groupes affichés.
            const resolvedId = dialogEntryId;
            setRows((prev) =>
              prev.map((row) => (row.id === resolvedId ? { ...row, status: "resolved" } : row))
            );
          }}
        />
      ) : null}

      {pmsDialog
        ? (() => {
            const target = rows.find((row) => row.id === pmsDialog.entryId);
            if (!target?.pmsRequest) return null;
            return (
              <ResolvePmsRequestDialog
                requestId={target.pmsRequest.id}
                orderLineId={target.orderLineId}
                action={pmsDialog.action}
                open
                onOpenChange={(open) => {
                  if (!open) setPmsDialog(null);
                }}
                onSuccess={(action) => {
                  // La demande n'est plus bloquée : plus de boutons sur AUCUNE entrée de cette commande.
                  // `confirm` et `cancel` résolvent aussi les entrées de la commande (côté base) : elles
                  // sortent de la file, comme après « Resolver ».
                  const orderId = target.orderId;
                  setRows((prev) =>
                    prev.map((row) =>
                      row.orderId !== orderId
                        ? row
                        : {
                            ...row,
                            pmsRequest: null,
                            status: action === "retry" || row.status === "permanently_failed" ? row.status : "resolved",
                          }
                    )
                  );
                }}
              />
            );
          })()
        : null}
    </div>
  );
}
