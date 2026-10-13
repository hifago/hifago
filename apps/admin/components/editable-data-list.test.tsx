import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataListColumn, DataListRowChange, DataListSaveResult } from "@hifago/ui";

// Édition en ligne des listes admin (2026-10-13). Ce fichier prouve la logique que ni le typecheck
// ni la base ne voient : ce qui compte comme une cellule modifiée, ce que « Guardar cambios »
// transmet, ce qu'une ligne refusée garde, et le garde-fou de navigation — qui retient un lien
// seulement quand il y a quelque chose à perdre, puis fait exactement ce que dit chaque bouton.

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { EditableDataList } = await import("./editable-data-list");
const { UnsavedChangesProvider } = await import("./unsaved-changes");

type Row = { id: string; name: string; price: string; locked: boolean };

const ROWS: Row[] = [
  { id: "a", name: "Kayak", price: "50000", locked: false },
  { id: "b", name: "Velero", price: "90000", locked: true },
];

const COLUMNS: DataListColumn<Row>[] = [
  { id: "name", header: "Nombre", edit: { value: (row) => row.name, editor: { kind: "text" } } },
  {
    id: "price",
    header: "Precio",
    cell: (row) => `solo lectura ${row.price}`,
    edit: {
      value: (row) => row.price,
      editor: { kind: "number", groupSeparator: "." },
      isEditable: (row) => !row.locked,
    },
  },
];

type SaveFn = (changes: DataListRowChange<Row>[]) => Promise<DataListSaveResult>;
const onSave = vi.fn<SaveFn>();

function renderList(rows: Row[] = ROWS) {
  return render(
    <UnsavedChangesProvider>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- un <a> nu, exprès : c'est la
          forme des liens de tri et de pagination de DataList, celle que le garde-fou doit retenir. */}
      <a href="/admin/tags" data-testid="nav-link">
        Etiquetas
      </a>
      <EditableDataList
        rows={rows}
        getRowId={(row) => row.id}
        columns={COLUMNS}
        basePath="/admin/things"
        page={1}
        pageSize={20}
        totalCount={rows.length}
        sort={{ key: "name", direction: "asc" }}
        extraParams={{}}
        ariaLabel="Cosas"
        rowTestIdPrefix="thing"
        emptyMessage="Nada."
        onSave={onSave}
      />
    </UnsavedChangesProvider>
  );
}

const status = () => screen.getByTestId("edit-bar-status").textContent;
const input = (testId: string) => screen.getByTestId(testId) as HTMLInputElement;
/**
 * Clic sur le lien ; rend `true` si le garde-fou l'a retenu. Retenu = le clic n'atteint jamais le
 * lien (capture sur `window` + stopPropagation). L'écouteur posé ici annule la navigation dans
 * l'autre cas : jsdom ne sait pas naviguer et l'écrirait sur stderr.
 */
function clickNav(init?: MouseEventInit): boolean {
  const link = screen.getByTestId("nav-link");
  let atteint = false;
  const noter = (event: Event) => {
    atteint = true;
    event.preventDefault();
  };
  link.addEventListener("click", noter);
  fireEvent.click(link, init);
  link.removeEventListener("click", noter);
  return !atteint;
}

beforeAll(() => {
  // jsdom n'a pas `CSS.escape`, que react-aria appelle pour localiser l'option focalisée d'une
  // liste (même polyfill que ProductAmenitiesBlock.test.tsx).
  if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
    globalThis.CSS = { ...globalThis.CSS, escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&") };
  }
  // jsdom n'a pas matchMedia ; DataList s'en sert pour déplier ses filtres à partir de `md`.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  onSave.mockReset();
  onSave.mockResolvedValue({ failedRowIds: [] });
  router.push.mockClear();
});

