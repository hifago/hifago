"use client";

import { TagsMultiSelect, type TagOption } from "@/components/tags-multiselect";
import { AMENITY_EDITOR } from "@/lib/amenities/editCatalogAmenity";
import { useAssignmentToggle } from "@/components/use-assignment-toggle";

// Bloc séparé du formulaire d'édition — même patron que ProductTagsBlock.tsx/ProductStatusBlock.tsx :
// action distincte, sauvegarde immédiate par ajout/retrait, pas un champ de plus dans le submit
// principal d'EditProductForm. La mécanique insert/delete vit désormais dans `useAssignmentToggle`
// (revue de packaging admin, 2026-09-17).
//
// Copie littérale de `ProductTagsBlock.tsx` — `catalog_amenities`/`product_amenity_assignments` au
// lieu de `catalog_tags`/`product_tag_assignments`. Monté uniquement quand `hasAmenities` (lodging),
// cf. `productTypeGating.ts` et `page.tsx`.
//
// ⚠️ `allowCreate={false}` — LISTE FERMÉE, même raison que EstablishmentAmenitiesBlock.tsx.
export function ProductAmenitiesBlock({
  productId,
  allAmenities,
  initialAmenityIds,
}: {
  productId: string;
  allAmenities: TagOption[];
  initialAmenityIds: string[];
}) {
  const { selectedIds, handleChange } = useAssignmentToggle({
    table: "product_amenity_assignments",
    entityIdColumn: "product_id",
    assignedIdColumn: "amenity_id",
    entityId: productId,
    initialAssignedIds: initialAmenityIds,
    addedMessage: "Equipamiento añadido.",
    removedMessage: "Equipamiento quitado.",
    addErrorMessage: "No se pudo añadir el equipamiento.",
    removeErrorMessage: "No se pudo quitar el equipamiento.",
  });

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <TagsMultiSelect
        availableTags={allAmenities}
        selectedTagIds={selectedIds}
        onChange={handleChange}
        allowCreate={false}
        // Liste fermée : jamais de création, mais renommer et supprimer, oui (admin seulement).
        allowManage
        manageEditor={AMENITY_EDITOR}
        label="Equipamiento"
        placeholder="Buscar equipamiento…"
        emptyMessage="Ningún equipamiento disponible."
        testId="amenities-multiselect"
      />
    </div>
  );
}
