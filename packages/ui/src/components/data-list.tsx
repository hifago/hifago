"use client";

import * as React from "react";
import {
  createColumnHelper,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  Autocomplete,
  Button,
  buttonVariants,
  Disclosure,
  EmptyState,
  Input,
  ListBox,
  SearchField,
  Select,
} from "@heroui/react";
import { cn } from "../lib/utils";
import { ServerPagination } from "./pagination";
import { ServerFilters } from "./server-filters";
import {
  SimpleTable,
  SimpleTableBody,
  SimpleTableCell,
  SimpleTableHead,
  SimpleTableHeader,
  SimpleTableRow,
} from "./simple-table";

/**
 * docs/specs/10-listes-standardisees-admin-socio.md §5.1 — composant unique pour les 13 listes
 * admin/socio : pagination et tri pilotés par l'URL (jamais un état React), filtres déclaratifs
 * (rendus via `ServerFilters` en interne quand `filters` est fourni — cf. `server-filters.tsx`),
 * clic-ligne vers une page de détail, actions selon ce qui est réellement possible par entité.
 */

// Tri résolu (packages/domain resolveSortParams) — un seul type partagé plutôt que ce littéral
// retapé dans chaque composant de liste consommateur.
export type DataListSort = { key: string; direction: "asc" | "desc" };

export type DataListColumn<Row> = {
  id: string; // = clé d'URL ?sort= ET id TanStack — jamais l'expression SQL
  header: string;
  // défaut (si absent) : String(row[id as keyof Row]) — n'utiliser ce défaut que si `id` est
  // LITTÉRALEMENT le nom de la propriété sur Row (ex. id "type" ↔ row.type). Dès que `id` sert
  // aussi de clé de tri SQL en snake_case (ex. "promo_code", "total_cop") alors que Row est en
  // camelCase (promoCode, amount), le défaut retombe silencieusement sur `undefined` — fournir
  // `cell` explicitement dans ce cas (bug réel constaté sur InvitationsList, colonne "Código").
  cell?: (row: Row) => React.ReactNode;
  sortable?: boolean; // défaut false ; true ⇒ id DOIT être dans la whitelist serveur
  align?: "left" | "right";
  className?: string;
  // Édition en ligne (2026-10-13) : présent ⇒ la cellule devient un champ, à condition que la
  // liste reçoive `onSave`. Absent ⇒ lecture seule, rendu `cell` inchangé.
  edit?: DataListColumnEdit<Row>;
};

// Une valeur de cellule en cours d'édition : du texte (champ texte, nombre saisi, clé d'un
// `select`) ou une liste de clés (`multiselect`). Jamais un nombre ni un booléen — c'est
// l'appelant qui convertit au moment d'enregistrer, là où il sait ce que la colonne veut dire.
export type DataListEditValue = string | string[];

export type DataListEditOption = { value: string; label: string };

export type DataListEditor =
  | { kind: "text"; placeholder?: string }
  // Chiffres seulement (un montant en pesos, une quantité) : tout autre caractère est retiré à la
  // frappe, la valeur reste une chaîne de chiffres.
  // `groupSeparator` : séparateur de milliers affiché hors saisie (« 1.320.000 »), jamais stocké.
  | { kind: "number"; placeholder?: string; groupSeparator?: string }
  | { kind: "select"; options: DataListEditOption[] }
  | {
      kind: "multiselect";
      options: DataListEditOption[];
      emptyLabel: string;
      // Présent ⇒ taper un libellé absent de `options` propose « + Crear "…" ». L'appelant écrit
      // (la liste ne connaît pas la base), dit lui-même pourquoi en cas de refus (`null`), et
      // ajoute l'option créée à `options` : la cellule la coche, elle ne la mémorise pas.
      // ⚠️ La création est immédiate — elle n'attend pas « Guardar cambios » et « Descartar » ne
      // l'annule pas ; seule l'affectation à la ligne reste un brouillon.
      onCreateOption?: (label: string) => Promise<DataListEditOption | null>;
      // Présent ⇒ un bouton sous la liste d'options, qui referme la cellule et rend la main à
      // l'appelant (son dialogue pour renommer ou supprimer une option). Comme la création, ce
      // qu'il y fait est immédiat et hors brouillon.
      manageOptions?: { label: string; onOpen: () => void };
    };

export type DataListColumnEdit<Row> = {
  // La valeur EN BASE de la cellule (celle que le serveur vient de rendre) : c'est à elle que le
  // brouillon est comparé pour savoir si la cellule est modifiée.
  value: (row: Row) => DataListEditValue;
  editor: DataListEditor;
  // false ⇒ cette ligne garde le rendu `cell` (ex. un prix dérivé de paliers). Défaut : true.
  isEditable?: (row: Row) => boolean;
  // Contenu affiché sous le champ (ex. les pastilles secondaires de la cellule « Estado »).
  adornment?: (row: Row) => React.ReactNode;
};

