"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Chip, DataList, type DataListAction, type DataListColumn, type DataListSort } from "@hifago/ui";
import { formatCop } from "@hifago/domain";
import { statusChip } from "@/components/status-chip";
import { LEDGER_STATUS_CHIP_STYLE, LEDGER_STATUS_LABELS } from "./ledgerStatusLabels";
import { LedgerFilterBar, type BeneficiaryOption, type EstablishmentOption } from "./LedgerFilterBar";
import { MarkPaidDialog } from "./MarkPaidDialog";

export type LedgerRow = {
  id: string;
  // Le partenaire à qui l'argent part : le référent (commission, auto-recomendación comprise) ou
  // le partenaire de l'établissement (compensation d'annulation) — 20261112190000.
  beneficiaryName: string;
  concept: string;
  /** Frais Mercado Pago retenus (option 17 %, 20261112200000), ou null. */
  feeNote: string | null;
  orderId: string;
  orderReference: string;
  establishmentName: string;
  date: string;
  status: string;
  amountCop: number;
};

export type LedgerTableProps = {
  rows: LedgerRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filterValues: Record<string, string>;
  extraParams: Record<string, string>;
  beneficiaries: BeneficiaryOption[];
  establishments: EstablishmentOption[];
};

// Refonte /admin/ledger — remplace le split fixe "Por pagar"/"Historial" par une seule liste
// filtrable/triée/paginée côté serveur (DataList, docs/specs/10-listes-standardisees-admin-socio.md),
// même patron que OrdersTable.tsx/CommissionsTable.tsx. "Establecimiento" est désormais toujours le
// lieu de la prestation (order_line.product.establishment), jamais l'ancien "beneficiaryName" qui ne
// montrait l'établissement que lorsqu'il était le bénéficiaire d'une compensation — changement de
// sens demandé explicitement. Pas de rowHref : aucune fiche détail pour une entrée de ledger, même
// exception assumée que /partner/commissions. Révision 20261112190000 : « Referente » devient
// « Beneficiario » (une compensation affichait « — »), et chaque entrée dit ce qu'elle paie
// (« Concepto ») et de quelle commande elle vient (« Pedido », lien vers la fiche).
export function LedgerTable({
  rows,
  page,
  pageSize,
  totalCount,
  sort,
  filterValues,
  extraParams,
  beneficiaries,
  establishments,
}: LedgerTableProps) {
  const router = useRouter();
  const [dialogRowId, setDialogRowId] = useState<string | null>(null);
  const dialogRow = rows.find((row) => row.id === dialogRowId) ?? null;

  const columns: DataListColumn<LedgerRow>[] = [
    // Qui, puis pourquoi, dans la même cellule : une colonne « Concepto » à part faisait déborder la
    // table de 38 px à 1280 px (mesuré au rendu réel, 2026-11-12).
    {
      id: "beneficiaryName",
      header: "Beneficiario",
      cell: (row) => (
        <span className="flex flex-col items-end text-right md:items-start md:text-left">
          <span>{row.beneficiaryName}</span>
          <span className="text-xs text-muted" data-testid={`ledger-concept-${row.id}`}>
            {row.concept}
          </span>
          {row.feeNote ? (
            <span className="text-xs text-muted" data-testid={`ledger-fee-${row.id}`}>
              {row.feeNote}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "orderReference",
      header: "Pedido",
      cell: (row) => (
        <Link
          href={`/admin/orders/${row.orderId}`}
          className="underline"
          data-testid={`ledger-order-${row.id}`}
        >
          {row.orderReference}
        </Link>
      ),
    },
    // « Tipo » retiré le 2026-11-12 (20261112190000) : avec le concept et Pedido, la table débordait
    // de sa zone à 1280 px et rognait « Marcar pagado ». Le filtre « Tipo » reste.
    { id: "establishmentName", header: "Establecimiento" },
    { id: "date", header: "Fecha" },
    {
      id: "status",
      header: "Estado",
      sortable: true,
      cell: (row) => {
        const chipStyle = statusChip(LEDGER_STATUS_CHIP_STYLE, row.status);
        return (
          <Chip color={chipStyle.color} variant={chipStyle.variant} data-testid={`ledger-status-${row.id}`}>
            {LEDGER_STATUS_LABELS[row.status] ?? row.status}
          </Chip>
        );
      },
    },
    {
      id: "amountCop",
      header: "Monto",
      align: "right",
      sortable: true,
      cell: (row) => formatCop(row.amountCop),
    },
  ];

  // Marcar pagado : seule action, visible uniquement sur une ligne "due" (mark_ledger_entry_paid
  // refuse tout autre statut, spec 19 §0) — même RPC/dialogue qu'avant, juste déplacé dans la
  // colonne action DataList.
  const actions: DataListAction<LedgerRow>[] = [
    {
      id: "mark-paid",
      label: "Marcar pagado",
      isVisible: (row) => row.status === "due",
      render: (row) => (
        <Button
          size="sm"
          variant="outline"
          data-testid={`mark-paid-button-${row.id}`}
          onPress={() => setDialogRowId(row.id)}
        >
          Marcar pagado
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataList
        rows={rows}
        getRowId={(row) => row.id}
        columns={columns}
        actions={actions}
        basePath="/admin/ledger"
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        sort={sort}
        toolbar={
          <LedgerFilterBar
            values={filterValues}
            hiddenParams={{ sort: sort.key, dir: sort.direction }}
            beneficiaries={beneficiaries}
            establishments={establishments}
          />
        }
        extraParams={extraParams}
        ariaLabel="Ledger de liquidación"
        rowTestIdPrefix="ledger-entry"
        emptyMessage="Ningún registro todavía."
        emptyTestId="no-ledger-entries"
      />

      {dialogRow ? (
        <MarkPaidDialog
          entryId={dialogRow.id}
          summary={`${formatCop(dialogRow.amountCop)} a ${dialogRow.beneficiaryName} — ${dialogRow.concept}${dialogRow.feeNote ? ` (${dialogRow.feeNote})` : ""}, pedido ${dialogRow.orderReference}.`}
          open={dialogRow !== null}
          onOpenChange={(open) => {
            if (!open) setDialogRowId(null);
          }}
          onSuccess={() => {
            // rows dérive du serveur (page + tri + filtres) — un vrai refetch reste correct même
            // si l'entrée sort du filtre "due" actif, même raisonnement que ChangeStatusDialog.
            setDialogRowId(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
