"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Label, TextArea, TextField, toast } from "@hifago/ui";

type Offboarding = {
  id: string;
  unpublished_at: string | null;
  payments_settled_at: string | null;
  payments_settled_note: string | null;
  capability_revoked_at: string | null;
} | null;

export function OffboardingChecklist({
  partnerId,
  offboarding,
  operatorCapabilitiesCount,
}: {
  partnerId: string;
  offboarding: Offboarding;
  operatorCapabilitiesCount: number;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pendingStep, setPendingStep] = useState<1 | 3 | 4 | null>(null);

  const unpublishedAt = offboarding?.unpublished_at ?? null;
  const paymentsSettledAt = offboarding?.payments_settled_at ?? null;
  const capabilityRevokedAt = offboarding?.capability_revoked_at ?? null;

  async function ensureOffboardingId(): Promise<string> {
    if (offboarding?.id) return offboarding.id;
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("start_offboarding", {
      p_partner_id: partnerId,
    });
    if (rpcError || !(data as { ok?: boolean })?.ok) {
      throw new Error("No se pudo iniciar el offboarding.");
    }
    return (data as { offboarding_id: string }).offboarding_id;
  }

  async function handleUnpublish() {
    setPendingStep(1);
    try {
      const offboardingId = await ensureOffboardingId();
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("offboarding_unpublish", {
        p_offboarding_id: offboardingId,
      });
      if (rpcError) throw rpcError;
      toast.success("Oferta despublicada.");
      router.refresh();
    } catch {
      toast.danger("No se pudo despublicar la oferta.");
    } finally {
      setPendingStep(null);
    }
  }

  async function handleAttestPayments() {
    if (!offboarding?.id) return;
    setPendingStep(3);
    try {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("offboarding_attest_payments", {
        p_offboarding_id: offboarding.id,
        p_note: note,
      });
      if (rpcError) throw rpcError;
      toast.success("Pago atestiguado.");
      setNote("");
      router.refresh();
    } catch {
      toast.danger("No se pudo atestiguar el pago (¿motivo vacío?).");
    } finally {
      setPendingStep(null);
    }
  }

  async function handleRevokeCapability() {
    if (!offboarding?.id) return;
    setPendingStep(4);
    try {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("offboarding_revoke_capability", {
        p_offboarding_id: offboarding.id,
      });
      if (rpcError) throw rpcError;
      toast.success("Capacidad retirada.");
      router.refresh();
    } catch {
      toast.danger("No se pudo retirar la capacidad.");
    } finally {
      setPendingStep(null);
    }
  }

  const step3Enabled = unpublishedAt !== null && paymentsSettledAt === null;
  const step4Enabled = paymentsSettledAt !== null && capabilityRevokedAt === null;

  return (
    <div className="flex flex-col gap-6">
      {capabilityRevokedAt ? (
        <p data-testid="offboarding-complete-banner" className="text-sm font-medium text-success">
          Offboarding completado — la capacidad operador de este partner ha sido retirada.
        </p>
      ) : null}

      <section className="flex flex-col gap-2 rounded-lg border bg-surface p-4">
        <h2 className="font-medium">1. Despublicar la oferta</h2>
        <p className="text-sm text-muted">
          Todas las actividades vendibles de este partner dejan de estar disponibles a la venta.
        </p>
        {unpublishedAt ? (
          <p data-testid="offboarding-step1-done" className="text-sm text-success">
            ✓ Despublicado
          </p>
        ) : (
          <Button
            data-testid="offboarding-step1-button"
            onPress={handleUnpublish}
            isDisabled={pendingStep === 1}
            className="w-fit"
          >
            {pendingStep === 1 ? "Despublicando…" : "Despublicar la oferta"}
          </Button>
        )}
      </section>

      <section
        className="flex flex-col gap-2 rounded-lg border bg-surface p-4 data-disabled:opacity-50"
        data-disabled={unpublishedAt === null}
      >
        <h2 className="font-medium">2. Honrar las reservas ya realizadas</h2>
        <p data-testid="offboarding-step2-info" className="text-sm text-muted">
          Ninguna acción requerida — las reservas ya confirmadas siguen su curso normal, la
          despublicación no las anula retroactivamente.
        </p>
      </section>

      <section
        className="flex flex-col gap-2 rounded-lg border bg-surface p-4 data-disabled:opacity-50"
        data-disabled={unpublishedAt === null}
      >
        <h2 className="font-medium">3. Atestiguar el pago de lo adeudado</h2>
        {paymentsSettledAt ? (
          <p data-testid="offboarding-step3-done" className="text-sm text-success">
            ✓ Pago atestiguado — {offboarding?.payments_settled_note}
          </p>
        ) : (
          <>
            <TextField
              className="flex flex-col gap-1.5"
              value={note}
              onChange={setNote}
              isDisabled={!step3Enabled}
            >
              <Label>Motivo</Label>
              <TextArea data-testid="offboarding-step3-note" />
            </TextField>
            <Button
              data-testid="offboarding-step3-button"
              onPress={handleAttestPayments}
              isDisabled={!step3Enabled || pendingStep === 3}
              className="w-fit"
            >
              {pendingStep === 3 ? "Atestiguando…" : "Atestiguar pago"}
            </Button>
          </>
        )}
      </section>

      <section
        className="flex flex-col gap-2 rounded-lg border bg-surface p-4 data-disabled:opacity-50"
        data-disabled={paymentsSettledAt === null}
      >
        <h2 className="font-medium">4. Retirar la capacidad</h2>
        {capabilityRevokedAt ? (
          <p data-testid="offboarding-step4-done" className="text-sm text-success">
            ✓ Capacidad retirada
          </p>
        ) : (
          <>
            <p className="text-sm text-muted" data-testid="offboarding-step4-reminder">
              Esto revocará el acceso operador de este partner en {operatorCapabilitiesCount}{" "}
              establecimiento(s). El rol referente no se ve afectado.
            </p>
            <Button
              variant="danger"
              data-testid="offboarding-step4-button"
              onPress={handleRevokeCapability}
              isDisabled={!step4Enabled || pendingStep === 4}
              className="w-fit"
            >
              {pendingStep === 4 ? "Retirando…" : "Retirar la capacidad"}
            </Button>
          </>
        )}
      </section>
    </div>
  );
}
