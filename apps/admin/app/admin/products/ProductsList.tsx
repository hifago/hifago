"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type DataListAction,
  type DataListColumn,
  type DataListEditOption,
  type DataListFilter,
  type DataListRowChange,
  type DataListSort,
  toast,
  viewAction,
} from "@hifago/ui";
import { formatCop } from "@hifago/domain";
import { createClient } from "@hifago/supabase/client";
import { EditableDataList } from "@/components/editable-data-list";
import { ManageTagsDialog } from "@/components/manage-tags-dialog";
import { StatusChip } from "@/components/status-chip";
import { rpcErrorMessage } from "@/lib/errors/rpcErrorMessage";
import {
  PRODUCTS_FILTERS,
  PRODUCT_SELLABLE_CHIP_STYLE,
  PRODUCT_SELLABLE_LABELS,
  PRODUCT_TYPE_LABELS,
} from "@/lib/lists/filters";
import { PRODUCT_INLINE_REFUSALS, inlineRefusal, saveInlineChanges } from "@/lib/lists/inlineEdit";
import { createCatalogTag } from "@/lib/tags/createCatalogTag";

export type ProductRow = {
  id: string;
  name: string;
  establishmentId: string;
  establishmentName: string;
  type: string;
  priceCop: number | null;
  // Seul un prix « simple » s'édite dans la liste. Les trois autres cas ont leur écran : un barème
  // (`tiers`, price_cop n'en est que le palier le plus bas), un evento gratuit (`free`), une
  // fiche vitrine sans prix (`none`).
  priceMode: "simple" | "tiers" | "free" | "none";
  sellable: boolean;
  tagIds: string[];
};

export type ProductsListProps = {
  rows: ProductRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filterValues: Record<string, string>;
  extraParams: Record<string, string>;
  // Revue admin catalogo (Jérôme, 2026-08-19) — construit côté page.tsx (établissements
  // dynamiques, jamais une liste fermée écrite en dur dans filters.ts comme type/sellable).
  establishmentOptions: { value: string; label: string }[];
  // Édition en ligne (2026-10-13) : la liste COMPLÈTE, pour la cellule « Establecimiento » — le
  // filtre ci-dessus reste plafonné à 10.
  allEstablishmentOptions: { value: string; label: string }[];
  // Revue admin étiquettes (Jérôme, 2026-08-20) — même raison que establishmentOptions (construit
  // côté page.tsx), mais pas de plafond/échappatoire texte : cf. commentaire page.tsx. Sert aussi
  // d'options à la cellule éditable « Etiquetas ».
  tagOptions: { value: string; label: string }[];
};

const PRICE_MODE_NOTES: Record<Exclude<ProductRow["priceMode"], "simple">, string> = {
  tiers: "Por tramos",
  free: "Gratis",
  none: "Sin precio",
};

