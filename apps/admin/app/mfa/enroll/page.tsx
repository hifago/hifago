import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNextPath } from "@hifago/domain";
import { createClient } from "@hifago/supabase/server";
import { checkMfaGuard } from "@/lib/mfaGuard";
import { MfaEnrollForm } from "./MfaEnrollForm";
import { LogoHifago } from "@/components/logo-hifago";
import { LogoutButton } from "@/components/LogoutButton";

export const metadata: Metadata = {
  title: "Activar verificación en dos pasos",
};

// 2FA activé par choix (docs/specs/07-connexion-inscription-complete.md §5/§10) : jamais forcé. Le
// chemin principal est la modale « Seguridad » de la barre de navigation ; cette page reste pour un
// lien direct, avec une sortie (« Más tarde », « Cerrar sesión ») — plus un cul-de-sac.
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

  // Le 2FA vise la capacité admin (spec 07 §10, cahier admin §1) : un compte sans elle n'a pas de
  // « Seguridad » dans sa navigation, donc aucun moyen de retirer un facteur qu'il aurait enrôlé par
  // un lien direct — il n'enrôle pas. Échec fermé : une lecture en panne lève, elle n'est pas « non ».
  const { data: isAdminCapable, error: capabilityError } =
    await supabase.rpc("has_admin_capability");
  if (capabilityError) {
    throw new Error(
      `Lecture du rôle impossible (has_admin_capability) : ${capabilityError.message}`
    );
  }
  if (!isAdminCapable) redirect(next);

  // Un facteur est déjà vérifié mais cette session est en AAL1 : en ajouter un autre exige l'AAL2,
  // donc défi d'abord. Sinon (« none ») rien ne bloque l'enrôlement — c'est le cas normal.
  const guard = await checkMfaGuard(supabase);
  if (guard.action === "verify") redirect(`/mfa/verify?next=${encodeURIComponent(next)}`);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <LogoHifago variante="clair" hauteur="h-16" />
      <h1 className="titre-page">Activar verificación en dos pasos</h1>
      <p className="max-w-sm text-center text-sm text-muted">
        Añade una segunda capa de seguridad a tu cuenta: además de tu contraseña (o de Google), te
        pediremos un código de tu app de autenticación en cada inicio de sesión.
      </p>
      <MfaEnrollForm next={next} />
      <LogoutButton data-testid="mfa-enroll-logout" />
    </main>
  );
}
