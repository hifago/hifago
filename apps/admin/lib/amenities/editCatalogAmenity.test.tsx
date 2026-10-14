import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Renommer et supprimer un équipement (liste fermée) depuis l'admin, par le dialogue des étiquettes
// paramétré : deux libellés (es, en) par la RPC auditée, suppression annoncée avec ce qu'elle retire.

type Reponse = { data: unknown; error: { message: string } | null };
const etat = vi.hoisted(() => ({
  rpc: vi.fn<(nom: string, args: Record<string, unknown>) => Promise<Reponse>>(),
  libelle: { data: { label: { es: "Jacuzzi", en: "Hot tub", pt: "Banheira" } }, error: null } as Reponse,
  comptes: { product_amenity_assignments: 2, establishment_amenity_assignments: 1 } as Record<string, number>,
  comptageEnPanne: false,
  toastDanger: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({
    rpc: etat.rpc,
    from: (table: string) => {
      const requete = {
        select: () => requete,
        eq: () => requete,
        maybeSingle: async () => etat.libelle,
        then: (resoudre: (r: unknown) => unknown) =>
          resoudre(
            etat.comptageEnPanne
              ? { count: null, error: { message: "x" } }
              : { count: etat.comptes[table] ?? 0, error: null }
          ),
      };
      return requete;
    },
  }),
}));
vi.mock("@hifago/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hifago/ui")>()),
  toast: { success: etat.toastSuccess, danger: etat.toastDanger },
}));

const { AMENITY_EDITOR, renameCatalogAmenity, deleteCatalogAmenity } = await import("./editCatalogAmenity");
const { TagsMultiSelect } = await import("@/components/tags-multiselect");

const AMENITIES = [
  { id: "a-1", label: "Jacuzzi" },
  { id: "a-2", label: "Wifi" },
];

function Picker() {
  const [selected, setSelected] = useState(["a-1", "a-2"]);
  return (
    <TagsMultiSelect
      availableTags={AMENITIES}
      selectedTagIds={selected}
      onChange={setSelected}
      allowCreate={false}
      allowManage
      manageEditor={AMENITY_EDITOR}
      label="Equipamiento"
    />
  );
}

const chips = () => screen.getByTestId("tags-multiselect-selected").textContent;
const ouvrir = () => userEvent.click(screen.getByTestId("tags-multiselect-manage"));
const champ = (id: string) => screen.getByTestId(id) as HTMLInputElement;

beforeEach(() => {
  etat.rpc.mockReset();
  etat.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  etat.libelle = { data: { label: { es: "Jacuzzi", en: "Hot tub", pt: "Banheira" } }, error: null };
  etat.comptes = { product_amenity_assignments: 2, establishment_amenity_assignments: 1 };
  etat.comptageEnPanne = false;
  etat.toastDanger.mockClear();
  etat.toastSuccess.mockClear();
});

describe("renameCatalogAmenity / deleteCatalogAmenity — les RPC et leurs refus", () => {
  it("renommer passe es et en à la RPC auditée", async () => {
    expect(await renameCatalogAmenity("a-1", { es: "Jacuzzi grande", en: "Large hot tub" })).toBeNull();
    expect(etat.rpc).toHaveBeenCalledWith("admin_rename_catalog_amenity", {
      p_amenity_id: "a-1",
      p_label_es: "Jacuzzi grande",
      p_label_en: "Large hot tub",
    });
  });

  it.each([
    ["duplicate_name", "Ya existe un equipamiento con ese nombre."],
    ["label_en_required", "El nombre en inglés es obligatorio."],
    ["amenity_not_found", "Este equipamiento ya no existe."],
    ["motif_inconnu", "No se pudo renombrar el equipamiento."],
  ])("refus %s : son texte", async (reason, texte) => {
    etat.rpc.mockResolvedValue({ data: { ok: false, reason }, error: null });
    expect(await renameCatalogAmenity("a-1", { es: "X", en: "Y" })).toBe(texte);
  });

  it("panne de la RPC : texte générique, jamais le message SQL", async () => {
    etat.rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    expect(await renameCatalogAmenity("a-1", { es: "X", en: "Y" })).toBe("No se pudo renombrar el equipamiento.");
    expect(await deleteCatalogAmenity("a-1")).toBe("No se pudo eliminar el equipamiento.");
  });

  it("supprimer appelle la RPC de suppression", async () => {
    expect(await deleteCatalogAmenity("a-1")).toBeNull();
    expect(etat.rpc).toHaveBeenCalledWith("admin_delete_catalog_amenity", { p_amenity_id: "a-1" });
  });
});

