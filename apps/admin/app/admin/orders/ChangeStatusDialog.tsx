"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { rpcErrorMessage } from "@/lib/errors/rpcErrorMessage";
import {
  Button,
  Label,
  ListBox,
  Modal,
  Select,
  TextArea,
  TextField,
  toast,
  useOverlayState,
} from "@hifago/ui";

// Feature 10 : jamais un retour vers reserved — seulement les 5 valeurs terminales du vocabulaire
// de la feature 8, exactement ce que set_order_line_status accepte côté serveur.
const TARGET_STATUSES = [
  { value: "fulfilled", label: "Realizada" },
  { value: "no_show", label: "Ausencia" },
  { value: "cancelled_by_client", label: "Anulada por el cliente" },
  { value: "cancelled_by_provider", label: "Anulada por el prestador" },
  { value: "expired", label: "Expirada" },
] as const;

export function ChangeStatusDialog({
  orderLineId,
  open,
  onOpenChange,
  onSuccess,
}: {
  orderLineId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (newStatus: string) => void;
}) {
  const [status, setStatus] = useState<string>("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function reset() {
    setStatus("");
    setReason("");
  }

  // Dialogue piloté entièrement depuis l'extérieur (OrdersTable) — pas de Modal.Trigger interne,
  // useOverlayState adapte simplement les props open/onOpenChange reçues en `state` pour <Modal>.
  const state = useOverlayState({
    isOpen: open,
    onOpenChange: (next) => {
      if (!next) reset();
      onOpenChange(next);
    },
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    // Motif obligatoire (pas optionnel comme set_product_sellable) : vérifié aussi côté serveur,
    // mais un message clair immédiat évite un aller-retour réseau pour une erreur évidente.
    if (!status || reason.trim() === "") {
      toast.danger("El estado y el motivo son obligatorios.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("set_order_line_status", {
      p_order_line_id: orderLineId,
      p_new_status: status,
      p_reason: reason.trim(),
    });
    setIsSubmitting(false);

    if (rpcError || !(data as { ok: boolean } | null)?.ok) {
      toast.danger(rpcErrorMessage(rpcError, "No se pudo cambiar el estado."));
      return;
    }

    toast.success("Estado actualizado.");
    onSuccess(status);
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
              <Modal.Heading>Cambiar estado</Modal.Heading>
            </Modal.Header>
            <form onSubmit={handleSubmit} noValidate>
              <Modal.Body className="flex flex-col gap-4">
                <Select
                  fullWidth
                  placeholder="Selecciona un estado"
                  value={status === "" ? null : status}
                  onChange={(value) => setStatus(value ? String(value) : "")}
                >
                  <Label htmlFor="new-status">Nuevo estado</Label>
                  <Select.Trigger id="new-status" data-testid="new-status-select">
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {TARGET_STATUSES.map((option) => (
                        <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                          {option.label}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>

                <TextField fullWidth isRequired value={reason} onChange={setReason}>
                  <Label>Motivo</Label>
                  <TextArea name="reason" data-testid="status-reason-input" />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button type="submit" isDisabled={isSubmitting} data-testid="confirm-status-button">
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
