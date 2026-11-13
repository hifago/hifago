"use client";

import { Chip, DataList, type DataListAction, type DataListColumn, type DataListSort } from "@hifago/ui";
import { formatCop } from "@hifago/domain";
import { ContactClientButton } from "@/components/ContactClientButton";
import { STATUS_LABELS, STATUS_CHIP_COLOR } from "@/app/admin/orders/statusLabels";
import { ReservationsFilterBar, type ReservationProductOption } from "./ReservationsFilterBar";

export type ReservationRow = {
  id: string;
  date: string;
  productName: string;
  establishmentName: string;
  holderName: string;
  holderPhone: string | null;
  holderEmail: string | null;
  qty: number;
  totalCop: number;
  status: string;
  // Le client a laissé une note au paiement (migration 20261112170000) — un repère, le texte est sur
  // la fiche.
  hasClientNote: boolean;
};

export type ReservationsTableProps = {
  rows: ReservationRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filterValues: Record<string, string>;
  extraParams: Record<string, string>;
  products: ReservationProductOption[];
};

// Spec 17 §0 Tranche 1 (« Mis Reservas », v1) — restaurée puis étendue lors de la refonte vue
// prestataire (2026-08-19) : migration de SortablePaginatedTable (client-side, sans filtre, 100
// lignes max) vers DataList (pagination/tri serveur, filtres date/activité/nom/email, reflow mobile
// natif via data-label) — même patron que OrdersTable.tsx (admin/orders), écran pilote de la spec
// 10. rowTestIdPrefix reste "reservation" (convention historique de cet écran, préservée pour l'e2e
// existant qui cible `reservation-status-*` par préfixe).
//
// Retour Jérôme (2026-08-20) — "Cliente no vino"/"Cancelar" retirés de la LISTE (restent sur la
// fiche détail, ReservationActions.tsx, déjà en place : detail-no-show-button/detail-cancel-button)
// — un changement d'état passe désormais toujours par la fiche, jamais une action de ligne rapide.
export function ReservationsTable({
  rows,
  page,
  pageSize,
  totalCount,
  sort,
  filterValues,
  extraParams,
  products,
}: ReservationsTableProps) {
  const columns: DataListColumn<ReservationRow>[] = [
    { id: "date", header: "Fecha", sortable: true },
    { id: "productName", header: "Actividad" },
    { id: "establishmentName", header: "Establecimiento" },
    {
      id: "holder",
      header: "Cliente",
      cell: (row) => (
        <div className="flex flex-col">
          <span>{row.holderName}</span>
          <span className="text-xs text-muted">{row.holderPhone ?? "—"}</span>
          {row.hasClientNote ? (
            <span className="text-xs font-medium text-foreground" data-testid={`reservation-note-${row.id}`}>
              Nota del cliente
            </span>
          ) : null}
        </div>
      ),
    },
    { id: "qty", header: "Cant.", sortable: true },
    {
      id: "status",
      header: "Estado",
      sortable: true,
      cell: (row) => (
        <Chip
          variant="soft"
          color={STATUS_CHIP_COLOR[row.status] ?? "default"}
          data-testid={`reservation-status-${row.id}`}
        >
          {STATUS_LABELS[row.status] ?? row.status}
        </Chip>
      ),
    },
    {
      id: "total_cop",
      header: "Monto",
      sortable: true,
      align: "right",
      cell: (row) => formatCop(row.totalCop),
    },
  ];

  const actions: DataListAction<ReservationRow>[] = [
    {
      id: "view",
      label: "Ver ficha",
      href: (row) => `/partner/reservations/${row.id}`,
      testId: (row) => `view-reservation-link-${row.id}`,
    },
    {
      id: "contact",
      label: "Contactar",
      render: (row) => (
        <ContactClientButton
          holderName={row.holderName}
          holderPhone={row.holderPhone}
          holderEmail={row.holderEmail}
        />
      ),
    },
  ];

  return (
    <DataList
      rows={rows}
      getRowId={(row) => row.id}
      columns={columns}
      actions={actions}
      rowHref={(row) => `/partner/reservations/${row.id}`}
      basePath="/partner/reservations"
      page={page}
      pageSize={pageSize}
      totalCount={totalCount}
      sort={sort}
      toolbar={<ReservationsFilterBar values={filterValues} hiddenParams={{ sort: sort.key, dir: sort.direction }} products={products} />}
      extraParams={extraParams}
      ariaLabel="Mis reservas"
      rowTestIdPrefix="reservation"
      emptyMessage="Ninguna reserva todavía."
      emptyTestId="no-reservations"
    />
  );
}
