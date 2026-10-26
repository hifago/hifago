"use client";

import { TagsMultiSelect, type TagOption } from "@/components/tags-multiselect";
import { useAssignmentToggle } from "@/components/use-assignment-toggle";

// Bloc séparé du formulaire d'édition — même patron que ProductStatusBlock.tsx/
// ProductPhotosBlock.tsx : action distincte, sauvegarde immédiate par ajout/retrait, pas un champ
// de plus dans le submit principal d'EditProductForm. La mécanique insert/delete vit désormais
// dans `useAssignmentToggle` (revue de packaging admin, 2026-09-17), partagée avec
// EstablishmentTagsBlock.tsx/ProductAmenitiesBlock.tsx/EstablishmentAmenitiesBlock.tsx.
export function ProductTagsBlock({
  productId,
  allTags,
  initialTagIds,
}: {
  productId: string;
  allTags: TagOption[];
  initialTagIds: string[];
}) {
  const { selectedIds, handleChange } = useAssignmentToggle({
    table: "product_tag_assignments",
    entityIdColumn: "product_id",
    assignedIdColumn: "tag_id",
    entityId: productId,
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
