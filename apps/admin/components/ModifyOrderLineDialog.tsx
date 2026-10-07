"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { rpcErrorMessage } from "@/lib/errors/rpcErrorMessage";
import {
  Button,
  Input,
  Label,
  Modal,
  TextArea,
  TextField,
  toast,
  useOverlayState,
} from "@hifago/ui";

// Spec 17 §0 Tranche 1 (suite Tranche 2) — modify_order_line est admin-only et raise exception sur
// chaque garde (même style que set_order_line_status, jamais un refus jsonb souple : un seul
// appelant prévisible, cf. commentaire de tête de la migration). rpcError porte donc le message à
// afficher pour CHAQUE cas, y compris la capacité insuffisante — pas de mapping de raisons ici,
// contrairement à ChangeStatusDialog (dont la RPC, elle, renvoie un {ok:false, reason} structuré).
//
// initialEndDate non null ⇒ ligne à plage (alojamiento — la RPC ne distingue que par end_date pour
// ce garde, cf. migration 20260817220400) : deux champs
// de date (Check-in/Check-out) au lieu d'un seul, p_new_end_date transmis à la RPC. Jamais l'inverse
// (une ligne à date unique ne peut pas devenir une plage depuis cet écran — hors périmètre, refusé
// explicitement côté serveur si jamais tenté).
export function ModifyOrderLineDialog({
  orderLineId,
  initialDate,
  initialEndDate,
  initialQty,
  open,
  onOpenChange,
  onSuccess,
}: {
  orderLineId: string;
  initialDate: string;
  initialEndDate: string | null;
  initialQty: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const isRange = initialEndDate !== null;
  const [checkIn, setCheckIn] = useState(initialDate);
  const [checkOut, setCheckOut] = useState(initialEndDate ?? "");
  const [qty, setQty] = useState(String(initialQty));
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function reset() {
    setCheckIn(initialDate);
    setCheckOut(initialEndDate ?? "");
    setQty(String(initialQty));
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

    const qtyNumber = Number(qty);
    if (!Number.isInteger(qtyNumber) || qtyNumber < 1) {
      toast.danger("La cantidad debe ser un número entero mayor a 0.");
      return;
    }
    if (!checkIn) {
      toast.danger(isRange ? "La fecha de check-in es obligatoria." : "La fecha es obligatoria.");
      return;
    }
    if (isRange && !checkOut) {
      toast.danger("La fecha de check-out es obligatoria.");
      return;
    }
    if (isRange && checkOut <= checkIn) {
      toast.danger("El check-out debe ser posterior al check-in.");
      return;
    }
    if (!reason.trim()) {
      toast.danger("El motivo es obligatorio.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("modify_order_line", {
      p_order_line_id: orderLineId,
      p_new_date: checkIn,
      p_new_qty: qtyNumber,
      p_reason: reason.trim(),
      ...(isRange ? { p_new_end_date: checkOut } : {}),
    });
    setIsSubmitting(false);

    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      toast.danger(describeModifyFailure(rpcError, result?.reason));
      return;
    }

    toast.success("Reserva modificada.");
    reset();
    onOpenChange(false);
    onSuccess();
  }

  return (
    <Modal state={state}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Modificar reserva</Modal.Heading>
            </Modal.Header>
            <form onSubmit={handleSubmit} noValidate>
              <Modal.Body className="flex flex-col gap-4">
                {isRange ? (
                  <>
                    <TextField value={checkIn} onChange={setCheckIn} isRequired>
                      <Label htmlFor="modify-date">Check-in</Label>
                      <Input id="modify-date" type="date" data-testid="modify-date-input" />
                    </TextField>
                    <TextField value={checkOut} onChange={setCheckOut} isRequired>
                      <Label htmlFor="modify-end-date">Check-out</Label>
                      <Input id="modify-end-date" type="date" data-testid="modify-end-date-input" />
                    </TextField>
                  </>
                ) : (
                  <TextField value={checkIn} onChange={setCheckIn} isRequired>
                    <Label htmlFor="modify-date">Nueva fecha</Label>
                    <Input id="modify-date" type="date" data-testid="modify-date-input" />
                  </TextField>
                )}
                <TextField value={qty} onChange={setQty} isRequired>
                  <Label htmlFor="modify-qty">Nueva cantidad</Label>
                  <Input id="modify-qty" type="number" min={1} data-testid="modify-qty-input" />
                </TextField>
                <TextField value={reason} onChange={setReason} isRequired>
                  <Label htmlFor="modify-reason">Motivo</Label>
                  <TextArea id="modify-reason" data-testid="modify-reason-input" />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button type="submit" isDisabled={isSubmitting} data-testid="confirm-modify-button">
                  {isSubmitting ? "Guardando…" : "Guardar"}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

// Refus rendus par modify_order_line (20261006204938) : la prestation ne peut pas être modifiée en
// place. Les autres refus de la RPC restent des exceptions (texte générique, rpcErrorMessage).
const MODIFY_FAILURE_MESSAGES: Record<string, string> = {
  pms_line_not_modifiable:
    "Esta reserva está vinculada al PMS del alojamiento y no se puede modificar desde aquí.",
  resource_line_not_modifiable:
    "Esta reserva ocupa el espacio compartido del establecimiento y no se puede modificar.",
};

export function describeModifyFailure(
  rpcError: Parameters<typeof rpcErrorMessage>[0],
  reason: string | undefined
): string {
  if (reason && Object.hasOwn(MODIFY_FAILURE_MESSAGES, reason)) return MODIFY_FAILURE_MESSAGES[reason];
  return rpcErrorMessage(rpcError, "No se pudo modificar la reserva.");
}
