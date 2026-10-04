"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { Button, Label, Modal, TextArea, TextField, toast } from "@hifago/ui";
import { rpcErrorMessage } from "@/lib/errors/rpcErrorMessage";

// Spec 39 D3 — « Reembolsar » : l'admin ne parle JAMAIS à Mercado Pago depuis ici (apps/admin n'a ni
// SDK ni token). La RPC request_payment_refund met la demande en file (payment_refunds `pending`) ;
// le job payments-reconcile l'exécute au tick suivant (≤ 2 min) avec X-Idempotency-Key = l'id du
// remboursement. Même patron que ResolveEntryDialog : dialogue contrôlé, motif obligatoire côté
// client ET côté serveur, état local mis à jour par le parent.
export function RefundDialog({
  entryId,
  amountLabel,
  open,
  onOpenChange,
  onSuccess,
}: {
  entryId: string;
  amountLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function reset() {
    setNote("");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (note.trim() === "") {
      toast.danger("El motivo es obligatorio.");
      return;
    }
    setIsSubmitting(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("request_payment_refund", {
      p_entry_id: entryId,
      p_note: note.trim(),
    });
    setIsSubmitting(false);
    if (rpcError || !(data as { ok: boolean } | null)?.ok) {
      toast.danger(rpcErrorMessage(rpcError, "No se pudo solicitar el reembolso."));
      return;
    }
    toast.success("Reembolso solicitado: se ejecuta en los próximos minutos.");
    onSuccess();
    reset();
    onOpenChange(false);
  }

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={open}
        onOpenChange={(next) => {
          if (!next) reset();
          onOpenChange(next);
        }}
      >
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>Reembolsar {amountLabel}</Modal.Heading>
            </Modal.Header>
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              <Modal.Body className="flex flex-col gap-4">
                <p className="text-sm text-muted">
                  El reembolso es íntegro y se envía a Mercado Pago por el job de conciliación. Si
                  prefieres volver a reservar para el cliente, usa « Resolver » con una nota.
                </p>
                <TextField fullWidth isRequired value={note} onChange={setNote}>
                  <Label htmlFor="refund-note">Motivo del reembolso</Label>
                  <TextArea id="refund-note" name="refund-note" data-testid="refund-note-input" />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button type="submit" isDisabled={isSubmitting} data-testid="confirm-refund-button">
                  {isSubmitting ? "Enviando…" : "Reembolsar"}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
