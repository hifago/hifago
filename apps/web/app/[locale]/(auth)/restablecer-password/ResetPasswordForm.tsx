"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
// ⚠️ `useRouter` d'`@/i18n/navigation`, jamais de `next/navigation` nu — voir LoginForm.tsx.
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button } from "@/components/atoms/Button";
import { Aviso } from "@/components/molecules/Aviso";
import { CamposContrasena } from "@/components/molecules/CamposContrasena";

// Adapté d'apps/admin/app/reset-password/ResetPasswordForm.tsx (encore vivant côté admin, même
// besoin ici), localisé via useTranslations. Bannière `role="alert"` inline plutôt qu'un toast —
// même idiome que LoginForm/SignupForm côté apps/web, contrairement à l'admin. Les deux champs
// eux-mêmes viennent de `CamposContrasena`, partagé avec SignupForm : la règle de mot de passe de
// la vitrine n'a qu'une définition.
export function ResetPasswordForm() {
  const t = useTranslations("ResetPassword");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsSubmitting(false);

    if (updateError) {
      setError(t("genericError"));
      return;
    }

    // La session de récupération, une fois le mot de passe posé, est une session valide comme une
    // autre (docs/specs/07-connexion-inscription-complete.md §4) — pas de reconnexion à refaire.
    // router.push d'@/i18n/navigation préfixe automatiquement la locale courante.
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full max-w-sm flex-col gap-4">
      <CamposContrasena
        password={password}
        confirmPassword={confirmPassword}
        onPasswordChange={setPassword}
        onConfirmPasswordChange={setConfirmPassword}
        labelPassword={t("password")}
        labelConfirmPassword={t("confirmPassword")}
      />
      {error ? (
        <Aviso tono="error" rol="alert" testId="reset-password-error">
          <p>{error}</p>
        </Aviso>
      ) : null}
      <Button
        type="submit"
        size="lg"
        width="full"
        isPending={isSubmitting}
        pendingLabel={t("submitting")}
        testId="reset-password-submit"
      >
        {t("submit")}
      </Button>
    </form>
  );
}