describe("Dialogue « Editar o eliminar equipamiento »", () => {
  it("s'ouvre depuis le sélecteur d'équipements, avec ses propres textes", async () => {
    render(<Picker />);
    expect(screen.getByTestId("tags-multiselect-manage").textContent).toBe("Editar o eliminar equipamiento");
    await ouvrir();
    expect(await screen.findByText("Editar o eliminar equipamiento", { selector: "h2" })).toBeTruthy();
  });

  it("renommer : es et en pré-remplis (en lu en base), les deux partent, le sélecteur suit", async () => {
    render(<Picker />);
    await ouvrir();
    await userEvent.click(await screen.findByTestId("manage-tag-rename-a-1"));
    await waitFor(() => expect(champ("manage-tag-input-a-1").value).toBe("Jacuzzi"));
    expect(champ("manage-tag-input-a-1-en").value).toBe("Hot tub");

    await userEvent.clear(champ("manage-tag-input-a-1-en"));
    await userEvent.type(champ("manage-tag-input-a-1-en"), "Large hot tub");
    await userEvent.click(screen.getByTestId("manage-tag-save-a-1"));

    await waitFor(() =>
      expect(etat.rpc).toHaveBeenCalledWith("admin_rename_catalog_amenity", {
        p_amenity_id: "a-1",
        p_label_es: "Jacuzzi",
        p_label_en: "Large hot tub",
      })
    );
    expect(etat.toastSuccess).toHaveBeenCalledWith("Equipamiento renombrado.");
  });

  it("libellés inchangés : aucune écriture", async () => {
    render(<Picker />);
    await ouvrir();
    await userEvent.click(await screen.findByTestId("manage-tag-rename-a-1"));
    await waitFor(() => expect(champ("manage-tag-input-a-1-en").value).toBe("Hot tub"));
    await userEvent.click(screen.getByTestId("manage-tag-save-a-1"));
    expect(etat.rpc).not.toHaveBeenCalled();
  });

  it("lecture des libellés impossible : le dit, ne pré-remplit pas de vide", async () => {
    etat.libelle = { data: null, error: { message: "x" } };
    render(<Picker />);
    await ouvrir();
    await userEvent.click(await screen.findByTestId("manage-tag-rename-a-1"));
    await waitFor(() =>
      expect(etat.toastDanger).toHaveBeenCalledWith("No se pudieron leer los nombres actuales. Inténtalo de nuevo.")
    );
    expect(screen.queryByTestId("manage-tag-input-a-1")).toBeNull();
  });

  it("supprimer annonce ce qui sera retiré, puis retire l'équipement de la sélection", async () => {
    render(<Picker />);
    await ouvrir();
    await userEvent.click(await screen.findByTestId("manage-tag-delete-a-1"));
    await waitFor(() =>
      expect(screen.getByTestId("manage-tag-warning-a-1").textContent).toBe(
        "Se quitará de 1 establecimiento y 2 alojamientos. Esta acción no se puede deshacer."
      )
    );
    await userEvent.click(screen.getByTestId("manage-tag-confirm-delete-a-1"));
    await waitFor(() => expect(etat.rpc).toHaveBeenCalledWith("admin_delete_catalog_amenity", { p_amenity_id: "a-1" }));
    expect(etat.toastSuccess).toHaveBeenCalledWith("Equipamiento eliminado.");
    await waitFor(() => expect(chips()).not.toContain("Jacuzzi"));
  });

  it("comptage impossible : averti sans chiffre, jamais un zéro rassurant", async () => {
    etat.comptageEnPanne = true;
    render(<Picker />);
    await ouvrir();
    await userEvent.click(await screen.findByTestId("manage-tag-delete-a-1"));
    await waitFor(() =>
      expect(screen.getByTestId("manage-tag-warning-a-1").textContent).toBe(
        "Se quitará de todas las fichas que lo usan. Esta acción no se puede deshacer."
      )
    );
  });

  it("suppression refusée : rien n'est retiré", async () => {
    etat.rpc.mockResolvedValue({ data: { ok: false, reason: "amenity_not_found" }, error: null });
    render(<Picker />);
    await ouvrir();
    await userEvent.click(await screen.findByTestId("manage-tag-delete-a-1"));
    await waitFor(() => expect(screen.getByTestId("manage-tag-warning-a-1").textContent).toContain("Se quitará"));
    await userEvent.click(screen.getByTestId("manage-tag-confirm-delete-a-1"));
    await waitFor(() => expect(etat.toastDanger).toHaveBeenCalledWith("Este equipamiento ya no existe."));
    expect(chips()).toContain("Jacuzzi");
  });
});
