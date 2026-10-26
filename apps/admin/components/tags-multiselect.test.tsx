import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// L'étiquette principale (migration 20261025100000) : la PREMIÈRE de la sélection est la seule qui
// classe la carte dans la vitrine. Ce fichier prouve que le sélecteur le dit — sur la bonne
// étiquette, et seulement quand on le lui demande (jamais sur les équipements).

// jsdom n'implémente pas `CSS.escape`, que react-aria appelle en retirant une étiquette — même
// polyfill standard que ProductAmenitiesBlock.test.tsx.
if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
  globalThis.CSS = { ...globalThis.CSS, escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&") };
}

vi.mock("@/lib/tags/editCatalogTag", () => ({
  renameCatalogTag: vi.fn(),
  deleteCatalogTag: vi.fn(),
  countCatalogTagUsage: vi.fn(),
}));
vi.mock("@/lib/tags/createCatalogTag", () => ({ createCatalogTag: vi.fn() }));

const { TagsMultiSelect, PRIMARY_TAG_HINT } = await import("./tags-multiselect");

// Ordre de sélection volontairement opposé à l'ordre alphabétique : « Náutica » est la principale.
const TAGS = [
  { id: "adrenalina", label: "Adrenalina" },
  { id: "nautica", label: "Náutica" },
];

function Picker({ markPrimary, initial }: { markPrimary?: boolean; initial: string[] }) {
  const [selected, setSelected] = useState(initial);
  return (
    <TagsMultiSelect
      availableTags={TAGS}
      selectedTagIds={selected}
      onChange={setSelected}
      allowCreate={false}
      testId="tags"
      markPrimary={markPrimary}
    />
  );
}

describe("TagsMultiSelect — étiquette principale", () => {
  it("marque la PREMIÈRE étiquette de la sélection, pas la première par ordre alphabétique", () => {
    render(<Picker markPrimary initial={["nautica", "adrenalina"]} />);
    const principal = screen.getAllByTestId("tags-principal");
    expect(principal).toHaveLength(1);
    expect(principal[0].closest("[role='row']")?.textContent).toContain("Náutica");
    expect(screen.getByText(PRIMARY_TAG_HINT)).toBeTruthy();
  });

  it("retirer la principale fait de la suivante la nouvelle principale", async () => {
    render(<Picker markPrimary initial={["nautica", "adrenalina"]} />);
    // react-aria complète le nom du bouton par le libellé de la ligne : « Quitar Náutica Náutica (principal) ».
    await userEvent.click(screen.getByRole("button", { name: /^Quitar Náutica/ }));
    const group = screen.getByTestId("tags-selected");
    expect(within(group).getByTestId("tags-principal").closest("[role='row']")?.textContent).toContain(
      "Adrenalina",
    );
  });

  it("sans `markPrimary` (équipements), ni pastille ni explication", () => {
    render(<Picker initial={["nautica", "adrenalina"]} />);
    expect(screen.queryByTestId("tags-principal")).toBeNull();
    expect(screen.queryByText(PRIMARY_TAG_HINT)).toBeNull();
  });
});
