"use client";

import { useMemo, useState } from "react";
import { Button, Input, Label, Modal, TextField, toast } from "@hifago/ui";
import { countCatalogTagUsage, deleteCatalogTag, renameCatalogTag } from "@/lib/tags/editCatalogTag";
import { tagMatchesQuery } from "@/lib/tags/tagSlug";

export type ManagedTag = { id: string; label: string };

type ActiveRow =
  | { id: string; mode: "rename"; draft: string }
  // `usage` : undefined = comptage en cours, null = comptage impossible.
  | { id: string; mode: "delete"; usage?: { products: number; establishments: number } | null };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function deleteWarning(usage: { products: number; establishments: number } | null | undefined): string {
  if (usage === undefined) return "Comprobando dónde se usa…";
  if (usage === null) return "Se quitará de todas las fichas que la usan. Esta acción no se puede deshacer.";
  const parts = [
    usage.products > 0 ? plural(usage.products, "actividad", "actividades") : null,
    usage.establishments > 0 ? plural(usage.establishments, "establecimiento", "establecimientos") : null,
  ].filter(Boolean);
  return parts.length > 0
    ? `Se quitará de ${parts.join(" y ")}. Esta acción no se puede deshacer.`
    : "Ninguna ficha la usa. Esta acción no se puede deshacer.";
}

// Renommer ou supprimer une étiquette là où elle se choisit (demande Jérôme, 2026-10-13), sans
// passer par /admin/tags : ouvert depuis TagsMultiSelect (fiches, blocs, modération) et depuis la
// cellule « Etiquetas » du catálogo. Mêmes écritures que /admin/tags (lib/tags/editCatalogTag.ts).
//
// ⚠️ Chaque geste est immédiat et vaut pour TOUT le catalogue — il n'attend ni le « Guardar » du
// formulaire hôte ni « Guardar cambios » de la liste. L'hôte reçoit `onRenamed`/`onDeleted` pour
// mettre ses propres options à jour ; ce composant n'en garde aucune copie.
//
// Une seule ligne active à la fois, et la confirmation de suppression se fait DANS la ligne : pas
// de second modal empilé sur celui-ci.
export function ManageTagsDialog({
  isOpen,
  onOpenChange,
  tags,
  onRenamed,
  onDeleted,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  tags: ManagedTag[];
  onRenamed: (tagId: string, label: string) => void;
  onDeleted: (tagId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<ActiveRow | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const visibleTags = useMemo(() => {
    const sorted = [...tags].sort((a, b) => a.label.localeCompare(b.label, "es"));
    return query.trim() ? sorted.filter((tag) => tagMatchesQuery(tag.label, query)) : sorted;
  }, [tags, query]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setActive(null);
      setQuery("");
    }
    onOpenChange(next);
  }

  async function startDelete(tagId: string) {
    setActive({ id: tagId, mode: "delete" });
    const usage = await countCatalogTagUsage(tagId);
    // L'admin a pu annuler ou passer à une autre ligne pendant le comptage.
    setActive((current) => (current?.id === tagId && current.mode === "delete" ? { ...current, usage } : current));
  }

  async function confirmRename(tag: ManagedTag, draft: string) {
    const label = draft.trim();
    if (label === tag.label) {
      setActive(null);
      return;
    }
    setIsSubmitting(true);
    const error = await renameCatalogTag(tag.id, label);
    setIsSubmitting(false);
    if (error) {
      toast.danger(error);
      return;
    }
    toast.success("Etiqueta renombrada.");
    setActive(null);
    onRenamed(tag.id, label);
  }

  async function confirmDelete(tag: ManagedTag) {
    setIsSubmitting(true);
    const error = await deleteCatalogTag(tag.id);
    setIsSubmitting(false);
    if (error) {
      toast.danger(error);
      return;
    }
    toast.success("Etiqueta eliminada.");
    setActive(null);
    onDeleted(tag.id);
  }

  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={handleOpenChange}>
        <Modal.Container scroll="inside">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label="Cerrar" />
            <Modal.Header>
              <Modal.Heading>Editar o eliminar etiquetas</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              <p className="text-sm text-muted">
                Los cambios se aplican de inmediato y en todo el catálogo, no solo en esta ficha.
              </p>
              <TextField fullWidth value={query} onChange={setQuery} aria-label="Buscar una etiqueta">
                <Input placeholder="Buscar una etiqueta…" data-testid="manage-tags-search" />
              </TextField>
              {visibleTags.length === 0 ? (
                <p className="text-sm text-muted" data-testid="manage-tags-empty">
                  Ninguna etiqueta.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border" data-testid="manage-tags-list">
                  {visibleTags.map((tag) => {
                    const row = active?.id === tag.id ? active : null;
                    return (
                      <li key={tag.id} className="flex flex-col gap-2 py-2" data-testid={`manage-tag-${tag.id}`}>
                        {row?.mode === "rename" ? (
                          <form
                            noValidate
                            className="flex flex-col gap-2 md:flex-row md:items-end"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void confirmRename(tag, row.draft);
                            }}
                          >
                            <TextField
                              fullWidth
                              autoFocus
                              value={row.draft}
                              onChange={(draft) => setActive({ id: tag.id, mode: "rename", draft })}
                            >
                              <Label>Nombre</Label>
                              <Input data-testid={`manage-tag-input-${tag.id}`} />
                            </TextField>
                            <div className="flex gap-2">
                              <Button
                                type="submit"
                                isDisabled={isSubmitting}
                                data-testid={`manage-tag-save-${tag.id}`}
                              >
                                {isSubmitting ? "Guardando…" : "Guardar"}
                              </Button>
                              <Button variant="outline" isDisabled={isSubmitting} onPress={() => setActive(null)}>
                                Cancelar
                              </Button>
                            </div>
                          </form>
                        ) : row?.mode === "delete" ? (
                          <div className="flex flex-col gap-2">
                            <p className="text-sm">
                              ¿Eliminar «{tag.label}»?{" "}
                              <span className="text-muted" data-testid={`manage-tag-warning-${tag.id}`}>
                                {deleteWarning(row.usage)}
                              </span>
                            </p>
                            <div className="flex gap-2">
                              <Button
                                variant="danger"
                                // Pas de suppression tant que l'admin n'a pas lu ce qu'elle retire.
                                isDisabled={isSubmitting || row.usage === undefined}
                                onPress={() => void confirmDelete(tag)}
                                data-testid={`manage-tag-confirm-delete-${tag.id}`}
                              >
                                {isSubmitting ? "Eliminando…" : "Eliminar"}
                              </Button>
                              <Button variant="outline" isDisabled={isSubmitting} onPress={() => setActive(null)}>
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-x-4">
                            <span className="min-w-0 break-words">{tag.label}</span>
                            <div className="flex gap-4">
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => setActive({ id: tag.id, mode: "rename", draft: tag.label })}
                                data-testid={`manage-tag-rename-${tag.id}`}
                                className="text-sm font-medium text-foreground hover:underline max-md:min-h-11"
                              >
                                Renombrar
                              </button>
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => void startDelete(tag.id)}
                                data-testid={`manage-tag-delete-${tag.id}`}
                                className="text-sm font-medium text-danger hover:underline max-md:min-h-11"
                              >
                                Eliminar
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
