"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Chip, DataList, type DataListAction, type DataListColumn, type DataListSort } from "@hifago/ui";
import { formatCop } from "@hifago/domain";
import { statusChip } from "@/components/status-chip";
import { PRODUCT_TYPE_LABELS } from "@/lib/lists/filters";
import { LEDGER_STATUS_CHIP_STYLE, LEDGER_STATUS_LABELS } from "./ledgerStatusLabels";
import { LedgerFilterBar, type EstablishmentOption, type ReferrerOption } from "./LedgerFilterBar";
import { MarkPaidDialog } from "./MarkPaidDialog";

export type LedgerRow = {
  id: string;
  referrerName: string;
  establishmentName: string;
  productType: string;
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
  referrers: ReferrerOption[];
  establishments: EstablishmentOption[];
};

// Refonte /admin/ledger — remplace le split fixe "Por pagar"/"Historial" par une seule liste
// filtrable/triée/paginée côté serveur (DataList, docs/specs/10-listes-standardisees-admin-socio.md),
// même patron que OrdersTable.tsx/CommissionsTable.tsx. "Establecimiento" est désormais toujours le
// lieu de la prestation (order_line.product.establishment), jamais l'ancien "beneficiaryName" qui ne
// montrait l'établissement que lorsqu'il était le bénéficiaire d'une compensation — changement de
// sens demandé explicitement. Pas de rowHref : aucune fiche détail pour une entrée de ledger, même
// exception assumée que /partner/commissions.
export function LedgerTable({
  rows,
  page,
  pageSize,
  totalCount,
  sort,
  filterValues,
  extraParams,
  referrers,
  establishments,
}: LedgerTableProps) {
  const router = useRouter();
  const [dialogRowId, setDialogRowId] = useState<string | null>(null);

  const columns: DataListColumn<LedgerRow>[] = [
    { id: "referrerName", header: "Referente" },
    { id: "establishmentName", header: "Establecimiento" },
    {
      id: "productType",
      header: "Tipo",
      // Même libellé que la colonne « Tipo » du catálogo (PRODUCT_TYPE_LABELS) — une valeur
      // inconnue s'affiche telle quelle plutôt que de disparaître.
      cell: (row) => (PRODUCT_TYPE_LABELS as Record<string, string>)[row.productType] ?? row.productType,
    },
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
            referrers={referrers}
            establishments={establishments}
          />
        }
        extraParams={extraParams}
        ariaLabel="Ledger de liquidación"
        rowTestIdPrefix="ledger-entry"
        emptyMessage="Ningún registro todavía."
        emptyTestId="no-ledger-entries"
      />

      {dialogRowId ? (
        <MarkPaidDialog
          entryId={dialogRowId}
          open={dialogRowId !== null}
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
