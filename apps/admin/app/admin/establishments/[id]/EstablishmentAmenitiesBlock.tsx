"use client";

import { TagsMultiSelect, type TagOption } from "@/components/tags-multiselect";
import { AMENITY_EDITOR } from "@/lib/amenities/editCatalogAmenity";
import { useAssignmentToggle } from "@/components/use-assignment-toggle";

// Bloc séparé du formulaire d'édition — même patron que EstablishmentTagsBlock.tsx : action
// distincte, sauvegarde immédiate par ajout/retrait, pas un champ de plus dans un submit.
//
// Copie littérale de `EstablishmentTagsBlock.tsx` — `catalog_amenities`/
// `establishment_amenity_assignments` au lieu de `catalog_tags`/`establishment_tag_assignments`.
// Un établissement est TOUJOURS éligible aux équipements (même raisonnement que les tags) : aucun
// gating par type ici. La mécanique insert/delete vit désormais dans `useAssignmentToggle` (revue
// de packaging, 2026-09-17) — la duplication qui a motivé ce commentaire est résorbée.
//
// ⚠️ `allowCreate={false}` — LISTE FERMÉE (décision Jérôme du 2026-09-17, contrairement aux tags
// éditoriaux) : le référentiel `catalog_amenities` est peuplé uniquement par migration, jamais par
// un admin au quotidien. `TagsMultiSelect` désactive alors proprement la sentinelle « + Crear… »
// (vérifié en le lisant — `canCreate = allowCreate && …` court-circuite).
export function EstablishmentAmenitiesBlock({
  establishmentId,
  allAmenities,
  initialAmenityIds,
}: {
  establishmentId: string;
  allAmenities: TagOption[];
  initialAmenityIds: string[];
}) {
  const { selectedIds, handleChange } = useAssignmentToggle({
    table: "establishment_amenity_assignments",
    entityIdColumn: "establishment_id",
    assignedIdColumn: "amenity_id",
    entityId: establishmentId,
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
