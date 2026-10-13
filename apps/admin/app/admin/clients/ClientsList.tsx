"use client";

import { DataList, type DataListColumn, type DataListSort, viewAction } from "@hifago/ui";
import { StatusChip } from "@/components/status-chip";
import { CLIENTS_FILTERS, CLIENT_STAGE_CHIP_STYLE, CLIENT_STAGE_LABELS } from "@/lib/lists/filters";
import { formatDateInBogota } from "@hifago/domain";

export type ClientRow = {
  id: string; // encodeURIComponent(client_key) — jamais le client_key brut, cf. page.tsx
  name: string;
  email: string | null;
  phone: string | null;
  stage: string | null; // null si le client n'a plus aucune order_line non-superseded (edge case rare)
  ordersCount: number;
  lastOrderAt: string | null;
};

export type ClientsListProps = {
  rows: ClientRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filterValues: Record<string, string>;
  extraParams: Record<string, string>;
};

export function ClientsList({
  rows,
  page,
  pageSize,
  totalCount,
  sort,
  filterValues,
  extraParams,
}: ClientsListProps) {
  const columns: DataListColumn<ClientRow>[] = [
    { id: "name", header: "Nombre", sortable: true, className: "md:whitespace-normal md:[overflow-wrap:anywhere]" },
    {
      id: "email",
      header: "Email",
      cell: (row) => row.email ?? "—",
      className: "md:whitespace-normal md:[overflow-wrap:anywhere]",
    },
    { id: "phone", header: "Teléfono", cell: (row) => row.phone ?? "—" },
    {
      id: "stage",
      header: "Estado",
      cell: (row) =>
        row.stage ? (
          <StatusChip
            status={row.stage}
            map={CLIENT_STAGE_CHIP_STYLE}
            labels={CLIENT_STAGE_LABELS}
            testId={`client-stage-${row.id}`}
          />
        ) : (
          "—"
        ),
    },
    { id: "ordersCount", header: "Pedidos", sortable: true },
    {
      id: "lastOrderAt",
      header: "Último pedido",
      sortable: true,
      cell: (row) => (row.lastOrderAt ? formatDateInBogota(row.lastOrderAt, "es") : "—"),
    },
  ];

  return (
    <DataList
      rows={rows}
      getRowId={(row) => row.id}
      columns={columns}
      actions={[viewAction("/admin/clients", "client", "Ver detalle")]}
      basePath="/admin/clients"
      page={page}
      pageSize={pageSize}
      totalCount={totalCount}
      sort={sort}
      filters={CLIENTS_FILTERS}
      filterValues={filterValues}
      extraParams={extraParams}
      ariaLabel="Clientes"
      rowTestIdPrefix="client"
      emptyMessage="Ningún cliente todavía."
      emptyTestId="no-clients"
    />
  );
}
