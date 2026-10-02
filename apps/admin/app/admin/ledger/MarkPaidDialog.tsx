"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, Modal, TextArea, TextField, toast, useOverlayState } from "@hifago/ui";
import { rpcErrorMessage } from "@/lib/errors/rpcErrorMessage";

// Même patron que ResolveEntryDialog (admin/reconciliation) : dialogue contrôlé, motif obligatoire
// vérifié côté client ET côté serveur (mark_ledger_entry_paid, spec 19 §0 Tranche 0),
// onSuccess/onOpenChange remontés au parent plutôt qu'un router.refresh(). comprobante_path reste
// un champ texte libre (URL/chemin) dans cette tranche — aucune infrastructure d'upload nouvelle
// n'est requise (cf. spec 19 §0, même simplicité déjà acceptée pour resolve_reconciliation_entry).
export function MarkPaidDialog({
  entryId,
  open,
  onOpenChange,
  onSuccess,
}: {
  entryId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [comprobantePath, setComprobantePath] = useState("");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function reset() {
    setComprobantePath("");
    setNote("");
  }

  // Dialogue piloté entièrement depuis l'extérieur (LedgerList) — même idiome que
  // ChangeStatusDialog (feature 10) : useOverlayState adapte les props open/onOpenChange reçues
  // en `state` pour <Modal>, pas de Modal.Trigger interne.
  const state = useOverlayState({
    isOpen: open,
    onOpenChange: (next) => {
      if (!next) reset();
      onOpenChange(next);
    },
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (note.trim() === "") {
      toast.danger("El motivo es obligatorio.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("mark_ledger_entry_paid", {
      p_ledger_entry_id: entryId,
      p_comprobante_path: comprobantePath.trim(),
      p_note: note.trim(),
    });
    setIsSubmitting(false);

    if (rpcError || !(data as { ok: boolean } | null)?.ok) {
      toast.danger(rpcErrorMessage(rpcError, "No se pudo marcar la entrada como pagada."));
      return;
    }

    toast.success("Entrada marcada como pagada.");
    onSuccess();
    reset();
    onOpenChange(false);
  }

  return (
    <Modal state={state}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>Marcar pagado</Modal.Heading>
            </Modal.Header>
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              <Modal.Body className="flex flex-col gap-4">
                <TextField fullWidth name="comprobante-path" value={comprobantePath} onChange={setComprobantePath}>
                  <Label>Comprobante (URL o ruta, opcional)</Label>
                  <Input data-testid="mark-paid-comprobante-input" />
                </TextField>

                <TextField fullWidth isRequired value={note} onChange={setNote}>
                  <Label htmlFor="mark-paid-note">Motivo</Label>
                  <TextArea id="mark-paid-note" name="mark-paid-note" data-testid="mark-paid-note-input" />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button type="submit" isDisabled={isSubmitting} data-testid="confirm-mark-paid-button">
                  {isSubmitting ? "Guardando…" : "Marcar pagado"}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