// docs/specs/10-listes-standardisees-admin-socio.md §5.3 — écran pilote (2e) : 1er vrai passage
// `Table` compound HeroUI -> `DataList`. Décision Jérôme : pas d'Eliminar sur la liste (action
// destructive trop accessible dans un groupe dense de boutons) — reste uniquement sur la fiche
// détail (/admin/products/[id], DeleteProductButton inchangé là-bas).
//
// Édition en ligne (demande Jérôme, 2026-10-13) : nom, établissement, type, étiquettes, prix et
// état s'éditent dans la cellule ; « Guardar cambios » écrit chaque ligne modifiée par UN appel à
// admin_update_product_inline (tout ou rien par ligne). Le clic sur la ligne ne mène plus à la
// fiche — sa 1ʳᵉ colonne est un champ — : « Ver » et « Editar » restent dans la colonne d'actions.
export function ProductsList({
  rows,
  page,
  pageSize,
  totalCount,
  sort,
  filterValues,
  extraParams,
  establishmentOptions,
  allEstablishmentOptions,
  tagOptions,
}: ProductsListProps) {
  const router = useRouter();

  // Étiquettes créées depuis la cellule « Etiquetas » (demande Jérôme, 2026-10-13) : gardées ici
  // tant que le serveur ne les a pas renvoyées dans `tagOptions` — le rafraîchissement n'a lieu
  // qu'à « Guardar cambios », et la cellule doit pouvoir afficher l'étiquette tout de suite.
  const [createdTags, setCreatedTags] = useState<DataListEditOption[]>([]);
  const allTagOptions = useMemo(
    () => [...tagOptions, ...createdTags.filter((tag) => !tagOptions.some((t) => t.value === tag.value))],
    [tagOptions, createdTags]
  );

  // Renommer / supprimer une étiquette depuis la cellule (demande Jérôme, 2026-10-13). Écriture
  // immédiate, comme la création ; le serveur relit ensuite libellés, filtre et assignations.
  const [isManagingTags, setIsManagingTags] = useState(false);

  function handleTagRenamed(tagId: string, label: string) {
    setCreatedTags((previous) => previous.map((tag) => (tag.value === tagId ? { ...tag, label } : tag)));
    router.refresh();
  }

  function handleTagDeleted(tagId: string) {
    setCreatedTags((previous) => previous.filter((tag) => tag.value !== tagId));
    router.refresh();
  }

  async function createTagOption(label: string): Promise<DataListEditOption | null> {
    const result = await createCatalogTag(label);
    if ("error" in result) {
      toast.danger(result.error);
      return null;
    }
    const option = { value: result.tag.id, label: result.tag.label };
    setCreatedTags((previous) => [...previous, option]);
    toast.success("Tag creado.");
    return option;
  }

  const filters: DataListFilter[] = [
    ...PRODUCTS_FILTERS,
    {
      kind: "select",
      name: "establishment_id",
      label: "Establecimiento",
      allLabel: "Todos los establecimientos",
      options: establishmentOptions,
    },
    // Retour Jérôme (2026-08-19) : le dropdown ci-dessus reste plafonné à 10 (cf. page.tsx) — ce
    // champ est l'échappatoire pour chercher un établissement absent de la liste visible. Jamais
    // combiné au dropdown côté requête (l'un ou l'autre, cf. page.tsx) : si les deux sont postés,
    // establishment_id (dropdown) gagne toujours.
    {
      kind: "text",
      name: "establishment_q",
      label: "Establecimiento (si no aparece en la lista)",
      placeholder: "Buscar por nombre",
    },
    // Revue admin étiquettes (Jérôme, 2026-08-20) — filtre par tag, préréempli quand on arrive via
    // "Ver" depuis /admin/tags (?tag_id=…, cf. TagsList.tsx) mais aussi utilisable directement ici,
    // même famille que "Tipo"/"Estado" (liste fermée, pas de plafond/échappatoire — cf. page.tsx).
    {
      kind: "select",
      name: "tag_id",
      label: "Etiqueta",
      allLabel: "Todas las etiquetas",
      options: allTagOptions,
    },
  ];

  const columns: DataListColumn<ProductRow>[] = [
    {
      id: "name",
      header: "Nombre",
      sortable: true,
      edit: { value: (row) => row.name, editor: { kind: "text" } },
    },
    {
      id: "establishmentName",
      header: "Establecimiento",
      // Un peu plus large que « Tipo »/« Estado » : un nom d'établissement se tronque vite.
      className: "md:min-w-40",
      edit: {
        value: (row) => row.establishmentId,
        editor: { kind: "select", options: allEstablishmentOptions },
      },
    },
    {
      id: "type",
      header: "Tipo",
      sortable: true,
      edit: {
        value: (row) => row.type,
        editor: {
          kind: "select",
          options: Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
        },
      },
    },
    {
      id: "tags",
      header: "Etiquetas",
      edit: {
        value: (row) => row.tagIds,
        editor: {
          kind: "multiselect",
          options: allTagOptions,
          emptyLabel: "Sin etiquetas",
          onCreateOption: createTagOption,
          manageOptions: { label: "Editar o eliminar etiquetas…", onOpen: () => setIsManagingTags(true) },
        },
      },
    },
    {
      id: "price_cop",
      header: "Precio (COP)",
      sortable: true,
      align: "right",
      // Rendu des lignes dont le prix ne s'édite pas ici : le montant, et pourquoi.
      cell: (row) => (
        <span className="flex flex-col items-end" data-testid={`product-price-readonly-${row.id}`}>
          {row.priceCop !== null ? formatCop(row.priceCop) : "—"}
          {row.priceMode !== "simple" ? (
            <span className="text-xs text-muted">{PRICE_MODE_NOTES[row.priceMode]}</span>
          ) : null}
        </span>
      ),
      edit: {
        value: (row) => (row.priceCop === null ? "" : String(row.priceCop)),
        // Séparateur de milliers colombien, comme formatCop sur les lignes en lecture seule.
        editor: { kind: "number", groupSeparator: "." },
        isEditable: (row) => row.priceMode === "simple",
      },
    },
    {
      id: "sellable",
      header: "Estado",
      cell: (row) => (
        <StatusChip
          status={row.sellable ? "true" : "false"}
          map={PRODUCT_SELLABLE_CHIP_STYLE}
          labels={PRODUCT_SELLABLE_LABELS}
          testId={`product-sellable-${row.id}`}
        />
      ),
      edit: {
        value: (row) => (row.sellable ? "true" : "false"),
        editor: {
          kind: "select",
          options: Object.entries(PRODUCT_SELLABLE_LABELS).map(([value, label]) => ({ value, label })),
        },
      },
    },
  ];

  const actions: DataListAction<ProductRow>[] = [
    viewAction("/admin/products", "product"),
    {
      id: "edit",
      label: "Editar",
      href: (row) => `/admin/products/${row.id}/edit`,
      testId: (row) => `product-edit-link-${row.id}`,
    },
  ];

  async function saveRow({ rowId, values }: DataListRowChange<ProductRow>): Promise<string | null> {
    // Clés de la liste blanche de admin_update_product_inline. Les valeurs de cellule sont du
    // texte : c'est ici qu'elles reprennent leur type.
    const changes: Record<string, string | number | boolean | string[]> = {};
    if (typeof values.name === "string") changes.name_es = values.name;
    if (typeof values.establishmentName === "string") changes.establishment_id = values.establishmentName;
    if (typeof values.type === "string") changes.type = values.type;
    if (Array.isArray(values.tags)) changes.tag_ids = values.tags;
    if (typeof values.sellable === "string") changes.sellable = values.sellable === "true";
    if (typeof values.price_cop === "string") {
      // Champ vidé : `Number("")` vaut 0, que la base refuserait avec le même texte — autant ne
      // pas faire l'aller-retour.
      if (values.price_cop === "") return PRODUCT_INLINE_REFUSALS.invalid_price;
      changes.price_cop = Number(values.price_cop);
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc("admin_update_product_inline", {
      p_product_id: rowId,
      p_changes: changes,
    });
    if (error) return rpcErrorMessage(error, "No se pudo guardar.");
    return inlineRefusal(data, PRODUCT_INLINE_REFUSALS, "No se pudo guardar.");
  }

  return (
    <>
      <ManageTagsDialog
        isOpen={isManagingTags}
        onOpenChange={setIsManagingTags}
        tags={allTagOptions.map((tag) => ({ id: tag.value, label: tag.label }))}
        onRenamed={handleTagRenamed}
        onDeleted={handleTagDeleted}
      />
      <EditableDataList
        rows={rows}
        getRowId={(row) => row.id}
        columns={columns}
        actions={actions}
        basePath="/admin/products"
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        sort={sort}
        filters={filters}
        filterValues={filterValues}
        extraParams={extraParams}
        ariaLabel="Catálogo"
        rowTestIdPrefix="product"
        emptyMessage="Ningún producto todavía."
        emptyTestId="no-products"
        onSave={async (changes) => {
          const result = await saveInlineChanges(changes, (row) => row.name, saveRow);
          // `rows` dérive du serveur (page + tri + filtres) : un vrai refetch, même quand une ligne
          // enregistrée sort du filtre actif (spec 10 §0, cas limites).
          router.refresh();
          return result;
        }}
      />
    </>
  );
}
