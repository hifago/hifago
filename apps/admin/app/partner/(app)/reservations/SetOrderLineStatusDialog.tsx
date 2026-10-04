"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { Button, Label, Modal, TextArea, TextField, toast, useOverlayState } from "@hifago/ui";
import { rpcErrorMessage } from "@/lib/errors/rpcErrorMessage";

const COPY: Record<"no_show" | "cancelled_by_provider", { heading: string; success: string; confirmLabel: string }> = {
  no_show: {
    heading: "Cliente no vino",
    success: "Reserva marcada como ausencia.",
    confirmLabel: "Confirmar",
  },
  cancelled_by_provider: {
    heading: "Cancelar reserva",
    success: "Reserva cancelada.",
    confirmLabel: "Cancelar reserva",
  },
};

// Spec 20 §0 — généralise NoShowDialog.tsx (spec 19 Tranche 0) pour couvrir aussi
// cancelled_by_provider (élargissement d'autorisation operator, migration 20260818180000) sans
// dupliquer une troisième fois une modale quasi identique. Réutilisé par ReservationsTable.tsx
// (bouton "Cliente no vino") et par la fiche de réservation /partner/reservations/[id]
// (ReservationActions.tsx, les deux actions).
export function SetOrderLineStatusDialog({
  orderLineId,
  targetStatus,
  open,
  onOpenChange,
  onSuccess,
}: {
  orderLineId: string;
  targetStatus: "no_show" | "cancelled_by_provider";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const copy = COPY[targetStatus];

  function reset() {
    setReason("");
  }

  const state = useOverlayState({
    isOpen: open,
    onOpenChange: (next) => {
      if (!next) reset();
      onOpenChange(next);
    },
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (reason.trim() === "") {
      toast.danger("El motivo es obligatorio.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("set_order_line_status", {
      p_order_line_id: orderLineId,
      p_new_status: targetStatus,
      p_reason: reason.trim(),
    });
    setIsSubmitting(false);

    if (rpcError || !(data as { ok: boolean } | null)?.ok) {
      toast.danger(rpcErrorMessage(rpcError, "No se pudo actualizar la reserva."));
      return;
    }

    toast.success(copy.success);
    onSuccess();
    reset();
    onOpenChange(false);
  }

  return (
    <Modal state={state}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{copy.heading}</Modal.Heading>
            </Modal.Header>
            <form onSubmit={handleSubmit} noValidate>
              <Modal.Body className="flex flex-col gap-4">
                <TextField fullWidth isRequired value={reason} onChange={setReason}>
                  <Label>Motivo</Label>
                  <TextArea name="status-reason" data-testid="status-reason-input" />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button type="submit" isDisabled={isSubmitting} data-testid="confirm-status-button">
                  {isSubmitting ? "Guardando…" : copy.confirmLabel}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
