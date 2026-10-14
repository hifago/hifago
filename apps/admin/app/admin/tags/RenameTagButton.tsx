"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Modal, TextField, toast } from "@hifago/ui";
import { renameCatalogTag } from "@/lib/tags/editCatalogTag";

export function RenameTagButton({ tagId, currentLabel }: { tagId: string; currentLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [labelEs, setLabelEs] = useState(currentLabel);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRename() {
    setIsSubmitting(true);
    const error = await renameCatalogTag(tagId, labelEs);
    setIsSubmitting(false);

    if (error) {
      toast.danger(error);
      return;
    }

    toast.success("Tag renombrado.");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setLabelEs(currentLabel);
          setOpen(true);
        }}
        data-testid={`rename-tag-${tagId}`}
        className="text-sm font-medium text-foreground hover:underline"
      >
        Editar
      </button>
      <Modal>
        <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Renombrar etiqueta</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-4">
                <TextField fullWidth value={labelEs} onChange={setLabelEs} isRequired>
                  <Label>Nombre</Label>
                  <Input data-testid="rename-tag-input" />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  isDisabled={isSubmitting}
                  onPress={handleRename}
                  data-testid={`confirm-rename-tag-${tagId}`}
                >
                  {isSubmitting ? "Guardando…" : "Guardar"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}
