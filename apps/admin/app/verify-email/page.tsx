import type { Metadata } from "next";
import { ResendConfirmationForm } from "./ResendConfirmationForm";
import { LogoHifago } from "@/components/logo-hifago";

export const metadata: Metadata = {
  title: "Revisa tu correo",
};

// Atterrissage après un signUp() sans session (confirmation requise) OU après un login échoué sur
// un compte non confirmé (docs/specs/07-connexion-inscription-complete.md §5). `email` optionnel :
// arrivée directe sans contexte (lien partagé, retour arrière) affiche un message générique plutôt
// que de planter sur un renvoi impossible.
export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const resolvedSearchParams = await searchParams;
  const emailParam = resolvedSearchParams?.email;
  const email = typeof emailParam === "string" ? emailParam : null;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <LogoHifago variante="clair" hauteur="h-16" />
      <h1 className="titre-page">Revisa tu correo</h1>
      <p className="max-w-sm text-sm text-muted">
        {email ? (
          <>
            Te enviamos un enlace de confirmación a <strong>{email}</strong>. Haz clic en el
            enlace para activar tu cuenta.
          </>
        ) : (
          "Te enviamos un enlace de confirmación por correo. Haz clic en el enlace para activar tu cuenta."
        )}
      </p>
      <ResendConfirmationForm email={email} />
    </main>
  );
}
