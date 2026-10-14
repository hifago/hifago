"use client";

import { useMemo, useState } from "react";
import type { Key } from "react";
import { ComboBox, Input, Label, ListBox, Tag, TagGroup, toast } from "@hifago/ui";
import { ManageTagsDialog } from "@/components/manage-tags-dialog";
import { createCatalogTag } from "@/lib/tags/createCatalogTag";
import { isExistingTagName, tagMatchesQuery } from "@/lib/tags/tagSlug";

export type TagOption = { id: string; label: string };

const CREATE_TAG_KEY = "__create_tag__";

// Multi-sélection ET création à la volée : searchable-combobox.tsx (recherche partenaire/
// établissement, spec 03) est mono-sélection sur un catalogue déjà complet, un besoin différent —
// ici l'admin doit pouvoir créer un tag qui n'existe pas encore sans quitter le formulaire produit
// (retour Jérôme 2026-08-15, plutôt que de le renvoyer vers /admin/tags d'abord). Ajout d'un tag
// existant via ComboBox (recherche client-side, piège CLAUDE.md §11.7 : taper une requête avant de
// cliquer), retrait via TagGroup/Tag (react-aria, jamais utilisés ailleurs dans le projet avant
// cette spec — API vérifiée dans les .d.ts).
export function TagsMultiSelect({
  availableTags,
  selectedTagIds,
  onChange,
  label = "Etiquetas",
  testId = "tags-multiselect",
  emptyMessage = "Ningún tag disponible.",
  // false pour le variant socio-proposal de ProductForm (spec 15) : catalog_tags reste en
  // écriture admin-only (RLS), un socio qui déclencherait handleCreateTag échouerait
  // silencieusement — retirer l'affordance "+ Crear…" plutôt que de montrer un geste qui échoue.
  allowCreate = true,
  // Équipements structurés (migration 20260917110000) — liste fermée (`allowCreate={false}`), le
  // placeholder par défaut ("...o crear un tag") promettrait une création impossible : trouvé en
  // vérifiant l'écran réel (le texte restait identique pour Equipamiento malgré allowCreate=false,
  // défaut préexistant que `allowCreate` seul ne couvrait pas). Défaut inchangé pour ne rien
  // altérer côté tags.
  placeholder = "Buscar o crear un tag…",
  // Renommer / supprimer une étiquette depuis le sélecteur (demande Jérôme, 2026-10-13). Suit
  // `allowCreate` par défaut : même droit d'écriture sur `catalog_tags` (admin-only), donc mêmes
  // écrans — jamais le socio, jamais les équipements (liste fermée, autre table).
  allowManage = allowCreate,
}: {
  availableTags: TagOption[];
  selectedTagIds: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  testId?: string;
  emptyMessage?: string;
  allowCreate?: boolean;
  placeholder?: string;
  allowManage?: boolean;
}) {
  const [query, setQuery] = useState("");
  // Tags créés depuis ce composant pendant sa durée de vie — le parent (Server Component) n'a pas
  // besoin de refetch/rafraîchir pour que le tag nouvellement créé reste sélectionnable ensuite.
  const [localTags, setLocalTags] = useState<TagOption[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  // Renommages et suppressions faits depuis le dialogue : appliqués par-dessus `availableTags`, que
  // le parent (Server Component) ne relit pas tant que la page n'est pas rechargée.
  const [renamedLabels, setRenamedLabels] = useState<Record<string, string>>({});
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [isManaging, setIsManaging] = useState(false);

  const allTags = useMemo(
    () =>
      [...availableTags, ...localTags]
        .filter((tag) => !deletedIds.includes(tag.id))
        .map((tag) => (tag.id in renamedLabels ? { ...tag, label: renamedLabels[tag.id] } : tag)),
    [availableTags, localTags, renamedLabels, deletedIds],
  );

  const selectedTags = useMemo(
    () =>
      selectedTagIds
        .map((id) => allTags.find((t) => t.id === id))
        .filter((t): t is TagOption => !!t),
    [selectedTagIds, allTags],
  );

  const selectableTags = useMemo(
    () => allTags.filter((t) => !selectedTagIds.includes(t.id)),
    [allTags, selectedTagIds],
  );

  const trimmedQuery = query.trim();

  const filtered = useMemo(
    () => (trimmedQuery ? selectableTags.filter((t) => tagMatchesQuery(t.label, trimmedQuery)) : selectableTags),
    [selectableTags, trimmedQuery],
  );

  const hasExactMatch = isExistingTagName(
    trimmedQuery,
    allTags.map((t) => t.label),
  );
  const canCreate = allowCreate && trimmedQuery.length > 0 && !hasExactMatch;

  const listItems = canCreate
    ? [...filtered, { id: CREATE_TAG_KEY, label: `+ Crear "${trimmedQuery}"` }]
    : filtered;

  async function handleCreateTag() {
    setIsCreating(true);
    const result = await createCatalogTag(trimmedQuery);
    setIsCreating(false);

    if ("error" in result) {
      toast.danger(result.error);
      return;
    }

    const created = result.tag;
    setLocalTags((prev) => [...prev, created]);
    onChange([...selectedTagIds, created.id]);
    setQuery("");
    toast.success("Tag creado.");
  }

  function handleRemove(keys: Set<Key>) {
    const removedIds = new Set(Array.from(keys, String));
    onChange(selectedTagIds.filter((id) => !removedIds.has(id)));
  }

  function handleDeleted(tagId: string) {
    setDeletedIds((previous) => [...previous, tagId]);
    // Retirée aussi de la sélection de l'hôte : un formulaire qui garderait cet identifiant
    // tenterait d'assigner une étiquette qui n'existe plus.
    if (selectedTagIds.includes(tagId)) onChange(selectedTagIds.filter((id) => id !== tagId));
  }

  return (
    <div className="flex flex-col gap-2">
      <ComboBox
        selectedKey={null}
        allowsEmptyCollection
        onSelectionChange={(key) => {
          if (!key) return;
          if (key === CREATE_TAG_KEY) {
            void handleCreateTag();
            return;
          }
          onChange([...selectedTagIds, String(key)]);
          setQuery("");
        }}
        inputValue={query}
        onInputChange={setQuery}
      >
        <Label>{label}</Label>
        <ComboBox.InputGroup>
          <Input placeholder={placeholder} data-testid={testId} />
          <ComboBox.Trigger />
        </ComboBox.InputGroup>
        <ComboBox.Popover>
          <ListBox
            items={listItems}
            renderEmptyState={() => <p className="p-2 text-sm text-muted">{emptyMessage}</p>}
          >
            {(tag: TagOption) => (
              <ListBox.Item key={tag.id} id={tag.id} textValue={tag.label}>
                {tag.label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            )}
          </ListBox>
        </ComboBox.Popover>
      </ComboBox>
      {isCreating ? <p className="text-xs text-muted">Creando…</p> : null}
      {selectedTags.length > 0 ? (
        <TagGroup aria-label={label} onRemove={handleRemove} data-testid={`${testId}-selected`}>
          <TagGroup.List items={selectedTags}>
            {(tag: TagOption) => (
              <Tag key={tag.id} id={tag.id} textValue={tag.label}>
                {tag.label}
                <Tag.RemoveButton aria-label={`Quitar ${tag.label}`} />
              </Tag>
            )}
          </TagGroup.List>
        </TagGroup>
      ) : null}
      {allowManage && allTags.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setIsManaging(true)}
            data-testid={`${testId}-manage`}
            className="self-start text-sm font-medium text-foreground hover:underline max-md:min-h-11"
          >
            Editar o eliminar etiquetas
          </button>
          <ManageTagsDialog
            isOpen={isManaging}
            onOpenChange={setIsManaging}
            tags={allTags}
            onRenamed={(tagId, label) => setRenamedLabels((previous) => ({ ...previous, [tagId]: label }))}
            onDeleted={handleDeleted}
          />
        </>
      ) : null}
    </div>
  );
}