describe("DataList — cellules éditables", () => {
  it("rien de modifié : boutons inactifs, une ligne non éditable garde son rendu en lecture seule", () => {
    renderList();
    expect(status()).toBe("Edita las celdas de la tabla y guarda los cambios.");
    expect(screen.getByTestId("save-changes-button")).toHaveProperty("disabled", true);
    expect(screen.getByTestId("discard-changes-button")).toHaveProperty("disabled", true);
    expect(screen.queryByTestId("edit-price-b")).toBeNull();
    expect(screen.getByTestId("thing-row-b").textContent).toContain("solo lectura 90000");
  });

  it("compte les cellules modifiées, et décompte une cellule revenue à sa valeur d'origine", () => {
    renderList();
    fireEvent.change(input("edit-name-a"), { target: { value: "Kayak doble" } });
    expect(status()).toBe("1 cambio sin guardar");
    expect(input("edit-name-a").dataset.dirty).toBe("true");
    fireEvent.change(input("edit-name-b"), { target: { value: "Velero azul" } });
    expect(status()).toBe("2 cambios sin guardar");
    fireEvent.change(input("edit-name-a"), { target: { value: "Kayak" } });
    expect(status()).toBe("1 cambio sin guardar");
    expect(input("edit-name-a").dataset.dirty).toBeUndefined();
  });

  it("un champ numérique ne garde que les chiffres, groupés hors saisie seulement", () => {
    renderList();
    expect(input("edit-price-a").value).toBe("50.000");
    fireEvent.focus(input("edit-price-a"));
    expect(input("edit-price-a").value).toBe("50000");
    fireEvent.change(input("edit-price-a"), { target: { value: "65.5a00" } });
    expect(input("edit-price-a").value).toBe("65500");
    fireEvent.blur(input("edit-price-a"));
    expect(input("edit-price-a").value).toBe("65.500");
  });

  it("entrer dans un champ numérique sélectionne tout son contenu : la frappe remplace, elle ne s'ajoute pas", async () => {
    // Défaut constaté au rendu réel (2026-10-13) : dégrouper « 50.000 » en « 50000 » à l'entrée
    // annulait la sélection du navigateur, et taper 65000 donnait 5000065000 — enregistré tel quel.
    renderList();
    const field = input("edit-price-a");
    field.focus();
    await waitFor(() => expect([field.selectionStart, field.selectionEnd]).toEqual([0, 5]));
    expect(field.value).toBe("50000");
  });

  it("« Guardar cambios » transmet les seules colonnes modifiées, par ligne", async () => {
    renderList();
    fireEvent.change(input("edit-name-a"), { target: { value: "Kayak doble" } });
    fireEvent.change(input("edit-price-a"), { target: { value: "65000" } });
    fireEvent.change(input("edit-name-b"), { target: { value: "Velero azul" } });
    fireEvent.click(screen.getByTestId("save-changes-button"));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].map(({ rowId, values }) => ({ rowId, values }))).toEqual([
      { rowId: "a", values: { name: "Kayak doble", price: "65000" } },
      { rowId: "b", values: { name: "Velero azul" } },
    ]);
    await waitFor(() => expect(status()).toBe("Edita las celdas de la tabla y guarda los cambios."));
    // Entre l'écriture et le rafraîchissement serveur, la cellule affiche la valeur enregistrée.
    expect(input("edit-name-a").value).toBe("Kayak doble");
  });

  it("une ligne refusée garde sa saisie et reste comptée ; les autres sont soldées", async () => {
    onSave.mockResolvedValue({ failedRowIds: ["b"] });
    renderList();
    fireEvent.change(input("edit-name-a"), { target: { value: "Kayak doble" } });
    fireEvent.change(input("edit-name-b"), { target: { value: "Velero azul" } });
    fireEvent.click(screen.getByTestId("save-changes-button"));
    await waitFor(() => expect(status()).toBe("1 cambio sin guardar"));
    expect(input("edit-name-b").value).toBe("Velero azul");
    expect(input("edit-name-b").dataset.dirty).toBe("true");
    expect(input("edit-name-a").dataset.dirty).toBeUndefined();
  });

  it("« Descartar » rend toutes les cellules à leur valeur d'origine", () => {
    renderList();
    fireEvent.change(input("edit-name-a"), { target: { value: "Kayak doble" } });
    fireEvent.click(screen.getByTestId("discard-changes-button"));
    expect(input("edit-name-a").value).toBe("Kayak");
    expect(status()).toBe("Edita las celdas de la tabla y guarda los cambios.");
  });
});

