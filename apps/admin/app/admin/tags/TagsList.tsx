"use client";

import { useRouter } from "next/navigation";
import { type DataListAction, type DataListColumn, type DataListRowChange, type DataListSort } from "@hifago/ui";
import { EditableDataList } from "@/components/editable-data-list";
import { RenameTagButton } from "./RenameTagButton";
import { TAGS_FILTERS } from "@/lib/lists/filters";
import { saveInlineChanges } from "@/lib/lists/inlineEdit";
import { renameCatalogTag } from "@/lib/tags/editCatalogTag";
import { formatDateInBogota } from "@hifago/domain";

export type TagRow = {
  id: string;
  label: string;
  labelTranslations: Record<string, string>;
  usageCount: number;
  createdAt: string;
};

export type TagsListProps = {
  rows: TagRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filterValues: Record<string, string>;
  extraParams: Record<string, string>;
};

// docs/specs/10-listes-standardisees-admin-socio.md §5.3 — pas d'Eliminar sur la liste (décision
// Jérôme) : DeleteTagButton reste exclusivement sur la fiche /admin/tags/[id] (qui, elle, supprime
// bien la étiquette de TOUTES les activités — product_tag_assignments.tag_id est en
// "on delete cascade", vérifié empiriquement contre l'instance locale).
// Revue admin étiquettes (Jérôme, 2026-08-20) — "Ver" ne pointe plus vers /admin/tags/[id] : il
// envoie directement au catalogue filtré par ce tag (?tag_id=). Un 1er essai avait laissé la fiche
// détail atteignable UNIQUEMENT via le lien "furtif" par défaut de la ligne (rowHref) — invisible,
// donc Eliminar était de facto injoignable pour Jérôme. Corrigé : action "Detalle" explicite
// ci-dessous, seul chemin visible vers Eliminar désormais (le clic sur la ligne reste un raccourci
// silencieux vers la même page, jamais retiré, mais plus le seul).
//
// Édition en ligne (demande Jérôme, 2026-10-13) : le libellé s'édite dans sa cellule. « Actividades »
// (un comptage) et « Creada » (une date posée par la base) restent en lecture seule : ce ne sont
// pas des champs. Même écriture que RenameTagButton (lib/tags/editCatalogTag.ts) : libellé + slug
// recalculé, mêmes refus, seule la clé `es` change.
export function TagsList({
  rows,
  page,
  pageSize,
  totalCount,
  sort,
  filterValues,
  extraParams,
}: TagsListProps) {
  const router = useRouter();

  const columns: DataListColumn<TagRow>[] = [
    {
      id: "label",
      header: "Etiqueta",
      sortable: true,
      edit: { value: (row) => row.label, editor: { kind: "text" } },
    },
    { id: "usageCount", header: "Actividades" },
    {
      id: "created_at",
      header: "Creada",
      sortable: true,
      cell: (row) => formatDateInBogota(row.createdAt, "es"),
    },
  ];

  const actions: DataListAction<TagRow>[] = [
    {
      id: "view",
      label: "Ver",
      href: (row) => `/admin/products?tag_id=${row.id}`,
      testId: (row) => `tag-catalog-link-${row.id}`,
    },
    {
      id: "edit",
      label: "Editar",
      render: (row) => <RenameTagButton tagId={row.id} currentLabel={row.label} />,
    },
    {
      id: "detail",
      label: "Detalle",
      href: (row) => `/admin/tags/${row.id}`,
      testId: (row) => `tag-detail-link-${row.id}`,
    },
  ];

  async function saveRow({ row, values }: DataListRowChange<TagRow>): Promise<string | null> {
    const labelEs = typeof values.label === "string" ? values.label : "";
    return renameCatalogTag(row.id, labelEs, row.labelTranslations);
  }

  return (
    <EditableDataList
      rows={rows}
      getRowId={(row) => row.id}
      columns={columns}
      actions={actions}
      basePath="/admin/tags"
      page={page}
      pageSize={pageSize}
      totalCount={totalCount}
      sort={sort}
      filters={TAGS_FILTERS}
      filterValues={filterValues}
      extraParams={extraParams}
      ariaLabel="Etiquetas"
      rowTestIdPrefix="tag"
      emptyMessage="Ninguna etiqueta todavía."
      emptyTestId="no-tags"
      onSave={async (changes) => {
        const result = await saveInlineChanges(changes, (row) => row.label, saveRow);
        router.refresh();
        return result;
      }}
    />
  );
}
