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
import { ESTABLISHMENTS_FILTERS, ESTABLISHMENT_STATUS_LABELS } from "@/lib/lists/filters";
import { RENAME_REFUSALS, inlineRefusal, saveInlineChanges } from "@/lib/lists/inlineEdit";
import { EstablishmentStatusCell, EstablishmentStatusFlags } from "./EstablishmentStatusCell";

export type EstablishmentRow = {
  id: string;
  name: string;
  partnerId: string;
  partnerName: string;
  status: string;
  activitiesCount: number;
  hasSharedResourceProducts: boolean;
  // Revue admin établissements (Jérôme, 2026-08-19) — calculés par list_establishments_admin,
  // rendus par EstablishmentStatusCell dans la cellule "Estado", jamais une nouvelle valeur de
  // establishments.status.
  pendingProposal: { id: string; kind: "edit" | "photos" } | null;
  operatorInactive: boolean;
};

export type EstablishmentsListProps = {
  rows: EstablishmentRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filterValues: Record<string, string>;
  extraParams: Record<string, string>;
};

// docs/specs/10-listes-standardisees-admin-socio.md §5.3 — pas d'Eliminar : aucune RPC de
// suppression/archivage d'établissement n'existe.
//
// Édition en ligne (demande Jérôme, 2026-10-13) : le nom et le statut s'éditent dans la cellule.
// Deux colonnes restent en lecture seule, pour deux raisons différentes :
//   - « Actividades » est un comptage ;
//   - « Partner » se change par transfer_establishment, qui déplace aussi les capacités du
//     propriétaire et ses fiches : ce geste garde son écran et sa confirmation
//     (/admin/partners/[id]), il ne tient pas dans un `select` validé avec le reste de la page.
export function EstablishmentsList({
  rows,
  page,
  pageSize,
  totalCount,
  sort,
  filterValues,
  extraParams,
}: EstablishmentsListProps) {
  const router = useRouter();

  const columns: DataListColumn<EstablishmentRow>[] = [
    {
      id: "name",
      header: "Nombre",
      sortable: true,
      edit: { value: (row) => row.name, editor: { kind: "text" } },
    },
    { id: "partnerName", header: "Partner" },
    {
      id: "status",
      header: "Estado",
      sortable: true,
      cell: (row) => <EstablishmentStatusCell row={row} />,
      edit: {
        value: (row) => row.status,
        editor: {
          kind: "select",
          options: Object.entries(ESTABLISHMENT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
        },
        // Un statut hors du vocabulaire du `select` reste affiché tel quel, jamais écrasé par mégarde.
        isEditable: (row) => Object.hasOwn(ESTABLISHMENT_STATUS_LABELS, row.status),
        adornment: (row) => <EstablishmentStatusFlags row={row} />,
      },
    },
    {
      id: "activitiesCount",
      header: "Actividades",
      cell: (row) => (
        <a href={`/admin/establishments/${row.id}`} className="hover:underline" data-testid={`activity-count-${row.id}`}>
          {row.activitiesCount} actividades
        </a>
      ),
    },
  ];

  const actions: DataListAction<EstablishmentRow>[] = [
    viewAction("/admin/establishments", "establishment", "Editar"),
    {
      id: "add-activity",
      label: "+ Actividad",
      href: (row) => `/admin/products/new?establishment=${row.id}`,
      testId: (row) => `add-activity-link-${row.id}`,
    },
    {
      id: "resource",
      label: "Recurso compartido",
      href: (row) => `/admin/establishments/${row.id}/resource`,
      testId: (row) => `resource-link-${row.id}`,
      // Spec 17 §0 Tranche 0 — la ressource partagée n'a de sens que pour un établissement qui
      // porte au moins un camp/evento (seuls types câblés sur provider_resource_calendar) ; masqué
      // sinon, plutôt qu'un lien vers un écran vide sans rapport avec l'établissement.
      isVisible: (row) => row.hasSharedResourceProducts,
    },
  ];

  // Deux RPC, une par cellule : le nom (admin_rename_establishment) puis le statut
  // (set_establishment_status), chacune avec sa ligne d'audit. Si la seconde échoue, la première
  // reste écrite — au rafraîchissement, seule la cellule en échec est encore marquée modifiée.
  async function saveRow({ rowId, values }: DataListRowChange<EstablishmentRow>): Promise<string | null> {
    const supabase = createClient();
    if (typeof values.name === "string") {
      const { data, error } = await supabase.rpc("admin_rename_establishment", {
        p_establishment_id: rowId,
        p_name_es: values.name,
      });
      if (error) return rpcErrorMessage(error, "No se pudo guardar el nombre.");
      const refusal = inlineRefusal(data, RENAME_REFUSALS, "No se pudo guardar el nombre.");
      if (refusal) return refusal;
    }
    if (typeof values.status === "string") {
      const { error } = await supabase.rpc("set_establishment_status", {
        p_establishment_id: rowId,
        p_status: values.status,
      });
      if (error) return rpcErrorMessage(error, "No se pudo cambiar el estado.");
    }
    return null;
  }

  return (
    <EditableDataList
      rows={rows}
      getRowId={(row) => row.id}
      columns={columns}
      actions={actions}
      basePath="/admin/establishments"
      page={page}
      pageSize={pageSize}
      totalCount={totalCount}
      sort={sort}
      filters={ESTABLISHMENTS_FILTERS}
      filterValues={filterValues}
      extraParams={extraParams}
      ariaLabel="Establecimientos"
      rowTestIdPrefix="establishment"
      emptyMessage="Ningún establecimiento todavía."
      emptyTestId="no-establishments"
      onSave={async (changes) => {
        const result = await saveInlineChanges(changes, (row) => row.name, saveRow);
        router.refresh();
        return result;
      }}
    />
  );
}
