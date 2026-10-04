"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { buildAuthCallbackRedirect } from "@hifago/domain";
import { createClient } from "@hifago/supabase/client";
import { Button, toast } from "@hifago/ui";

const COOLDOWN_SECONDS = 30;

// Cooldown côté UI (docs/specs/07-connexion-inscription-complete.md §9) en plus du rate-limit
// natif de Supabase (max_frequency, config.toml) — évite un aller-retour réseau pour un clic
// répété évident, pas un remplacement du rate-limit serveur.
export function ResendConfirmationForm({ email }: { email: string | null }) {
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => value - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  if (!email) {
    return (
      <Link href="/login" className="text-sm underline">
        Volver a iniciar sesión
      </Link>
    );
  }

  async function handleResend() {
    const supabase = createClient();
    // ⚠️ `emailRedirectTo` obligatoire : le lien de l'email est `{{ .RedirectTo }}&token_hash=…`
    // (supabase/templates/confirmation.html), et sans lui `.RedirectTo` retombe sur le site_url NU
    // — le lien renvoyé ne mènerait nulle part. `next: "/"` : le dispatcher d'app/page.tsx aiguille
    // ensuite selon le type de compte, comme après /login.
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email as string,
      options: {
        emailRedirectTo: buildAuthCallbackRedirect({ origin: window.location.origin, next: "/" }),
      },
    });
    if (error) {
      toast.danger("No se pudo reenviar el correo. Inténtalo de nuevo en unos segundos.");
    } else {
      toast.success("Correo reenviado.");
    }
    setCooldown(COOLDOWN_SECONDS);
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        type="button"
        variant="outline"
        isDisabled={cooldown > 0}
        onPress={handleResend}
        data-testid="resend-confirmation-button"
      >
        {cooldown > 0 ? `Reenviar correo (${cooldown}s)` : "Reenviar correo"}
      </Button>
      <Link href="/login" className="text-sm underline">
        Volver a iniciar sesión
      </Link>
    </div>
  );
}
