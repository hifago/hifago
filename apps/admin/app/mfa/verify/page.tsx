import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { formatDateInBogota, safeNextPath } from "@hifago/domain";
import { createClient } from "@hifago/supabase/server";
import { checkMfaGuard } from "@/lib/mfaGuard";
import { MfaVerifyForm } from "./MfaVerifyForm";
import { LogoHifago } from "@/components/logo-hifago";
import { LogoutButton } from "@/components/LogoutButton";
import { factorLabels, isSupportedFactorKind, type MfaFactorKind } from "@/lib/mfaFactors";

export const metadata: Metadata = {
  title: "Verificación en dos pasos",
};

export default async function MfaVerifyPage({ searchParams }: PageProps<"/mfa/verify">) {
  const resolvedSearchParams = await searchParams;
  const nextParam = resolvedSearchParams?.next;
  const next = safeNextPath(nextParam);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/mfa/verify?next=${encodeURIComponent(next)}`)}`);
  }

  // Rien à vérifier (aucun facteur vérifié, ou session déjà en AAL2) : on poursuit.
  const guard = await checkMfaGuard(supabase);
  if (guard.action === "none") redirect(next);

  const { data: listed } = await supabase.auth.mfa.listFactors();
  // Plusieurs appareils possibles (un second sert de secours) : proposés par dernier usage, c'est
  // presque toujours celui que la personne a en main. Numérotés par ancienneté et par type, comme dans
  // la modale « Seguridad » (lib/mfaFactors.ts), pour qu'elle reconnaisse son appareil. Un facteur
  // vérifié que ce formulaire ne sait pas passer (téléphone) ne redirige JAMAIS vers l'enrôlement —
  // ça bouclerait contre le garde — : la session voit l'impasse et peut se déconnecter.
  const verified = (listed?.all ?? [])
    .filter((factor) => factor.status === "verified" && isSupportedFactorKind(factor.factor_type))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const labels = factorLabels(verified);
  const factors = verified
    .map((factor) => ({
      id: factor.id,
      type: factor.factor_type as MfaFactorKind,
      label: `${labels.get(factor.id)} · ${formatDateInBogota(factor.created_at, "es-CO")}`,
      lastUsed: factor.last_challenged_at ?? "",
    }))
    .sort((a, b) => b.lastUsed.localeCompare(a.lastUsed))
    .map(({ id, type, label }) => ({ id, type, label }));

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <LogoHifago variante="clair" hauteur="h-16" />
      <h1 className="titre-page">Verificación en dos pasos</h1>
      {factors.length > 0 ? (
        <>
          <p className="max-w-sm text-center text-sm text-muted">
            Confirma que eres tú: código de 6 dígitos de tu app de autenticación, o tu llave de
            seguridad.
          </p>
          <MfaVerifyForm factors={factors} next={next} />
        </>
      ) : (
        <p
          role="alert"
          className="max-w-sm text-center text-sm text-danger"
          data-testid="mfa-verify-unsupported"
        >
          Tu cuenta usa un método de verificación que esta pantalla no admite. Cierra sesión y pide
          ayuda a otro administrador de Hifago.
        </p>
      )}
      <div className="flex max-w-sm flex-col items-center gap-2 text-center">
        <LogoutButton data-testid="mfa-verify-logout" />
        <p className="text-xs text-muted">
          ¿Perdiste tu dispositivo? Otro administrador de Hifago puede desactivar tu verificación.
        </p>
      </div>
    </main>
  );
}
