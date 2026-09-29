import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNextPath } from "@hifago/domain";
import { createClient } from "@hifago/supabase/server";
import { checkMfaGuard } from "@/lib/mfaGuard";
import { MfaEnrollForm } from "./MfaEnrollForm";

export const metadata: Metadata = {
  title: "Activar verificación en dos pasos",
};

// 2FA obligatoire pour le rôle admin (docs/specs/07-connexion-inscription-complete.md §5/§8) —
// bloquant : aucun accès à /admin/* ni /partner/* tant qu'un facteur TOTP n'est pas enrôlé.
export default async function MfaEnrollPage({ searchParams }: PageProps<"/mfa/enroll">) {
  const resolvedSearchParams = await searchParams;
  const nextParam = resolvedSearchParams?.next;
  const next = safeNextPath(nextParam);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/mfa/enroll?next=${encodeURIComponent(next)}`)}`);
  }

  // Navigation directe vers cet écran alors que l'enrôlement n'est plus nécessaire (déjà fait, ou
  // pas admin) — ne pas bloquer, rediriger vers l'écran pertinent.
  const guard = await checkMfaGuard(supabase, user.id);
  if (guard.action === "verify") redirect(`/mfa/verify?next=${encodeURIComponent(next)}`);
  if (guard.action === "none") redirect(next);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Activar verificación en dos pasos</h1>
      <p className="max-w-sm text-center text-sm text-muted">
        Tu cuenta tiene permisos de administrador — la verificación en dos pasos es obligatoria.
        Escanea este código con tu app de autenticación (Google Authenticator, 1Password, etc.).
      </p>
      <MfaEnrollForm next={next} />
    </main>
  );
}
