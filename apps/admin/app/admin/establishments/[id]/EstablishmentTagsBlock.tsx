"use client";

import { TagsMultiSelect, type TagOption } from "@/components/tags-multiselect";
import { useAssignmentToggle } from "@/components/use-assignment-toggle";

// Bloc séparé du formulaire d'édition — même patron que EstablishmentStatusBlock.tsx : action
// distincte, sauvegarde immédiate par ajout/retrait, pas un champ de plus dans un submit.
//
// Copie littérale de `ProductTagsBlock.tsx` (chantier "catégories partout", 2026-09-14) —
// `establishment_id` au lieu de `product_id`, `establishment_tag_assignments` au lieu de
// `product_tag_assignments`. Un établissement est TOUJOURS éligible aux tags (contrairement à un
// produit) : aucun gating par type ici, ce bloc se monte inconditionnellement. La mécanique
// insert/delete elle-même vit désormais dans `useAssignmentToggle` (revue de packaging, 2026-09-17).
export function EstablishmentTagsBlock({
  establishmentId,
  allTags,
  initialTagIds,
}: {
  establishmentId: string;
  allTags: TagOption[];
  initialTagIds: string[];
}) {
  const { selectedIds, handleChange } = useAssignmentToggle({
    table: "establishment_tag_assignments",
    entityIdColumn: "establishment_id",
    assignedIdColumn: "tag_id",
    entityId: establishmentId,
    initialAssignedIds: initialTagIds,
    addedMessage: "Tag añadido.",
    removedMessage: "Tag quitado.",
    addErrorMessage: "No se pudo añadir el tag.",
    removeErrorMessage: "No se pudo quitar el tag.",
  });

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <TagsMultiSelect
        availableTags={allTags}
        selectedTagIds={selectedIds}
        onChange={handleChange}
        testId="tags-multiselect"
        markPrimary
      />
    </div>
  );
}
