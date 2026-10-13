"use client";

import { useRouter } from "next/navigation";
import {
  type DataListAction,
  type DataListColumn,
  type DataListRowChange,
  type DataListSort,
  viewAction,
} from "@hifago/ui";
import { createClient } from "@hifago/supabase/client";
import { EditableDataList } from "@/components/editable-data-list";
import { rpcErrorMessage } from "@/lib/errors/rpcErrorMessage";
import { RENAME_REFUSALS, inlineRefusal, saveInlineChanges } from "@/lib/lists/inlineEdit";
import { PartnersFilterBar } from "./PartnersFilterBar";

export type PartnerRow = {
  id: string;
  displayName: string;
  activeRoles: string;
  establishmentsCount: number;
};

export type PartnersTableProps = {
  rows: PartnerRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filterValues: Record<string, string>;
  extraParams: Record<string, string>;
};

// docs/specs/10-listes-standardisees-admin-socio.md §5.3 — pas d'Editar (aucune RPC
// update_partner) ; l'offboarding reste réservé à la fiche détail (/admin/partners/[id]),
// jamais remonté comme action de ligne — même principe que l'absence d'Eliminar sur les listes.
//
// Édition en ligne (demande Jérôme, 2026-10-13) : le nom s'édite dans la cellule
// (admin_rename_partner, première RPC à modifier un partenaire après sa création). « Capacidades
// activas » reste en lecture seule — accorder ou suspendre une capacité est un geste audité, avec
// ses propres règles, sur la fiche du partenaire — et « Establecimientos » est un comptage.
export function PartnersTable({
  rows,
  page,
  pageSize,
  totalCount,
  sort,
  filterValues,
  extraParams,
}: PartnersTableProps) {
  const router = useRouter();

  const columns: DataListColumn<PartnerRow>[] = [
    {
      id: "display_name",
      header: "Nombre",
      sortable: true,
      cell: (row) => row.displayName,
      edit: { value: (row) => row.displayName, editor: { kind: "text" } },
    },
    { id: "activeRoles", header: "Capacidades activas", cell: (row) => row.activeRoles || "—" },
    { id: "establishmentsCount", header: "Establecimientos" },
  ];

  const actions: DataListAction<PartnerRow>[] = [viewAction("/admin/partners", "partner")];

  async function saveRow({ rowId, values }: DataListRowChange<PartnerRow>): Promise<string | null> {
    if (typeof values.display_name !== "string") return null;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("admin_rename_partner", {
      p_partner_id: rowId,
      p_display_name: values.display_name,
    });
    if (error) return rpcErrorMessage(error, "No se pudo guardar el nombre.");
    return inlineRefusal(data, RENAME_REFUSALS, "No se pudo guardar el nombre.");
  }

  return (
    <EditableDataList
      rows={rows}
      getRowId={(row) => row.id}
      columns={columns}
      actions={actions}
      basePath="/admin/partners"
      page={page}
      pageSize={pageSize}
      totalCount={totalCount}
      sort={sort}
      toolbar={<PartnersFilterBar values={filterValues} hiddenParams={{ sort: sort.key, dir: sort.direction }} />}
      extraParams={extraParams}
      ariaLabel="Partners"
      rowTestIdPrefix="partner"
      emptyMessage="Ningún partner todavía."
      emptyTestId="no-partners"
      onSave={async (changes) => {
        const result = await saveInlineChanges(changes, (row) => row.displayName, saveRow);
        router.refresh();
        return result;
      }}
    />
  );
}
