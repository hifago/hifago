"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCop } from "@hifago/domain";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, Modal, TextArea, TextField, toast, useOverlayState } from "@hifago/ui";
import { rpcErrorMessage } from "@/lib/errors/rpcErrorMessage";
import { mercadoPagoFeeNote } from "@/lib/commission/mercadoPagoFeeNote";
import { ledgerConceptLabel } from "./ledgerConcept";
import { PAY_ALL_LIMIT, planPayAll } from "./payAll";

type DueEntry = {
  id: string;
  amountCop: number;
  concept: string;
  feeNote: string | null;
  orderReference: string;
};

type Loaded = { status: "loading" } | { status: "error" } | { status: "ready"; entries: DueEntry[]; totalCount: number };

// « Pagar todo » (20261112200000, Jérôme : « oui je veux ce bouton ») : régler en une fois tout ce
// qui est « A pagar » pour un bénéficiaire, après UN virement Mercado Pago. Les entrées sont relues
// à l'ouverture (jamais les chiffres de la carte, calculés au chargement de la page) et envoyées
// telles quelles, avec leur total : mark_partner_ledger_entries_paid refuse tout si l'une a changé
// entre-temps (HF003). Même patron que MarkPaidDialog : motif obligatoire, comprobante libre.
export function PayAllButton({
  beneficiaryPartnerId,
  beneficiaryName,
  mercadopagoAccount,
}: {
  beneficiaryPartnerId: string;
  beneficiaryName: string;
  mercadopagoAccount: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        data-testid={`ledger-pay-all-${beneficiaryPartnerId}`}
        onPress={() => setOpen(true)}
      >
        Pagar todo
      </Button>
      {open ? (
        <PayAllDialog
          beneficiaryPartnerId={beneficiaryPartnerId}
          beneficiaryName={beneficiaryName}
          mercadopagoAccount={mercadopagoAccount}
          open={open}
          onOpenChange={setOpen}
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function PayAllDialog({
  beneficiaryPartnerId,
  beneficiaryName,
  mercadopagoAccount,
  open,
  onOpenChange,
  onSuccess,
}: {
  beneficiaryPartnerId: string;
  beneficiaryName: string;
  mercadopagoAccount: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [comprobantePath, setComprobantePath] = useState("");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const state = useOverlayState({ isOpen: open, onOpenChange });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await createClient().rpc("admin_ledger_entries_list", {
        p_status: "due",
        p_beneficiary_partner_id: beneficiaryPartnerId,
        p_sort_key: "created_at",
        p_sort_desc: false,
        p_limit: PAY_ALL_LIMIT,
        p_offset: 0,
      });
      if (cancelled) return;
      if (error) {
        console.error("admin_ledger_entries_list (Pagar todo)", error);
        setLoaded({ status: "error" });
        return;
      }
      setLoaded({
        status: "ready",
        totalCount: data.length === 0 ? 0 : data[0].total_count,
        entries: data.map((entry) => ({
          id: entry.id,
          amountCop: entry.amount_cop,
          concept: ledgerConceptLabel({
            entryType: entry.entry_type,
            commissionCase: entry.commission_case,
            referrerPct: entry.referrer_pct,
          }),
          feeNote: mercadoPagoFeeNote(entry.mp_fee_cop),
          orderReference: entry.order_reference,
        })),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [beneficiaryPartnerId]);

  const plan = loaded.status === "ready" ? planPayAll(loaded.entries, loaded.totalCount) : null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!plan?.ok) return;
    if (note.trim() === "") {
      toast.danger("El motivo es obligatorio.");
      return;
    }

    setIsSubmitting(true);
    const { data, error } = await createClient().rpc("mark_partner_ledger_entries_paid", {
      p_beneficiary_partner_id: beneficiaryPartnerId,
      p_ledger_entry_ids: plan.ids,
      p_expected_total_cop: plan.totalCop,
      p_comprobante_path: comprobantePath.trim(),
      p_note: note.trim(),
    });
    setIsSubmitting(false);

    if (error || !(data as { ok: boolean } | null)?.ok) {
      toast.danger(rpcErrorMessage(error, "No se pudieron marcar las entradas como pagadas."));
      return;
    }
    toast.success(plan.ids.length === 1 ? "1 entrada marcada como pagada." : `${plan.ids.length} entradas marcadas como pagadas.`);
    onSuccess();
  }

  return (
    <Modal state={state}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>Pagar todo a {beneficiaryName}</Modal.Heading>
            </Modal.Header>
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              <Modal.Body className="flex flex-col gap-4">
                {loaded.status === "loading" ? (
                  <p className="text-sm text-muted">Cargando las entradas a pagar…</p>
                ) : loaded.status === "error" ? (
                  <p className="text-sm" data-testid="pay-all-error">
                    No se pudieron leer las entradas a pagar. Cierra la ventana y vuelve a intentarlo.
                  </p>
                ) : plan && !plan.ok ? (
                  <p className="text-sm" data-testid="pay-all-blocked">
                    {plan.reason === "empty"
                      ? "Ya no queda nada por pagar a este beneficiario."
                      : `Hay más de ${PAY_ALL_LIMIT} entradas a pagar: págalas desde la lista, una por una.`}
                  </p>
                ) : plan?.ok ? (
                  <>
                    <div className="flex flex-col gap-1" data-testid="pay-all-summary">
                      <span className="text-sm">
                        Transferir <strong>{formatCop(plan.totalCop)}</strong> ·{" "}
                        {plan.ids.length === 1 ? "1 entrada" : `${plan.ids.length} entradas`}
                      </span>
                      <span className="break-words text-sm text-muted" data-testid="pay-all-account">
                        {mercadopagoAccount
                          ? `Cuenta Mercado Pago: ${mercadopagoAccount}`
                          : "Sin cuenta Mercado Pago registrada: pídesela antes de transferir."}
                      </span>
                    </div>
                    <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto text-sm" data-testid="pay-all-entries">
                      {loaded.status === "ready"
                        ? loaded.entries.map((entry) => (
                            <li key={entry.id} className="flex items-start justify-between gap-3">
                              <span className="flex min-w-0 flex-col">
                                <span>{entry.concept}</span>
                                <span className="text-xs text-muted">Pedido {entry.orderReference}</span>
                                {entry.feeNote ? <span className="text-xs text-muted">{entry.feeNote}</span> : null}
                              </span>
                              <span className="shrink-0 tabular-nums">{formatCop(entry.amountCop)}</span>
                            </li>
                          ))
                        : null}
                    </ul>
                    <TextField fullWidth name="pay-all-comprobante" value={comprobantePath} onChange={setComprobantePath}>
                      <Label>Comprobante (URL o ruta, opcional)</Label>
                      <Input data-testid="pay-all-comprobante-input" />
                    </TextField>
                    <TextField fullWidth isRequired value={note} onChange={setNote}>
                      <Label htmlFor="pay-all-note">Motivo</Label>
                      <TextArea id="pay-all-note" name="pay-all-note" data-testid="pay-all-note-input" />
                    </TextField>
                  </>
                ) : null}
              </Modal.Body>
              <Modal.Footer>
                <Button
                  type="submit"
                  isDisabled={isSubmitting || !plan?.ok}
                  data-testid="confirm-pay-all-button"
                >
                  {isSubmitting
                    ? "Guardando…"
                    : plan?.ok
                      ? `Marcar ${formatCop(plan.totalCop)} pagado`
                      : "Marcar pagado"}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