// Cellule à sélection multiple (les étiquettes du catálogo) : recherche, et création à la volée
// quand la colonne fournit `onCreateOption` (demande Jérôme, 2026-10-13).
describe("DataList — sélection multiple avec création", () => {
  type TagRow = { id: string; name: string; tagIds: string[] };
  type Option = { value: string; label: string };
  const TAG_ROWS: TagRow[] = [{ id: "a", name: "Kayak", tagIds: ["agua"] }];
  const OPTIONS: Option[] = [
    { value: "agua", label: "Agua" },
    { value: "senal", label: "Señalética" },
  ];
  type SaveTags = (changes: DataListRowChange<TagRow>[]) => Promise<DataListSaveResult>;
  const onSaveTags = vi.fn<SaveTags>();
  const onCreateOption = vi.fn<(label: string) => Promise<Option | null>>();
  const onManage = vi.fn();

  // Comme ProductsList : l'appelant ajoute l'option créée à `options`, la cellule ne la mémorise pas.
  function TagList({ canCreate = true }: { canCreate?: boolean }) {
    const [options, setOptions] = useState(OPTIONS);
    const columns: DataListColumn<TagRow>[] = [
      { id: "name", header: "Nombre" },
      {
        id: "tags",
        header: "Etiquetas",
        edit: {
          value: (row) => row.tagIds,
          editor: {
            kind: "multiselect",
            options,
            emptyLabel: "Sin etiquetas",
            onCreateOption: canCreate
              ? async (label) => {
                  const created = await onCreateOption(label);
                  if (created) setOptions((previous) => [...previous, created]);
                  return created;
                }
              : undefined,
            manageOptions: canCreate ? { label: "Editar o eliminar etiquetas…", onOpen: onManage } : undefined,
          },
        },
      },
    ];
    return (
      <UnsavedChangesProvider>
        <EditableDataList
          rows={TAG_ROWS}
          getRowId={(row) => row.id}
          columns={columns}
          basePath="/admin/things"
          page={1}
          pageSize={20}
          totalCount={TAG_ROWS.length}
          sort={{ key: "name", direction: "asc" }}
          extraParams={{}}
          ariaLabel="Cosas"
          rowTestIdPrefix="thing"
          emptyMessage="Nada."
          onSave={onSaveTags}
        />
      </UnsavedChangesProvider>
    );
  }

  const cellText = () => screen.getByTestId("edit-tags-a").textContent;
  async function openAndType(text: string) {
    await userEvent.click(screen.getByTestId("edit-tags-a"));
    await userEvent.type(await screen.findByTestId("edit-tags-a-search"), text);
  }

  beforeEach(() => {
    onSaveTags.mockReset();
    onSaveTags.mockResolvedValue({ failedRowIds: [] });
    onCreateOption.mockReset();
    onManage.mockReset();
  });

  it("la recherche ignore casse et accents, et ne propose pas de créer un libellé qui existe", async () => {
    render(<TagList />);
    await openAndType("SENALETICA");
    expect(await screen.findByRole("option", { name: "Señalética" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Agua" })).toBeNull();
    expect(screen.queryByTestId("edit-tags-a-create")).toBeNull();
  });

  it("sans `onCreateOption`, un libellé inconnu ne propose rien", async () => {
    render(<TagList canCreate={false} />);
    await openAndType("Montaña");
    expect(await screen.findByText("Sin resultados.")).toBeTruthy();
    expect(screen.queryByTestId("edit-tags-a-create")).toBeNull();
  });

  it("« + Crear » crée, coche la nouvelle étiquette en gardant les autres, et la transmet à l'enregistrement", async () => {
    onCreateOption.mockResolvedValue({ value: "montana", label: "Montaña" });
    render(<TagList />);
    await openAndType("  Montaña ");
    await userEvent.click(await screen.findByTestId("edit-tags-a-create"));
    await waitFor(() => expect(cellText()).toBe("Agua, Montaña"));
    expect(onCreateOption).toHaveBeenCalledTimes(1);
    expect(onCreateOption).toHaveBeenCalledWith("Montaña");
    expect(status()).toBe("1 cambio sin guardar");

    fireEvent.click(screen.getByTestId("save-changes-button"));
    await waitFor(() => expect(onSaveTags).toHaveBeenCalledTimes(1));
    expect(onSaveTags.mock.calls[0][0][0].values).toEqual({ tags: ["agua", "montana"] });
  });

  it("« gérer les options » referme la liste et rend la main à l'appelant, sans toucher au brouillon", async () => {
    render(<TagList />);
    await userEvent.click(screen.getByTestId("edit-tags-a"));
    await userEvent.click(await screen.findByTestId("edit-tags-a-manage"));
    expect(onManage).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("edit-tags-a-search")).toBeNull());
    expect(cellText()).toBe("Agua");
    expect(status()).toBe("Edita las celdas de la tabla y guarda los cambios.");
  });

  it("sans `manageOptions`, la liste ne propose pas de gérer", async () => {
    render(<TagList canCreate={false} />);
    await userEvent.click(screen.getByTestId("edit-tags-a"));
    await screen.findByTestId("edit-tags-a-search");
    expect(screen.queryByTestId("edit-tags-a-manage")).toBeNull();
  });

  it("une création refusée ne touche pas à la sélection", async () => {
    onCreateOption.mockResolvedValue(null);
    render(<TagList />);
    await openAndType("Otras");
    await userEvent.click(await screen.findByTestId("edit-tags-a-create"));
    await waitFor(() => expect(onCreateOption).toHaveBeenCalledWith("Otras"));
    expect(cellText()).toBe("Agua");
    expect(status()).toBe("Edita las celdas de la tabla y guarda los cambios.");
  });

  it("cocher une option filtrée garde celles que le filtre masque", async () => {
    render(<TagList />);
    await openAndType("señ");
    await userEvent.click(await screen.findByRole("option", { name: "Señalética" }));
    await waitFor(() => expect(cellText()).toBe("Agua, Señalética"));
  });
});

describe("Garde-fou « cambios sin guardar »", () => {
  it("sans modification, un lien n'est pas retenu", () => {
    renderList();
    expect(clickNav()).toBe(false);
    expect(screen.queryByTestId("unsaved-changes-dialog")).toBeNull();
  });

  it("un clic modifié (nouvel onglet) n'est jamais retenu : la page courante reste ouverte", () => {
    renderList();
    fireEvent.change(input("edit-name-a"), { target: { value: "Kayak doble" } });
    expect(clickNav({ ctrlKey: true })).toBe(false);
    expect(screen.queryByTestId("unsaved-changes-dialog")).toBeNull();
  });

  it("avec une cellule modifiée, le lien est retenu ; « Seguir editando » garde la saisie", async () => {
    renderList();
    fireEvent.change(input("edit-name-a"), { target: { value: "Kayak doble" } });
    expect(clickNav()).toBe(true);
    await screen.findByTestId("unsaved-changes-dialog");
    fireEvent.click(screen.getByTestId("unsaved-stay-button"));
    await waitFor(() => expect(screen.queryByTestId("unsaved-changes-dialog")).toBeNull());
    expect(router.push).not.toHaveBeenCalled();
    expect(input("edit-name-a").value).toBe("Kayak doble");
  });

  it("« Descartar y salir » abandonne la saisie, n'écrit rien, puis va à la destination", async () => {
    renderList();
    fireEvent.change(input("edit-name-a"), { target: { value: "Kayak doble" } });
    clickNav();
    fireEvent.click(await screen.findByTestId("unsaved-discard-button"));
    expect(router.push).toHaveBeenCalledWith("/admin/tags");
    expect(onSave).not.toHaveBeenCalled();
    expect(input("edit-name-a").value).toBe("Kayak");
  });

  it("« Guardar y salir » enregistre d'abord, puis va à la destination", async () => {
    renderList();
    fireEvent.change(input("edit-name-a"), { target: { value: "Kayak doble" } });
    clickNav();
    fireEvent.click(await screen.findByTestId("unsaved-save-button"));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/admin/tags"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("« Guardar y salir » reste sur place si une ligne est refusée", async () => {
    onSave.mockResolvedValue({ failedRowIds: ["a"] });
    renderList();
    fireEvent.change(input("edit-name-a"), { target: { value: "Kayak doble" } });
    clickNav();
    fireEvent.click(await screen.findByTestId("unsaved-save-button"));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("unsaved-changes-dialog")).toBeNull());
    expect(router.push).not.toHaveBeenCalled();
    expect(input("edit-name-a").value).toBe("Kayak doble");
  });
});
