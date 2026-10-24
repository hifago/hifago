"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Chip, DataList, type DataListAction, type DataListColumn, type DataListSort } from "@hifago/ui";
import { displayLineStatus, formatCop, type OrderPaymentState } from "@hifago/domain";
import { StatusChip } from "@/components/status-chip";
import {
  lineStatusChipColor,
  lineStatusLabel,
  PAYMENT_STATE_CHIP_STYLE,
  PAYMENT_STATE_LABELS,
} from "@/lib/orders/paymentDisplayLabels";
import { ChangeStatusDialog } from "./ChangeStatusDialog";
import { ModifyOrderLineDialog } from "@/components/ModifyOrderLineDialog";
import { ORDERS_FILTERS } from "@/lib/lists/filters";

export type OrderLineRow = {
  id: string;
  orderId: string;
  date: string;
  endDate: string | null;
  qty: number;
  status: string;
  /** Le paiement de la commande de la ligne ; `null` si illisible (la ligne garde alors son statut brut). */
  paymentState: OrderPaymentState | null;
  productName: string;
  establishmentName: string;
  holderName: string;
  holderPhone: string | null;
  referrerName: string;
  amount: number;
};

export type OrdersTableProps = {
  rows: OrderLineRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filterValues: Record<string, string>;
  extraParams: Record<string, string>;
};

// docs/specs/10-listes-standardisees-admin-socio.md §5.3 — écran pilote : pagination ET tri
// désormais tous les deux servis par DataList (manualSorting/manualPagination), plus de repli
// client. Colonnes embarquées (Producto/Establecimiento/Titular/Referente) restent non triables —
// un tri serveur ne peut pas les produire (cf. DataListColumn.sortable, jamais activé ici).
export function OrdersTable({
  rows,
  page,
  pageSize,
  totalCount,
  sort,
  filterValues,
  extraParams,
}: OrdersTableProps) {
  const router = useRouter();
  const [dialogRowId, setDialogRowId] = useState<string | null>(null);
  const [modifyRowId, setModifyRowId] = useState<string | null>(null);
  const modifyRow = rows.find((row) => row.id === modifyRowId) ?? null;

  const columns: DataListColumn<OrderLineRow>[] = [
    { id: "date", header: "Fecha", sortable: true },
    { id: "productName", header: "Producto" },
    { id: "establishmentName", header: "Establecimiento" },
    { id: "qty", header: "Cantidad", sortable: true },
    {
      id: "status",
      header: "Estado",
      sortable: true,
      // `reserved` tient la place pendant le paiement : d'une commande qui attend son paiement, elle
      // s'affiche « Pendiente de pago », jamais « Reservada ». Le STATUT stocké (filtre, tri, changement
      // de statut) n'est pas touché.
      cell: (row) => {
        const shown = row.paymentState ? displayLineStatus(row.status, row.paymentState) : row.status;
        return (
          <Chip variant="soft" color={lineStatusChipColor(shown)} data-testid={`status-badge-${row.id}`}>
            {lineStatusLabel(shown)}
          </Chip>
        );
      },
    },
    // Le paiement de la commande, à côté du statut de ligne : deux choses distinctes.
    {
      id: "paymentState",
      header: "Pago",
      cell: (row) =>
        row.paymentState ? (
          <StatusChip
            status={row.paymentState}
            map={PAYMENT_STATE_CHIP_STYLE}
            labels={PAYMENT_STATE_LABELS}
            testId={`payment-badge-${row.id}`}
          />
        ) : (
          "—"
        ),
    },
    {
      id: "holder",
      header: "Titular",
      cell: (row) => (
        <div className="flex flex-col">
          <span>{row.holderName}</span>
          <span className="text-xs text-muted">{row.holderPhone ?? "—"}</span>
        </div>
      ),
    },
    // Première fois que referrer_partner_id (feature 7) est réellement affiché — "Directo" sinon.
    { id: "referrerName", header: "Referente" },
    {
      id: "total_cop",
      header: "Monto",
      sortable: true,
      align: "right",
      cell: (row) => formatCop(row.amount),
    },
  ];

  const actions: DataListAction<OrderLineRow>[] = [
    {
      id: "view",
      label: "Ver pedido",
      href: (row) => `/admin/orders/${row.orderId}`,
      testId: (row) => `view-order-link-${row.orderId}`,
    },
    {
      id: "change-status",
      label: "Cambiar estado",
      render: (row) => (
        <Button
          size="sm"
          variant="outline"
          data-testid={`change-status-button-${row.id}`}
          onPress={() => setDialogRowId(row.id)}
        >
          Cambiar estado
        </Button>
      ),
    },
    {
      id: "modify",
      label: "Modificar",
      // Spec 17 §0 Tranche 1 — modify_order_line n'accepte qu'une ligne au statut reserved
      // (raise exception sinon) : masqué plutôt que de proposer un geste voué à l'échec.
      isVisible: (row) => row.status === "reserved",
      render: (row) => (
        <Button
          size="sm"
          variant="outline"
          data-testid={`modify-button-${row.id}`}
          onPress={() => setModifyRowId(row.id)}
        >
          Modificar
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
        rowHref={(row) => `/admin/orders/${row.orderId}`}
        basePath="/admin/orders"
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        sort={sort}
        filters={ORDERS_FILTERS}
        filterValues={filterValues}
        extraParams={extraParams}
        ariaLabel="Pedidos"
        rowTestIdPrefix="order-line"
        emptyMessage="Ningún pedido todavía."
        emptyTestId="no-orders"
      />

      {dialogRowId ? (
        <ChangeStatusDialog
          orderLineId={dialogRowId}
          open={dialogRowId !== null}
          onOpenChange={(open) => {
            if (!open) setDialogRowId(null);
          }}
          onSuccess={() => {
            // `rows` dérive du serveur (page + tri + filtres) — un vrai refetch de la page
            // courante reste correct même si le nouveau statut sort la ligne du filtre actif.
            setDialogRowId(null);
            router.refresh();
          }}
        />
      ) : null}

      {modifyRow ? (
        <ModifyOrderLineDialog
          orderLineId={modifyRow.id}
          initialDate={modifyRow.date}
          initialEndDate={modifyRow.endDate}
          initialQty={modifyRow.qty}
          open={modifyRowId !== null}
          onOpenChange={(open) => {
            if (!open) setModifyRowId(null);
          }}
          onSuccess={() => {
            // La ligne d'origine passe superseded (sort du filtre "reserved" par défaut) et une
            // nouvelle ligne apparaît — même raisonnement que ChangeStatusDialog, un vrai refetch.
            setModifyRowId(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
