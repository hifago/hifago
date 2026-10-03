"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
// ⚠️ `Link` d'`@/i18n/navigation`, jamais de `next/link` nu — voir LoginForm.tsx.
import { Link } from "@/i18n/navigation";
import { createClient } from "@hifago/supabase/client";
import { buildAuthCallbackRedirect } from "@hifago/domain";
import { Input, Label, TextField } from "@hifago/ui";
import { Button } from "@/components/atoms/Button";
import { Aviso } from "@/components/molecules/Aviso";

// Adapté d'apps/admin/app/forgot-password/ForgotPasswordForm.tsx (encore vivant côté admin, même
// besoin ici), localisé via useTranslations, et en utilisant buildAuthCallbackRedirect
// (@hifago/domain) plutôt qu'un `new URL(...)` écrit à la main comme le fait encore l'admin.
//
// Message toujours générique, y compris en cas d'erreur réseau/validation (docs/specs/
// 07-connexion-inscription-complete.md §3/§8, même discipline qu'admin) : jamais de confirmation ou
// d'infirmation de l'existence d'un compte pour cette adresse.
export function ForgotPasswordForm() {
  const t = useTranslations("ForgotPassword");
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);

    const supabase = createClient();
    // redirectTo absolue, locale déjà encodée dans `next` : ce lien part dans l'email de reset
    // (supabase/templates/recovery.html, {{ .RedirectTo }}), une navigation externe hors
    // client-side router — atterrit sur /<locale>/restablecer-password une fois la session de
    // récupération établie par /auth/callback.
    const redirectTo = buildAuthCallbackRedirect({
      origin: window.location.origin,
      next: `/${locale}/restablecer-password`,
    });
    await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    setIsSubmitting(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4">
        <Aviso tono="exito" rol="status" testId="forgot-password-sent">
          <p>{t("sent")}</p>
        </Aviso>
        <Link href="/entrar" className="self-center text-base text-link underline">
          {t("backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full max-w-sm flex-col gap-4">
      <TextField name="email" value={email} onChange={setEmail} isRequired>
        <Label>{t("email")}</Label>
        <Input type="email" autoComplete="email" />
      </TextField>
      <Button
        type="submit"
        size="lg"
        width="full"
        isPending={isSubmitting}
        pendingLabel={t("submitting")}
        testId="forgot-password-submit"
      >
        {t("submit")}
      </Button>
      <Link href="/entrar" className="self-center text-base text-link underline">
        {t("backToLogin")}
      </Link>
    </form>
  );
}
