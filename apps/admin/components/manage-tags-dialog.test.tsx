import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Renommer / supprimer une étiquette depuis un sélecteur (2026-10-13). Ce fichier prouve ce que le
// typecheck ne voit pas : qu'un refus ne change rien à l'écran, qu'on ne supprime pas avant d'avoir
// lu ce que la suppression retire, et que le sélecteur hôte lâche l'étiquette supprimée.

const renameCatalogTag = vi.fn<(id: string, label: string) => Promise<string | null>>();
const deleteCatalogTag = vi.fn<(id: string) => Promise<string | null>>();
const countCatalogTagUsage =
  vi.fn<(id: string) => Promise<{ products: number; establishments: number } | null>>();
vi.mock("@/lib/tags/editCatalogTag", () => ({ renameCatalogTag, deleteCatalogTag, countCatalogTagUsage }));
vi.mock("@/lib/tags/createCatalogTag", () => ({ createCatalogTag: vi.fn() }));

const { TagsMultiSelect } = await import("./tags-multiselect");

const TAGS = [
  { id: "agua", label: "Agua" },
  { id: "arte", label: "Arte" },
];

const onChange = vi.fn<(ids: string[]) => void>();

function Picker({ allowCreate }: { allowCreate?: boolean }) {
  const [selected, setSelected] = useState(["agua", "arte"]);
  return (
    <TagsMultiSelect
      availableTags={TAGS}
      selectedTagIds={selected}
      onChange={(ids) => {
        onChange(ids);
        setSelected(ids);
      }}
      allowCreate={allowCreate}
    />
  );
}

const chips = () => screen.getByTestId("tags-multiselect-selected").textContent;
const open = () => userEvent.click(screen.getByTestId("tags-multiselect-manage"));

beforeEach(() => {
  renameCatalogTag.mockReset();
  deleteCatalogTag.mockReset();
  countCatalogTagUsage.mockReset();
  onChange.mockReset();
});

describe("TagsMultiSelect — renommer ou supprimer une étiquette", () => {
  it("sans droit de création (socio, équipements), le sélecteur ne propose pas de gérer", () => {
    render(<Picker allowCreate={false} />);
    expect(screen.queryByTestId("tags-multiselect-manage")).toBeNull();
  });

  it("renommer écrit le nouveau nom et le montre dans le sélecteur, sans toucher à la sélection", async () => {
    renameCatalogTag.mockResolvedValue(null);
    render(<Picker />);
    await open();
    await userEvent.click(await screen.findByTestId("manage-tag-rename-agua"));
    const input = screen.getByTestId("manage-tag-input-agua");
    await userEvent.clear(input);
    await userEvent.type(input, " Lago ");
    await userEvent.click(screen.getByTestId("manage-tag-save-agua"));

    await waitFor(() => expect(chips()).toContain("Lago"));
    expect(renameCatalogTag).toHaveBeenCalledWith("agua", "Lago");
    expect(chips()).not.toContain("Agua");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("un renommage refusé laisse le nom et le champ en place", async () => {
    renameCatalogTag.mockResolvedValue("Ya existe una etiqueta con ese nombre.");
    render(<Picker />);
    await open();
    await userEvent.click(await screen.findByTestId("manage-tag-rename-agua"));
    await userEvent.type(screen.getByTestId("manage-tag-input-agua"), "x");
    await userEvent.click(screen.getByTestId("manage-tag-save-agua"));

    await waitFor(() => expect(renameCatalogTag).toHaveBeenCalledWith("agua", "Aguax"));
    expect(screen.getByTestId("manage-tag-input-agua")).toBeTruthy();
    expect(chips()).toContain("Agua");
  });

  it("un nom inchangé ne déclenche aucune écriture", async () => {
    render(<Picker />);
    await open();
    await userEvent.click(await screen.findByTestId("manage-tag-rename-agua"));
    await userEvent.click(screen.getByTestId("manage-tag-save-agua"));
    await waitFor(() => expect(screen.queryByTestId("manage-tag-input-agua")).toBeNull());
    expect(renameCatalogTag).not.toHaveBeenCalled();
  });

  it("supprimer annonce ce qui sera retiré, puis retire l'étiquette de la sélection de l'hôte", async () => {
    let resolveUsage: (usage: { products: number; establishments: number }) => void = () => {};
    countCatalogTagUsage.mockReturnValue(new Promise((resolve) => (resolveUsage = resolve)));
    deleteCatalogTag.mockResolvedValue(null);
    render(<Picker />);
    await open();
    await userEvent.click(await screen.findByTestId("manage-tag-delete-agua"));

    // Tant que le comptage n'est pas revenu, la suppression reste verrouillée.
    const confirm = screen.getByTestId("manage-tag-confirm-delete-agua") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(deleteCatalogTag).not.toHaveBeenCalled();

    resolveUsage({ products: 3, establishments: 1 });
    await waitFor(() =>
      expect(screen.getByTestId("manage-tag-warning-agua").textContent).toBe(
        "Se quitará de 3 actividades y 1 establecimiento. Esta acción no se puede deshacer."
      )
    );
    await userEvent.click(confirm);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["arte"]));
    expect(deleteCatalogTag).toHaveBeenCalledWith("agua");
    expect(chips()).toBe("Arte");
    expect(screen.queryByTestId("manage-tag-agua")).toBeNull();
  });

  it("une suppression refusée ne retire rien", async () => {
    countCatalogTagUsage.mockResolvedValue(null);
    deleteCatalogTag.mockResolvedValue("No se pudo eliminar la etiqueta.");
    render(<Picker />);
    await open();
    await userEvent.click(await screen.findByTestId("manage-tag-delete-agua"));
    await waitFor(() =>
      expect(screen.getByTestId("manage-tag-warning-agua").textContent).toContain("todas las fichas")
    );
    await userEvent.click(screen.getByTestId("manage-tag-confirm-delete-agua"));

    await waitFor(() => expect(deleteCatalogTag).toHaveBeenCalledWith("agua"));
    expect(onChange).not.toHaveBeenCalled();
    expect(chips()).toContain("Agua");
  });
});