// Une ligne modifiée : seules les colonnes réellement différentes de la base y figurent.
export type DataListRowChange<Row> = {
  row: Row;
  rowId: string;
  values: Record<string, DataListEditValue>;
};

// Ce que la liste garde après un enregistrement : les lignes en échec conservent leur brouillon
// (l'admin corrige et réessaie), les autres le perdent.
export type DataListSaveResult = { failedRowIds: string[] };

// Poignée offerte à l'écran hôte pour brancher son garde-fou de navigation (« cambios sin
// guardar ») : enregistrer ou abandonner sans passer par les boutons de la barre.
export type DataListEditingHandle = {
  save: () => Promise<boolean>; // true ⇒ tout est enregistré
  discard: () => void;
};

export type DataListAction<Row> = {
  id: string;
  label: string; // "Ver" | "Editar" | "Eliminar" | "Revisar" | "Resolver" | …
  href?: (row: Row) => string;
  render?: (row: Row) => React.ReactNode; // action à état (dialog) fournie par le composant client de la page
  isVisible?: (row: Row) => boolean;
  variant?: "outline" | "danger";
  // Seulement lu quand `href` est fourni (rendu en <a data-testid=...>) — un `render` custom porte
  // son propre testid à l'intérieur du composant qu'il rend, ce champ y serait mort.
  testId?: (row: Row) => string;
};

// Action "Ver"/"Editar" standard vers la fiche détail — factorise le pattern répété tel quel dans
// la quasi-totalité des 13 listes (href/testId = `${basePath}/${id}`, identique à `rowHref` par
// défaut ci-dessous).
export function viewAction<Row>(
  basePath: string,
  testIdPrefix: string,
  label = "Ver"
): DataListAction<Row & { id: string }> {
  return {
    id: "view",
    label,
    href: (row) => `${basePath}/${row.id}`,
    testId: (row) => `${testIdPrefix}-detail-link-${row.id}`,
  };
}

export type DataListFilter =
  | { kind: "text"; name: string; label: string; placeholder?: string }
  | { kind: "select"; name: string; label: string; allLabel: string; options: { value: string; label: string }[] }
  | { kind: "date"; name: string; label: string };

export type DataListProps<Row> = {
  rows: Row[]; // déjà la page courante, déjà filtrée/triée par le serveur
  getRowId: (row: Row) => string;
  columns: DataListColumn<Row>[];
  actions?: DataListAction<Row>[];
  // Défaut (si absent) : `${basePath}/${getRowId(row)}` — ne fournir explicitement que lorsque la
  // route de détail ne correspond pas à cette forme (ex. OrdersTable, dont l'id de ligne est celui
  // de la order_line mais la fiche est celle de la commande, `orderId`). Retourner `undefined`
  // pour une ligne donnée désactive le stretched-link sur CETTE ligne (1re colonne rendue en texte
  // brut) — échappatoire pour une liste sans fiche détail réelle à offrir, plutôt que forcer une
  // page de fiche minimale n'affichant aucune donnée de plus que la ligne elle-même (déjà constaté
  // deux fois : admin/tags/[id]/page.tsx, partner/commissions/[id]/page.tsx).
  rowHref?: (row: Row) => string | undefined;
  basePath: string;
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filters?: DataListFilter[];
  filterValues?: Record<string, string>;
  extraParams: Record<string, string>; // sort+dir+filtres actifs — jamais page
  ariaLabel: string;
  rowTestIdPrefix: string; // ⇒ data-testid={`${prefix}-row-${id}`}
  emptyMessage: string;
  emptyTestId?: string;
  toolbar?: React.ReactNode; // bouton "Nuevo …", bloc de totaux, bannière
  // Édition en ligne (2026-10-13). `onSave` reçoit TOUTES les lignes modifiées de la page d'un
  // coup, au clic sur « Guardar cambios » — jamais cellule par cellule. C'est l'appelant qui
  // écrit, affiche ses toasts et rafraîchit (`router.refresh()`) : la liste ne connaît ni la base
  // ni le routeur. Sans `onSave`, aucune colonne n'est éditable, même si elle déclare `edit`.
  onSave?: (changes: DataListRowChange<Row>[]) => Promise<DataListSaveResult>;
  editingRef?: React.Ref<DataListEditingHandle>;
  onDirtyCountChange?: (dirtyCount: number) => void;
};

function sameEditValue(a: DataListEditValue, b: DataListEditValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    // Une sélection multiple est un ensemble : l'ordre de clic ne fait pas une modification.
    const sortedB = [...b].sort();
    return [...a].sort().every((value, index) => value === sortedB[index]);
  }
  return a === b;
}

type CellDrafts = Record<string, Record<string, DataListEditValue>>;

