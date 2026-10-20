"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, buttonVariants, Card, Input, Label, TextField, toast } from "@hifago/ui";

// Page publique d'inscription Mercado Pago Colombie (redirige vers /signup/splitter, vérifié le
// 2026-10-19). Pas de lien d'affiliation : le parrainage MP (« Invita y gana ») ne produit que des
// liens personnels rattachés au compte d'un particulier, rien pour une plateforme.
const MERCADOPAGO_SIGNUP_URL = "https://www.mercadopago.com.co/hub/registration/landing";

// Compte de paiement du referrer (spec 19 §10 point 7 — table dédiée partner_payout_accounts,
// jamais construite jusqu'ici) : demande directe de Jérôme (2026-08-25), self-service et
// application immédiate (pas de circuit d'approbation, contrairement à
// establishment_payout_accounts qui reste admin-only) — un seul champ, l'identifiant Mercado Pago,
// jamais les coordonnées Bancolombia/Nequi de partner_crm_profile.bank (canal distinct).
//
// Le compte enregistré n'est JAMAIS réaffiché (cahier socio, décision du 2026-08-11) : le bloc ne
// reçoit que ses derniers caractères (`registeredSuffix`, calculé côté serveur), et le champ sert
// seulement à saisir un NOUVEAU compte qui remplace l'ancien.
export function PayoutAccountBlock({ registeredSuffix }: { registeredSuffix: string | null }) {
  const router = useRouter();
  const [mercadopagoAccount, setMercadopagoAccount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isDirty = mercadopagoAccount.trim() !== "";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!mercadopagoAccount.trim()) {
      toast.danger("La cuenta de Mercado Pago es obligatoria.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_my_payout_account", {
      p_mercadopago_account: mercadopagoAccount.trim(),
    });
    setIsSubmitting(false);

    if (error) {
      toast.danger("No se pudo actualizar tu cuenta de pago. Inténtalo de nuevo.");
      return;
    }

    toast.success("Cuenta de pago actualizada.");
    setMercadopagoAccount("");
    router.refresh();
  }

  return (
    <Card data-testid="payout-account-block">
      <Card.Header>
        <Card.Title>Cuenta de pago</Card.Title>
      </Card.Header>
      <Card.Content>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            El correo, CVU o alias de Mercado Pago donde recibes el pago de tus comisiones. El giro
            lo hace un admin manualmente — esta cuenta es el destino que le indicas.
          </p>
          {registeredSuffix !== null ? (
            <p className="text-sm" data-testid="payout-account-registered">
              Cuenta registrada: <span className="font-medium">••••{registeredSuffix}</span>
            </p>
          ) : null}
          <TextField
            name="mercadopago-account"
            value={mercadopagoAccount}
            onChange={setMercadopagoAccount}
            isRequired
          >
            <Label>
              {registeredSuffix !== null ? "Nueva cuenta de Mercado Pago" : "Cuenta de Mercado Pago"}
            </Label>
            <Input data-testid="payout-mercadopago-account-input" />
          </TextField>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              isDisabled={isSubmitting || !isDirty}
              data-testid="save-payout-account-button"
            >
              {isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
            <a
              href={MERCADOPAGO_SIGNUP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline" })}
              data-testid="create-mercadopago-account-link"
            >
              Crear mi cuenta Mercado Pago
            </a>
          </div>
        </form>
      </Card.Content>
    </Card>
  );
}
