"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextField, toast } from "@hifago/ui";
import { isCancelledCeremony, type MfaFactorKind } from "@/lib/mfaFactors";

export type VerifyFactor = { id: string; label: string; type: MfaFactorKind };

// Un code TOTP est lié au secret de SON appareil, une clé de sécurité à sa propre puce : avec
// plusieurs facteurs (le second sert de secours), la personne choisit celui qu'elle a en main. Le
// premier de la liste est le dernier utilisé. Un seul facteur : aucun choix à afficher. Une clé se
// présente par un bouton (le navigateur exige un geste de la personne), un TOTP par son code.
export function MfaVerifyForm({ factors, next }: { factors: VerifyFactor[]; next: string }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState(factors[0].id);
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selected = factors.find((factor) => factor.id === factorId) ?? factors[0];

  function done() {
    router.push(next);
    router.refresh();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });
    setIsSubmitting(false);

    if (verifyError) {
      toast.danger("Código incorrecto. Inténtalo de nuevo.");
      return;
    }

    done();
  }

  async function handleUseKey() {
    setIsSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.webauthn.authenticate({ factorId });
    setIsSubmitting(false);

    if (error) {
      // Annulée par la personne (fenêtre du navigateur fermée, délai dépassé) : pas une panne.
      toast.danger(
        isCancelledCeremony(error)
          ? "Operación cancelada o tiempo agotado. Inténtalo de nuevo con tu llave."
          : "No se pudo verificar la llave de seguridad. Inténtalo de nuevo."
      );
      return;
    }

    done();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full max-w-sm flex-col gap-4">
      {factors.length > 1 ? (
        <fieldset className="flex flex-col gap-2" data-testid="mfa-verify-factors">
          <legend className="mb-1 text-sm font-medium">¿Con qué dispositivo?</legend>
          <div className="flex flex-wrap gap-2">
            {factors.map((factor) => (
              <Button
                key={factor.id}
                type="button"
                size="sm"
                variant={factor.id === factorId ? "primary" : "outline"}
                aria-pressed={factor.id === factorId}
                onPress={() => setFactorId(factor.id)}
                data-testid="mfa-verify-factor"
              >
                {factor.label}
              </Button>
            ))}
          </div>
        </fieldset>
      ) : null}
      {selected.type === "webauthn" ? (
        <Button
          type="button"
          isDisabled={isSubmitting}
          onPress={() => void handleUseKey()}
          data-testid="mfa-verify-use-key"
        >
          {isSubmitting ? "Esperando la llave…" : "Usar mi llave de seguridad"}
        </Button>
      ) : (
        <>
          <TextField name="code" value={code} onChange={setCode} isRequired>
            <Label>Código de 6 dígitos</Label>
            <Input inputMode="numeric" maxLength={6} autoComplete="one-time-code" autoFocus />
          </TextField>
          <Button type="submit" isDisabled={isSubmitting} data-testid="mfa-verify-submit">
            {isSubmitting ? "Verificando…" : "Verificar"}
          </Button>
        </>
      )}
    </form>
  );
}
