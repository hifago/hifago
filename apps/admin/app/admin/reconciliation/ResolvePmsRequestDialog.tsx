"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { Button, Label, Modal, TextField, Input, toast } from "@hifago/ui";
import { rpcErrorMessage } from "@/lib/errors/rpcErrorMessage";
import { pmsRefusalMessage } from "@/lib/reconciliation/pmsRequestRefusals";
import type { PendingPmsLine } from "./ReconciliationList";

// Lobby APRÈS l'acompte (spec 21 §8.2) — la reprise d'une commande PAYÉE que Lobby n'a pas pu réserver
// (demande pms_booking_requests en `failed` / `needs_human`). Sans ce levier, le client restait
// « paid_unconfirmed » pour toujours : les e-mails de confirmation ne partaient jamais, et une ligne
// `needs_human` dont le booking existe chez Lobby comptait « en vol » sans limite dans hold_pms_nights.
// Une seule RPC (admin_resolve_pms_booking_request), trois gestes :
//   retry   — relancer l'envoi à Lobby. L'admin ATTESTE avoir vérifié chez Lobby qu'aucun booking
//             n'existe pour cette commande (sinon : second booking payé, non annulable par API) ;
//   confirm — la réservation est résolue à la main (relogée, ou créée dans Lobby) : les e-mails de
//             confirmation partent, l'état du client se libère ; un champ « ID de la reserva en Lobby »
//             PAR nuit PMS sans booking (tous facultatifs, envoyés ensemble) — une nuit laissée sans id
//             ne serait jamais pollée ni annulée ;
//   cancel  — on n'enverra rien à Lobby : l'état « no pudimos confirmar » disparaît. Aucune ligne n'est
//             annulée ici (set_order_line_status), aucun remboursement (suspendus).
export type PmsRequestAction = "retry" | "confirm" | "cancel";

const COPY: Record<PmsRequestAction, { title: string; body: string; submit: string; done: string }> = {
  retry: {
    title: "Reintentar con Lobby",
    body: "Confirma que verificaste en Lobby que NO existe ninguna reserva para esta orden: se volverá a enviar a Lobby. Si ya existiera, se crearía una segunda reserva con pago que Lobby no deja anular por API.",
    submit: "Reintentar",
    done: "Solicitud reenviada a Lobby: se procesa en el próximo minuto.",
  },
  confirm: {
    title: "Confirmar reserva resuelta",
    body: "La reserva ya quedó resuelta a mano (reubicada, o creada en Lobby). Se enviarán los correos de confirmación al cliente y al prestador, y el cliente dejará de ver «no pudimos confirmar».",
    submit: "Confirmar",
    done: "Reserva confirmada: se enviaron los correos.",
  },
  cancel: {
    title: "Anular la solicitud a Lobby",
    body: "No se enviará nada a Lobby y el cliente dejará de ver «no pudimos confirmar». Esto NO anula las líneas de la orden (hazlo aparte si corresponde) y no reembolsa nada.",
    submit: "Anular solicitud",
    done: "Solicitud anulada.",
  },
};

export function ResolvePmsRequestDialog({
  requestId,
  lines,
  action,
  open,
  onOpenChange,
  onSuccess,
}: {
  requestId: string;
  /** Les nuits PMS de la commande sans booking : un champ de saisie chacune (confirm). */
  lines: PendingPmsLine[];
  action: PmsRequestAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (action: PmsRequestAction) => void;
}) {
  // Un id saisi par ligne (clé = order_line_id).
  const [bookingIds, setBookingIds] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const copy = COPY[action];

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    const supabase = createClient();
    // Les champs remplis seulement, tous envoyés ensemble : la RPC les valide AVANT d'écrire quoi que
    // ce soit (un id refusé n'en laisse aucun autre enregistré).
    const bookings = lines
      .map((line) => ({ order_line_id: line.orderLineId, pms_booking_id: (bookingIds[line.orderLineId] ?? "").trim() }))
      .filter((booking) => booking.pms_booking_id !== "");
    const { data, error: rpcError } = await supabase.rpc("admin_resolve_pms_booking_request", {
      p_request_id: requestId,
      p_action: action,
      ...(action === "confirm" && bookings.length > 0 ? { p_bookings: bookings } : {}),
    });
    setIsSubmitting(false);

    if (rpcError || !(data as { ok: boolean } | null)?.ok) {
      // Un refus MÉTIER de la RPC (id mal recopié, déjà utilisé, demande déjà traitée…) a son texte ;
      // sinon le message générique.
      toast.danger(pmsRefusalMessage(data) ?? rpcErrorMessage(rpcError, "No se pudo procesar la solicitud."));
      return;
    }
    toast.success(copy.done);
    setBookingIds({});
    onSuccess(action);
    onOpenChange(false);
  }

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={open}
        onOpenChange={(next) => {
          if (!next) setBookingIds({});
          onOpenChange(next);
        }}
      >
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>{copy.title}</Modal.Heading>
            </Modal.Header>
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              <Modal.Body className="flex flex-col gap-4">
                <p className="text-sm" data-testid="pms-request-dialog-body">{copy.body}</p>
                {action === "confirm"
                  ? lines.map((line) => (
                      <TextField
                        key={line.orderLineId}
                        fullWidth
                        value={bookingIds[line.orderLineId] ?? ""}
                        onChange={(value) => setBookingIds((prev) => ({ ...prev, [line.orderLineId]: value }))}
                      >
                        <Label htmlFor={`pms-booking-id-${line.orderLineId}`}>
                          {`ID de la reserva en Lobby — ${line.productName}${line.date ? `, ${line.date}${line.endDate ? ` → ${line.endDate}` : ""}` : ""} (opcional)`}
                        </Label>
                        <Input
                          id={`pms-booking-id-${line.orderLineId}`}
                          name={`pms-booking-id-${line.orderLineId}`}
                          inputMode="numeric"
                          data-testid={`pms-booking-id-input-${line.orderLineId}`}
                        />
                      </TextField>
                    ))
                  : null}
              </Modal.Body>
              <Modal.Footer>
                <Button type="submit" isDisabled={isSubmitting} data-testid="confirm-pms-request-button">
                  {isSubmitting ? "Guardando…" : copy.submit}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
