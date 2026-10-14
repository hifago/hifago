import type { Metadata } from "next";
import { createClient } from "@hifago/supabase/server";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { LogoHifago } from "@/components/logo-hifago";

export const metadata: Metadata = {
  title: "Restablecer contraseña",
};

// Atteint uniquement via /auth/callback?type=recovery, qui a déjà établi une session de
// récupération (verifyOtp) avant de rediriger ici — docs/specs/07-connexion-inscription-complete.md
// §4/§5. Sans session (arrivée directe sur cette URL, lien déjà consommé/expiré), rien à réinitialiser.
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <LogoHifago variante="clair" hauteur="h-16" />
      <h1 className="titre-page">Restablecer contraseña</h1>
      {user ? (
        <ResetPasswordForm />
      ) : (
        <p className="max-w-sm text-center text-sm text-danger" data-testid="reset-password-no-session">
          Este enlace no es válido o ha expirado. Solicita uno nuevo desde{" "}
          <a href="/forgot-password" className="underline">
            ¿Olvidaste tu contraseña?
          </a>
          .
        </p>
      )}
    </main>
  );
}
