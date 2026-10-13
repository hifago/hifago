"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, toast } from "@hifago/ui";
import { deleteCatalogTag } from "@/lib/tags/editCatalogTag";

// Mirroir de apps/admin/app/admin/invitations/RevokeInvitationButton.tsx — pattern déjà utilisé
// dans le projet pour une confirmation destructive (Modal + Button variant="danger"), pas
// AlertDialog (jamais consommé nulle part malgré sa présence dans @heroui/react).
export function DeleteTagButton({
  tagId,
  label,
  usageCount,
}: {
  tagId: string;
  label: string;
  usageCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleDelete() {
    setIsSubmitting(true);

    const deleteError = await deleteCatalogTag(tagId);

    setIsSubmitting(false);

    if (deleteError) {
      toast.danger(deleteError);
      return;
    }

    toast.success("Tag eliminado.");
    setOpen(false);
    // docs/specs/10-listes-standardisees-admin-socio.md — Eliminar vit désormais uniquement sur
    // la fiche /admin/tags/[id] (jamais sur la liste) : router.push nécessaire pour ne pas rester
    // sur une route dont la donnée vient de disparaître (router.refresh() seul y afficherait un
    // 404). Sans effet sur un éventuel appel resté sur la liste elle-même (même route).
    router.push("/admin/tags");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={`delete-tag-${tagId}`}
        className="text-sm font-medium text-danger hover:underline"
      >
        Eliminar
      </button>
      <Modal>
        <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Eliminar etiqueta</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-4">
                <p className="text-sm text-muted">
                  {usageCount > 0
                    ? `"${label}" será retirada de ${usageCount} actividad${usageCount > 1 ? "es" : ""}. Esta acción no se puede deshacer.`
                    : `Esta acción no se puede deshacer.`}
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="danger"
                  isDisabled={isSubmitting}
                  onPress={handleDelete}
                  data-testid={`confirm-delete-tag-${tagId}`}
                >
                  {isSubmitting ? "Eliminando…" : "Eliminar"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}