// Largeurs minimales des champs : leur somme, colonne d'actions comprise, doit tenir dans la zone
// de contenu de l'admin à 1280 px (992 px) pour la liste la plus large — le catálogo, six cellules
// éditables (mesuré : 974 px). Au-delà de ce minimum, la mise en page de tableau répartit l'espace
// restant, surtout vers les champs texte.
//
// `SELECT_VALUE_CLASS` : `w-0` + `flex-1` retirent le libellé du calcul de largeur de la colonne.
// Sans lui, un texte en `nowrap` impose sa longueur ENTIÈRE comme largeur minimale — un seul
// établissement au nom long suffisait à pousser la colonne d'actions hors de l'écran.
const SELECT_VALUE_CLASS = "w-0 min-w-0 flex-1 truncate";
const dirtyClassOf = (isDirty: boolean) => (isDirty ? "border-warning ring-1 ring-warning" : undefined);

function groupDigits(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

type EditableCellProps = {
  editor: DataListEditor;
  value: DataListEditValue;
  isDirty: boolean;
  isDisabled: boolean;
  ariaLabel: string;
  testId: string;
  onChange: (value: DataListEditValue) => void;
};

function EditableCell({ editor, value, isDirty, isDisabled, ariaLabel, testId, onChange }: EditableCellProps) {
  // Cellule modifiée : un liseré, en plus du compteur de la barre — jamais la couleur seule
  // (`.claude/rules/ui.md`), le compteur dit la même chose en toutes lettres.
  const dirtyClass = dirtyClassOf(isDirty);
  // Le montant ne s'affiche groupé (« 1.320.000 ») que hors saisie : regrouper pendant la frappe
  // déplace le curseur à chaque chiffre.
  const [isFocused, setIsFocused] = React.useState(false);

  if (editor.kind === "text" || editor.kind === "number") {
    const raw = typeof value === "string" ? value : "";
    const separator = editor.kind === "number" ? editor.groupSeparator : undefined;
    return (
      <Input
        aria-label={ariaLabel}
        value={separator && !isFocused ? groupDigits(raw, separator) : raw}
        placeholder={editor.placeholder}
        inputMode={editor.kind === "number" ? "numeric" : undefined}
        // Largeur intrinsèque d'un montant, pas les 20 caractères par défaut d'un <input> : sinon
        // la colonne du prix absorbe l'espace libre à la place de celle du nom.
        size={editor.kind === "number" ? 8 : undefined}
        disabled={isDisabled}
        data-dirty={isDirty || undefined}
        data-testid={testId}
        onFocus={(event) => {
          setIsFocused(true);
          if (!separator) return;
          // Passer de « 86.000 » à « 86000 » réécrit la valeur du champ, ce qui ANNULE la sélection
          // que le navigateur pose en y entrant au clavier : la frappe s'ajoutait alors aux
          // chiffres déjà là (« 8600087000 », constaté au rendu réel le 2026-10-13) au lieu de les
          // remplacer. On re-sélectionne tout une fois la valeur brute affichée.
          const field = event.currentTarget;
          requestAnimationFrame(() => {
            if (document.activeElement === field) field.select();
          });
        }}
        onBlur={() => setIsFocused(false)}
        onChange={(event) =>
          onChange(editor.kind === "number" ? event.target.value.replace(/\D+/g, "") : event.target.value)
        }
        className={cn(
          "w-full max-md:min-h-11 max-md:min-w-0",
          editor.kind === "number" ? "min-w-24 text-right" : "min-w-36",
          dirtyClass
        )}
      />
    );
  }

  if (editor.kind === "multiselect") {
    return (
      <MultiSelectCell
        editor={editor}
        selected={Array.isArray(value) ? value : []}
        isDirty={isDirty}
        isDisabled={isDisabled}
        ariaLabel={ariaLabel}
        testId={testId}
        onChange={onChange}
      />
    );
  }

  return (
    <Select
      aria-label={ariaLabel}
      value={typeof value === "string" && value !== "" ? value : null}
      onChange={(key) => {
        if (key !== null) onChange(String(key));
      }}
      isDisabled={isDisabled}
      className="min-w-28 max-md:min-w-0"
    >
      <Select.Trigger
        data-dirty={isDirty || undefined}
        data-testid={testId}
        className={cn("w-full max-md:min-h-11", dirtyClass)}
      >
        <Select.Value className={SELECT_VALUE_CLASS} />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {editor.options.map((option) => (
            <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

const CREATE_OPTION_KEY = "__create_option__";

// Comparaison de recherche : sans casse ni accents (« sen » trouve « Señalética »).
const searchKey = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

type MultiSelectCellProps = Omit<EditableCellProps, "editor" | "value"> & {
  editor: Extract<DataListEditor, { kind: "multiselect" }>;
  selected: string[];
};

// Sélection multiple avec recherche — `Autocomplete` HeroUI, pas `Select` : passé quelques dizaines
// d'options (les étiquettes du catálogo), une liste sans champ ne se parcourt plus, et c'est ce
// champ qui porte la création à la volée (`onCreateOption`).
function MultiSelectCell({ editor, selected, isDirty, isDisabled, ariaLabel, testId, onChange }: MultiSelectCellProps) {
  const [query, setQuery] = React.useState("");
  const [isCreating, setIsCreating] = React.useState(false);
  // Ouverture contrôlée : « gérer les options » doit pouvoir refermer la liste avant de céder la
  // place au dialogue de l'appelant.
  const [isOpen, setIsOpen] = React.useState(false);
  // La sélection la plus récente, lue au retour de `onCreateOption` : l'admin a pu cocher une
  // autre option pendant l'aller-retour.
  const selectedRef = React.useRef(selected);
  React.useEffect(() => {
    selectedRef.current = selected;
  });

  const needle = searchKey(query);
  const visibleOptions = needle
    ? editor.options.filter((option) => searchKey(option.label).includes(needle))
    : editor.options;
  const canCreate =
    Boolean(editor.onCreateOption) &&
    needle !== "" &&
    !editor.options.some((option) => searchKey(option.label) === needle);

  const create = async () => {
    if (!editor.onCreateOption || isCreating) return;
    setIsCreating(true);
    try {
      const created = await editor.onCreateOption(query.trim());
      if (!created) return;
      onChange([...new Set([...selectedRef.current, created.value])]);
      setQuery("");
    } finally {
      setIsCreating(false);
    }
  };

  // Libellés joints à la main, pas par le `Autocomplete.Value` par défaut : react-aria les formate
  // dans la langue du NAVIGATEUR (« Arte and Agua » sur un poste en anglais), alors que l'admin est
  // en espagnol en dur.
  const selectedLabels = editor.options.filter((option) => selected.includes(option.value)).map((o) => o.label);

  return (
    <Autocomplete
      aria-label={ariaLabel}
      selectionMode="multiple"
      value={selected}
      onChange={(keys) => {
        const next = keys.map(String);
        // « + Crear … » est une entrée de la liste, jamais une valeur : elle déclenche la création
        // et ne rejoint pas la sélection.
        if (next.includes(CREATE_OPTION_KEY)) void create();
        else onChange(next);
      }}
      isOpen={isOpen}
      onOpenChange={(next) => {
        setIsOpen(next);
        if (!next) setQuery("");
      }}
      isDisabled={isDisabled}
      className="min-w-36 max-md:min-w-0 md:max-w-56"
    >
      <Autocomplete.Trigger
        data-dirty={isDirty || undefined}
        data-testid={testId}
        className={cn("w-full items-center max-md:min-h-11", dirtyClassOf(isDirty))}
      >
        <Autocomplete.Value className={SELECT_VALUE_CLASS}>
          {selectedLabels.length > 0 ? (
            selectedLabels.join(", ")
          ) : (
            <span className="text-muted">{editor.emptyLabel}</span>
          )}
        </Autocomplete.Value>
        <Autocomplete.Indicator />
      </Autocomplete.Trigger>
      {/* Plus large que la cellule (≈ 150 px dans le tableau) : un champ de recherche n'y tient pas. */}
      <Autocomplete.Popover
        placement="bottom start"
        className="w-[max(var(--trigger-width),16rem)] max-w-[calc(100vw-2rem)]"
      >
        <Autocomplete.Filter inputValue={query} onInputChange={setQuery}>
          <SearchField autoFocus fullWidth aria-label={`Buscar — ${ariaLabel}`}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                placeholder={editor.onCreateOption ? "Buscar o crear…" : "Buscar…"}
                data-testid={`${testId}-search`}
              />
            </SearchField.Group>
          </SearchField>
          <ListBox renderEmptyState={() => <EmptyState>Sin resultados.</EmptyState>}>
            {visibleOptions.map((option) => (
              <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                {option.label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
            {canCreate ? (
              <ListBox.Item
                key={CREATE_OPTION_KEY}
                id={CREATE_OPTION_KEY}
                textValue={query.trim()}
                isDisabled={isCreating}
                data-testid={`${testId}-create`}
              >
                {isCreating ? "Creando…" : `+ Crear "${query.trim()}"`}
              </ListBox.Item>
            ) : null}
          </ListBox>
        </Autocomplete.Filter>
        {editor.manageOptions ? (
          <Button
            variant="ghost"
            size="sm"
            fullWidth
            className="mt-1 justify-start max-md:min-h-11"
            data-testid={`${testId}-manage`}
            onPress={() => {
              setIsOpen(false);
              setQuery("");
              editor.manageOptions?.onOpen();
            }}
          >
            {editor.manageOptions.label}
          </Button>
        ) : null}
      </Autocomplete.Popover>
    </Autocomplete>
  );
}

// TanStack Table v9 : les fonctionnalités sont des plugins enregistrés explicitement (comme dans
// OrdersTable.tsx). On enregistre rowSortingFeature/rowPaginationFeature pour disposer des
// OPTIONS manualSorting/manualPagination/rowCount et de la state slice `sorting` — mais jamais
// `sortedRowModel`/`paginatedRowModel` : c'est l'invariant central de la spec, `rows` est déjà la
// page triée/filtrée par le serveur, aucun retri/repagine client ne doit avoir lieu.
const dataListFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
});

// `Row` est un générique non contraint (contrat imposé par la spec), mais TanStack Table exige
// `TData extends Record<string, any> | Array<any>`. On fait tourner le plumbing TanStack sur un
// type de ligne "opaque" et on caste au point d'appel des fonctions fournies par l'appelant
// (col.cell, action.href/render/isVisible, rowHref, getRowId) — elles reçoivent toujours le vrai
// `Row` à l'exécution, seul le typage interne à ce composant est assoupli.
type OpaqueRow = Record<string, unknown>;

const columnHelper = createColumnHelper<typeof dataListFeatures, OpaqueRow>();

// Icône entonnoir minimale — aucune n'existe dans le jeu d'icônes HeroUI (`components/icons.js`),
// pas la peine d'une dépendance pour un seul glyphe.
function FilterIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M3 5h14M6 10h8M8.5 15h3" />
    </svg>
  );
}

function buildSortHref(
  basePath: string,
  extraParams: Record<string, string>,
  sort: { key: string; direction: "asc" | "desc" },
  columnId: string
) {
  // Toggle si déjà triée sur cette colonne, "asc" par défaut sinon. `page` n'apparaît jamais ici
  // (changer de tri revient toujours à la page 1, implicitement, en l'omettant).
  const nextDirection = sort.key === columnId && sort.direction === "asc" ? "desc" : "asc";
  const params = new URLSearchParams({ ...extraParams, sort: columnId, dir: nextDirection });
  return `${basePath}?${params.toString()}`;
}

export function DataList<Row>(props: DataListProps<Row>): React.ReactElement {
  const {
    rows,
    getRowId,
    columns,
    actions,
    rowHref = (row) => `${props.basePath}/${getRowId(row)}`,
    basePath,
    page,
    pageSize,
    totalCount,
    sort,
    filters,
    filterValues,
    extraParams,
    ariaLabel,
    rowTestIdPrefix,
    emptyMessage,
    emptyTestId,
    toolbar,
    onSave,
    editingRef,
    onDirtyCountChange,
  } = props;

  const columnById = React.useMemo(() => new Map(columns.map((col) => [col.id, col])), [columns]);

  // ---------- Édition en ligne -------------------------------------------------------------------
  // `drafts` : ce que l'admin a saisi et pas encore enregistré. `saved` : ce qui vient d'être
  // enregistré et que le serveur n'a pas encore renvoyé — affiché tel quel pour que la cellule ne
  // retombe pas une demi-seconde sur l'ancienne valeur entre l'écriture et le rafraîchissement.
  // `saved` se périme tout seul : il n'est lu que tant que `rows` est le tableau pour lequel il a
  // été posé (un rafraîchissement livre un nouveau tableau).
  const isEditable = Boolean(onSave) && columns.some((col) => col.edit);
  const [drafts, setDrafts] = React.useState<CellDrafts>({});
  const [saved, setSaved] = React.useState<{ forRows: Row[]; values: CellDrafts }>({ forRows: rows, values: {} });
  const [isSaving, setIsSaving] = React.useState(false);
  const savedValues = saved.forRows === rows ? saved.values : undefined;

  const cellValue = (row: Row, rowId: string, col: DataListColumn<Row>): DataListEditValue =>
    drafts[rowId]?.[col.id] ?? savedValues?.[rowId]?.[col.id] ?? col.edit!.value(row);

  const isCellEditable = (row: Row, col: DataListColumn<Row>): boolean =>
    Boolean(onSave && col.edit && (col.edit.isEditable?.(row) ?? true));

  // Un brouillon redevenu égal à la base n'est pas une modification : retaper l'ancien nom efface
  // le liseré et décompte la cellule, sans bouton « annuler » par champ.
  const isCellDirty = (row: Row, rowId: string, col: DataListColumn<Row>): boolean => {
    const draft = drafts[rowId]?.[col.id];
    if (draft === undefined) return false;
    return !sameEditValue(draft, savedValues?.[rowId]?.[col.id] ?? col.edit!.value(row));
  };

  const changes: DataListRowChange<Row>[] = [];
  if (isEditable) {
    for (const row of rows) {
      const rowId = getRowId(row);
      const values: Record<string, DataListEditValue> = {};
      for (const col of columns) {
        if (isCellEditable(row, col) && isCellDirty(row, rowId, col)) values[col.id] = drafts[rowId][col.id];
      }
      if (Object.keys(values).length > 0) changes.push({ row, rowId, values });
    }
  }
  const dirtyCount = changes.reduce((total, change) => total + Object.keys(change.values).length, 0);

  // Nom lisible de la ligne pour l'`aria-label` de ses champs (« Precio — Kayak al atardecer ») :
  // la valeur EN BASE de la 1ʳᵉ colonne, pour ne pas changer d'étiquette à chaque frappe.
  const rowLabel = (row: Row, rowId: string): string => {
    const first = columns[0];
    const fromEdit = first?.edit?.value(row);
    if (typeof fromEdit === "string" && fromEdit !== "") return fromEdit;
    const raw = first ? (row as Record<string, unknown>)[first.id] : undefined;
    return typeof raw === "string" && raw !== "" ? raw : rowId;
  };

  const setCell = (rowId: string, columnId: string, value: DataListEditValue) =>
    setDrafts((previous) => ({ ...previous, [rowId]: { ...previous[rowId], [columnId]: value } }));

  const discard = () => setDrafts({});

  const save = async (): Promise<boolean> => {
    if (!onSave || changes.length === 0) return true;
    setIsSaving(true);
    try {
      const { failedRowIds } = await onSave(changes);
      const failed = new Set(failedRowIds);
      const succeeded = changes.filter((change) => !failed.has(change.rowId));
      setSaved({
        forRows: rows,
        values: {
          ...savedValues,
          ...Object.fromEntries(
            succeeded.map((change) => [change.rowId, { ...savedValues?.[change.rowId], ...change.values }])
          ),
        },
      });
      // Les lignes en échec gardent leur brouillon : l'admin corrige la cellule et réessaie.
      setDrafts((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([rowId]) => failed.has(rowId)))
      );
      return failed.size === 0;
    } finally {
      setIsSaving(false);
    }
  };

  // La poignée lit toujours le dernier rendu : l'écran hôte l'appelle depuis un écouteur global
  // (clic sur un lien de navigation), jamais depuis un rendu.
  const handleRef = React.useRef<DataListEditingHandle>({ save, discard });
  React.useEffect(() => {
    handleRef.current = { save, discard };
  });
  React.useImperativeHandle(
    editingRef,
    () => ({ save: () => handleRef.current.save(), discard: () => handleRef.current.discard() }),
    []
  );
  React.useEffect(() => {
    onDirtyCountChange?.(dirtyCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seul le compteur déclenche ; le
    // rappel de l'appelant est une fonction recréée à chaque rendu.
  }, [dirtyCount]);
  const hasActions = Boolean(actions && actions.length > 0);
  const totalColumnCount = columns.length + (hasActions ? 1 : 0);

  const columnDefs = React.useMemo(() => {
    const dataColumns = columns.map((col, index) =>
      columnHelper.display({
        id: col.id,
        // Rendu via un header-template TanStack (fonction) plutôt qu'une chaîne : c'est ce qui
        // permet d'obtenir le lien de tri <a> à travers `table.FlexRender`, comme OrdersTable.tsx
        // le fait pour son bouton de tri.
        header: () =>
          col.sortable ? (
            <a
              href={buildSortHref(basePath, extraParams, sort, col.id)}
              className="inline-flex items-center gap-1"
              data-testid={`sort-${col.id}`}
            >
              {col.header}
              {sort.key === col.id ? (
                <span aria-hidden="true">{sort.direction === "asc" ? "↑" : "↓"}</span>
              ) : null}
            </a>
          ) : (
            col.header
          ),
        cell: (info) => {
          const row = info.row.original as unknown as Row;
          const content = col.cell ? col.cell(row) : String((row as Record<string, unknown>)[col.id]);
          // Stretched link (spec §5.1) : seule la 1ʳᵉ colonne porte le vrai <a> qui couvre toute
          // la ligne via son `::after` — un vrai lien, jamais un onClick sur <tr> (clavier,
          // clic-milieu, copier-lien restent utilisables). La <tr> porte `relative` plus bas pour
          // que ce `::after` (absolute + inset-0) s'ancre dessus.
          if (index === 0) {
            const href = rowHref(row);
            if (href) {
              return <a href={href} className="after:absolute after:inset-0">{content}</a>;
            }
          }
          return content;
        },
      })
    );

    if (!hasActions) {
      return columnHelper.columns(dataColumns);
    }

    const actionsColumn = columnHelper.display({
      id: "__actions",
      header: "",
      cell: (info) => {
        const row = info.row.original as unknown as Row;
        const visibleActions = (actions ?? []).filter((action) => !action.isVisible || action.isVisible(row));
        if (visibleActions.length === 0) return null;
        return (
          // Sous `md` (ligne refluée en carte), trois actions ne tiennent pas sur 390 px : elles
          // passent à la ligne au lieu de sortir de la carte. Au-dessus, la rangée reste d'un trait.
          <div className="flex gap-2 max-md:flex-wrap max-md:justify-end">
            {visibleActions.map((action) =>
              action.render ? (
                <React.Fragment key={action.id}>{action.render(row)}</React.Fragment>
              ) : action.href ? (
                <a
                  key={action.id}
                  href={action.href(row)}
                  className={buttonVariants({
                    variant: action.variant === "danger" ? "danger" : "outline",
                    size: "sm",
                  })}
                  data-testid={action.testId?.(row)}
                >
                  {action.label}
                </a>
              ) : null
            )}
          </div>
        );
      },
    });

    return columnHelper.columns([...dataColumns, actionsColumn]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sort/extraParams sont des littéraux
    // recréés à chaque rendu côté appelant (page Server Component) ; les inclure ferait
    // recalculer les colonnes à chaque rendu, ce qui reste correct (juste non optimal), donc on
    // les inclut quand même explicitement plutôt que de risquer un lien de tri périmé.
  }, [columns, actions, hasActions, rowHref, basePath, extraParams, sort]);

  const table = useTable({
    features: dataListFeatures,
    columns: columnDefs,
    data: rows as unknown as OpaqueRow[],
    getRowId: (row) => getRowId(row as unknown as Row),
    // Invariant central (spec §0/§8) : `rows` est déjà la page triée/filtrée par le serveur —
    // aucun sortedRowModel/paginatedRowModel enregistré, ces deux options empêchent tout retri ou
    // repagine côté client.
    manualSorting: true,
    manualPagination: true,
    rowCount: totalCount,
    state: {
      sorting: [{ id: sort.key, desc: sort.direction === "desc" }],
    },
  });

  const hasFilters = Boolean(toolbar) || Boolean(filters && filters.length > 0);
  // Nombre de filtres DÉCLARATIFS (`DataListFilter[]`) réellement posés — n'inclut pas les
  // paramètres propres à un `toolbar` custom (ex. PartnersFilterBar `location_q`/`radius_km`),
  // qui n'existent pas dans `filterValues`. Juste un indicateur visuel, pas un contrat.
  const activeFilterCount = (filters ?? []).filter((f) => Boolean(filterValues?.[f.name])).length;

  // Repliés par défaut sur mobile (Jérôme, 2026-08-20 : un formulaire de filtres complet prenait
  // toute la hauteur visible avant d'atteindre la liste) — mais ce même repli s'appliquait AUSSI
  // au desktop, jamais voulu (aucune contrainte de hauteur là-bas), simplement pas distingué à
  // l'origine. Correction 2026-09-26 (retour Jérôme) : ouverts par défaut à partir de `md` (768px).
  // Pas de CSS pur possible ici (contrairement à `app-nav-shell.tsx`, qui affiche deux arbres DOM
  // distincts sélectionnés par `hidden md:flex`) — un seul jeu de champs, contrôlé par l'état
  // `Disclosure` sous-jacent (attribut `hidden` + hauteur posés impérativement par React Aria).
  // Même patron déjà accepté dans ce repo pour un problème identique (mode d'un composant tiers
  // sans équivalent CSS) : `PartnerAgenda.tsx`, `matchMedia` direct dans un effet, jamais un hook
  // `useMediaQuery` générique. `isExpanded`/`onExpandedChange` (contrôlé) remplace `defaultExpanded`
  // — rendu serveur toujours replié (aucun accès à `window`), corrigé après montage si desktop.
  const [isFiltersExpanded, setIsFiltersExpanded] = React.useState(false);
  React.useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const applyFromViewport = () => setIsFiltersExpanded(mql.matches);
    applyFromViewport();
    mql.addEventListener("change", applyFromViewport);
    return () => mql.removeEventListener("change", applyFromViewport);
  }, []);

  return (
    <div className="flex w-full flex-col gap-4">
      {hasFilters ? (
        <div className="flex flex-col gap-3 border-b border-border pb-4">
          <Disclosure isExpanded={isFiltersExpanded} onExpandedChange={setIsFiltersExpanded}>
            <Disclosure.Trigger
              data-testid="filters-toggle"
              className={cn(
                "flex min-h-11 w-full items-center gap-2 rounded-lg border border-default bg-overlay px-3.5 py-2.5 text-sm font-medium text-foreground transition-colors md:min-h-0",
                // Desktop : plus besoin d'un vrai bouton, les champs sont déjà visibles — juste un
                // petit lien discret pour qui veut regagner la hauteur.
                "md:w-auto md:border-0 md:bg-transparent md:p-0 md:text-xs md:font-normal md:text-muted md:underline md:underline-offset-2 md:hover:text-foreground"
              )}
            >
              <FilterIcon className="size-4 shrink-0 text-muted md:hidden" aria-hidden="true" />
              {isFiltersExpanded ? "Ocultar filtros" : "Filtros"}
              {!isFiltersExpanded && activeFilterCount > 0 ? (
                <span
                  className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-accent-foreground md:hidden"
                  data-testid="filters-active-count"
                >
                  {activeFilterCount}
                </span>
              ) : null}
              <Disclosure.Indicator className="md:hidden" />
            </Disclosure.Trigger>
            <Disclosure.Content>
              <Disclosure.Body className="flex flex-col gap-4 p-0 pt-3">
                {toolbar}
                {filters && filters.length > 0 ? (
                  <ServerFilters
                    basePath={basePath}
                    filters={filters}
                    values={filterValues}
                    // Préserve le tri actif à la soumission du formulaire de filtres — jamais "page"
                    // (tout changement de filtre revient implicitement à la page 1, en l'omettant,
                    // même règle que buildSortHref ci-dessus).
                    hiddenParams={{ sort: sort.key, dir: sort.direction }}
                  />
                ) : null}
              </Disclosure.Body>
            </Disclosure.Content>
          </Disclosure>
        </div>
      ) : null}

      {isEditable ? (
        // Collante en haut de page : sur une liste de 20 lignes, le bouton reste sous la main
        // quelle que soit la ligne en cours d'édition.
        <div
          className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2"
          data-testid="edit-bar"
        >
          <p className="text-sm text-muted" aria-live="polite" data-testid="edit-bar-status">
            {dirtyCount === 0
              ? "Edita las celdas de la tabla y guarda los cambios."
              : dirtyCount === 1
                ? "1 cambio sin guardar"
                : `${dirtyCount} cambios sin guardar`}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              isDisabled={dirtyCount === 0 || isSaving}
              onPress={discard}
              data-testid="discard-changes-button"
            >
              Descartar
            </Button>
            <Button
              size="sm"
              isDisabled={dirtyCount === 0 || isSaving}
              onPress={() => void save()}
              data-testid="save-changes-button"
            >
              {isSaving ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>
        </div>
      ) : null}

      <SimpleTable aria-label={ariaLabel}>
        <SimpleTableHeader>
          {table.getHeaderGroups().map((group) => (
            <SimpleTableRow key={group.id}>
              {group.headers.map((header) => {
                const col = columnById.get(header.column.id);
                return (
                  <SimpleTableHead
                    key={header.id}
                    className={cn(col?.align === "right" && "text-right", col?.className)}
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </SimpleTableHead>
                );
              })}
            </SimpleTableRow>
          ))}
        </SimpleTableHeader>
        <SimpleTableBody>
          {rows.length === 0 ? (
            <SimpleTableRow>
              <SimpleTableCell
                colSpan={totalColumnCount}
                className="text-center text-muted"
                data-testid={emptyTestId}
              >
                {emptyMessage}
              </SimpleTableCell>
            </SimpleTableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <SimpleTableRow key={row.id} className="relative" data-testid={`${rowTestIdPrefix}-row-${row.id}`}>
                {row.getAllCells().map((cell, index) => {
                  const col = columnById.get(cell.column.id);
                  const original = row.original as unknown as Row;
                  // Une cellule éditable est rendue ICI, pas par le gabarit de colonne TanStack :
                  // `columnDefs` est recalculé dès que l'appelant se re-rend (ses `columns` sont
                  // un littéral), et FlexRender monte alors un NOUVEAU composant de cellule — un
                  // champ y perdrait le focus à la première frappe.
                  if (col && isCellEditable(original, col)) {
                    return (
                      <SimpleTableCell
                        key={cell.id}
                        data-label={col.header}
                        className={cn(index !== 0 && "relative z-10", col.className)}
                      >
                        <div className="flex flex-col gap-1 max-md:min-w-0 max-md:flex-1">
                          <EditableCell
                            editor={col.edit!.editor}
                            value={cellValue(original, row.id, col)}
                            isDirty={isCellDirty(original, row.id, col)}
                            isDisabled={isSaving}
                            ariaLabel={`${col.header} — ${rowLabel(original, row.id)}`}
                            testId={`edit-${col.id}-${row.id}`}
                            onChange={(value) => setCell(row.id, col.id, value)}
                          />
                          {col.edit!.adornment?.(original)}
                        </div>
                      </SimpleTableCell>
                    );
                  }
                  return (
                    <SimpleTableCell
                      key={cell.id}
                      // Reflow mobile (SimpleTableCell, max-md:) : "" pour la colonne actions
                      // (header vide) — pas de libellé affiché, juste les boutons.
                      data-label={col?.header ?? ""}
                      className={cn(
                        // Toute cellule autre que la 1re (qui PORTE le stretched link) passe
                        // au-dessus de son `::after` — sinon un lien/bouton propre à cette
                        // cellule (colonne actions, ou une colonne avec son propre lien comme
                        // "Actividades" sur EstablishmentsList) ne recevrait jamais le clic.
                        // Généralisé (plus un opt-in par colonne) après un bug réel constaté sur
                        // EstablishmentsList — cf. docs/specs/10-...md, lot 4.
                        index !== 0 && "relative z-10",
                        col?.align === "right" && "text-right",
                        col?.className
                      )}
                    >
                      <table.FlexRender cell={cell} />
                    </SimpleTableCell>
                  );
                })}
              </SimpleTableRow>
            ))
          )}
        </SimpleTableBody>
      </SimpleTable>

      <ServerPagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        basePath={basePath}
        extraParams={extraParams}
      />
    </div>
  );
}
