import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNextPath } from "@hifago/domain";
import { createClient } from "@hifago/supabase/server";
import { checkMfaGuard } from "@/lib/mfaGuard";
import { MfaVerifyForm } from "./MfaVerifyForm";

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

  const guard = await checkMfaGuard(supabase, user.id);
  if (guard.action === "enroll") redirect(`/mfa/enroll?next=${encodeURIComponent(next)}`);
  if (guard.action === "none") redirect(next);

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const totpFactor = factors?.totp[0];
  if (!totpFactor) redirect(`/mfa/enroll?next=${encodeURIComponent(next)}`);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Verificación en dos pasos</h1>
      <p className="max-w-sm text-center text-sm text-muted">
        Ingresa el código de 6 dígitos de tu app de autenticación.
      </p>
      <MfaVerifyForm factorId={totpFactor.id} next={next} />
    </main>
  );
}
