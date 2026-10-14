"use client";

import { useMemo, useState } from "react";
import { Button, Input, Label, Modal, TextField, toast } from "@hifago/ui";
import { countCatalogTagUsage, deleteCatalogTag, renameCatalogTag } from "@/lib/tags/editCatalogTag";
import { tagMatchesQuery } from "@/lib/tags/tagSlug";

export type ManagedTag = { id: string; label: string };

export type CatalogUsage = { products: number; establishments: number };

/**
 * Ce que le dialogue renomme et supprime. Une étiquette (`TAG_EDITOR`, le défaut) et un équipement
 * (`AMENITY_EDITOR`, lib/amenities/editCatalogAmenity.ts) partagent le même dialogue : seuls les
 * écritures, les textes et les langues renommées changent.
 */
export type CatalogItemEditor = {
  texts: { manage: string; title: string; search: string; empty: string; renamed: string; deleted: string };
  /** Les champs du renommage, dans l'ordre ; `es` d'abord, toujours (c'est le libellé affiché). */
  languages: readonly { key: string; label: string }[];
  /** Libellés actuels des langues autres que `es` (le sélecteur ne porte que `es`). */
  loadLabels?: (id: string) => Promise<Record<string, string> | null>;
  rename: (id: string, labels: Record<string, string>) => Promise<string | null>;
  remove: (id: string) => Promise<string | null>;
  countUsage: (id: string) => Promise<CatalogUsage | null>;
  /** `undefined` : comptage en cours ; `null` : comptage impossible (jamais un zéro rassurant). */
  usageWarning: (usage: CatalogUsage | null | undefined) => string;
};

type ActiveRow =
  // `drafts` absent : libellés en cours de lecture (`loadLabels`).
  | { id: string; mode: "rename"; drafts?: Record<string, string>; original?: Record<string, string> }
  // `usage` : undefined = comptage en cours, null = comptage impossible.
  | { id: string; mode: "delete"; usage?: CatalogUsage | null };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const TAG_EDITOR: CatalogItemEditor = {
  texts: {
    manage: "Editar o eliminar etiquetas",
    title: "Editar o eliminar etiquetas",
    search: "Buscar una etiqueta",
    empty: "Ninguna etiqueta.",
    renamed: "Etiqueta renombrada.",
    deleted: "Etiqueta eliminada.",
  },
  languages: [{ key: "es", label: "Nombre" }],
  rename: (id, labels) => renameCatalogTag(id, labels.es ?? ""),
  remove: deleteCatalogTag,
  countUsage: countCatalogTagUsage,
  usageWarning(usage) {
    if (usage === undefined) return "Comprobando dónde se usa…";
    if (usage === null) return "Se quitará de todas las fichas que la usan. Esta acción no se puede deshacer.";
    const parts = [
      usage.products > 0 ? plural(usage.products, "actividad", "actividades") : null,
      usage.establishments > 0 ? plural(usage.establishments, "establecimiento", "establecimientos") : null,
    ].filter(Boolean);
    return parts.length > 0
      ? `Se quitará de ${parts.join(" y ")}. Esta acción no se puede deshacer.`
      : "Ninguna ficha la usa. Esta acción no se puede deshacer.";
  },
};

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
  editor = TAG_EDITOR,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  tags: ManagedTag[];
  onRenamed: (tagId: string, label: string) => void;
  onDeleted: (tagId: string) => void;
  editor?: CatalogItemEditor;
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

  async function startRename(tag: ManagedTag) {
    if (!editor.loadLabels) {
      setActive({ id: tag.id, mode: "rename", drafts: { es: tag.label }, original: { es: tag.label } });
      return;
    }
    setActive({ id: tag.id, mode: "rename" });
    const loaded = await editor.loadLabels(tag.id);
    if (!loaded) {
      toast.danger("No se pudieron leer los nombres actuales. Inténtalo de nuevo.");
      setActive((current) => (current?.id === tag.id && current.mode === "rename" ? null : current));
      return;
    }
    const labels: Record<string, string> = Object.fromEntries(
      editor.languages.map(({ key }) => [key, loaded[key] ?? ""])
    );
    labels.es = tag.label;
    // L'admin a pu annuler ou passer à une autre ligne pendant la lecture.
    setActive((current) =>
      current?.id === tag.id && current.mode === "rename" ? { ...current, drafts: labels, original: labels } : current
    );
  }

  async function startDelete(tagId: string) {
    setActive({ id: tagId, mode: "delete" });
    const usage = await editor.countUsage(tagId);
    // L'admin a pu annuler ou passer à une autre ligne pendant le comptage.
    setActive((current) => (current?.id === tagId && current.mode === "delete" ? { ...current, usage } : current));
  }

  async function confirmRename(tag: ManagedTag, drafts: Record<string, string>, original: Record<string, string>) {
    const labels: Record<string, string> = Object.fromEntries(
      editor.languages.map(({ key }) => [key, (drafts[key] ?? "").trim()])
    );
    if (editor.languages.every(({ key }) => labels[key] === (original[key] ?? "").trim())) {
      setActive(null);
      return;
    }
    setIsSubmitting(true);
    const error = await editor.rename(tag.id, labels);
    setIsSubmitting(false);
    if (error) {
      toast.danger(error);
      return;
    }
    toast.success(editor.texts.renamed);
    setActive(null);
    onRenamed(tag.id, labels.es);
  }

  async function confirmDelete(tag: ManagedTag) {
    setIsSubmitting(true);
    const error = await editor.remove(tag.id);
    setIsSubmitting(false);
    if (error) {
      toast.danger(error);
      return;
    }
    toast.success(editor.texts.deleted);
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
              <Modal.Heading>{editor.texts.title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              <p className="text-sm text-muted">
                Los cambios se aplican de inmediato y en todo el catálogo, no solo en esta ficha.
              </p>
              <TextField fullWidth value={query} onChange={setQuery} aria-label={editor.texts.search}>
                <Input placeholder={`${editor.texts.search}…`} data-testid="manage-tags-search" />
              </TextField>
              {visibleTags.length === 0 ? (
                <p className="text-sm text-muted" data-testid="manage-tags-empty">
                  {editor.texts.empty}
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border" data-testid="manage-tags-list">
                  {visibleTags.map((tag) => {
                    const row = active?.id === tag.id ? active : null;
                    return (
                      <li key={tag.id} className="flex flex-col gap-2 py-2" data-testid={`manage-tag-${tag.id}`}>
                        {row?.mode === "rename" && !row.drafts ? (
                          <p className="text-sm text-muted" data-testid={`manage-tag-loading-${tag.id}`}>
                            Cargando los nombres actuales…
                          </p>
                        ) : row?.mode === "rename" && row.drafts ? (
                          <form
                            noValidate
                            className="flex flex-col gap-2 md:flex-row md:items-end"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void confirmRename(tag, row.drafts ?? {}, row.original ?? {});
                            }}
                          >
                            {editor.languages.map(({ key, label }, index) => (
                              <TextField
                                key={key}
                                fullWidth
                                autoFocus={index === 0}
                                value={row.drafts?.[key] ?? ""}
                                onChange={(value) =>
                                  setActive({ ...row, drafts: { ...(row.drafts ?? {}), [key]: value } })
                                }
                              >
                                <Label>{label}</Label>
                                <Input
                                  data-testid={
                                    key === "es" ? `manage-tag-input-${tag.id}` : `manage-tag-input-${tag.id}-${key}`
                                  }
                                />
                              </TextField>
                            ))}
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
                                {editor.usageWarning(row.usage)}
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
                                onClick={() => void startRename(tag)}
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
