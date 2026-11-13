"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Switch, toast } from "@hifago/ui";

// Option « reverser les 17 % » (20261112180000, décision Jérôme du 2026-11-12). Le client paie
// toujours 17 % en ligne ; quand il arrive avec un code de ce partenaire et réserve chez ce même
// partenaire (auto-recomendación), le partenaire touche 8 % par défaut, l'acompte entier avec
// l'option. Ne change que les commandes créées après la bascule.
export function SelfReferralRebateSection({
  partnerId,
  enabled,
}: {
  partnerId: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [isUpdating, setIsUpdating] = useState(false);

  async function handleToggle(nextEnabled: boolean) {
    setIsUpdating(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("set_partner_self_referral_full_rebate", {
      p_partner_id: partnerId,
      p_enabled: nextEnabled,
    });
    setIsUpdating(false);

    if (rpcError || !(data as { ok?: boolean } | null)?.ok) {
      toast.danger("No se pudo cambiar la comisión de auto-recomendación.");
      return;
    }
    toast.success(
      nextEnabled
        ? "Auto-recomendación: se le devuelve el 17 %."
        : "Auto-recomendación: se le devuelve el 8 %.",
    );
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Comisión de auto-recomendación</h2>
      <p className="text-sm">
        El cliente paga siempre un anticipo del 17 % en línea. Cuando llega con un código de este
        partner y reserva uno de sus propios servicios, el partner recibe el{" "}
        <strong>{enabled ? "17 %" : "8 %"}</strong> como comisión
        {enabled ? " (Hifago no se queda con nada)." : " y Hifago el 9 %."}
      </p>
      <Switch
        isSelected={enabled}
        isDisabled={isUpdating}
        onChange={handleToggle}
        data-testid="self-referral-full-rebate-switch"
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          Devolverle el 17 % completo
        </Switch.Content>
      </Switch>
      <p className="text-sm text-muted">Solo cambia las reservas creadas a partir de ahora.</p>
    </section>
  );
}
