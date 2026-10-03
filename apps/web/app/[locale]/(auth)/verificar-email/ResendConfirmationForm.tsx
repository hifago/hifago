"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient } from "@hifago/supabase/client";
import { buildAuthCallbackRedirect } from "@hifago/domain";
import { Button } from "@/components/atoms/Button";
import { Aviso } from "@/components/molecules/Aviso";

const COOLDOWN_SECONDS = 30;

// Adapté de apps/admin/app/verify-email/ResendConfirmationForm.tsx (encore vivant côté admin,
// même besoin ici) — cooldown côté UI en plus du rate-limit natif Supabase (max_frequency,
// config.toml), localisé via useTranslations.
export function ResendConfirmationForm({ email }: { email: string | null }) {
  const t = useTranslations("VerifyEmail");
  const locale = useLocale();
  const [cooldown, setCooldown] = useState(0);
  const [feedback, setFeedback] = useState<"success" | "error" | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => value - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  if (!email) {
    return (
      <Link href="/entrar" className="text-base text-link underline">
        {t("backToLogin")}
      </Link>
    );
  }

  async function handleResend() {
    const supabase = createClient();
    // ⚠️ `emailRedirectTo` obligatoire, comme à l'inscription (SignupForm.tsx) : le lien de l'email
    // est `{{ .RedirectTo }}&token_hash=…` (supabase/templates/confirmation.html), et sans lui
    // `.RedirectTo` retombe sur le site_url NU — le lien renvoyé ne mènerait nulle part.
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email as string,
      options: {
        emailRedirectTo: buildAuthCallbackRedirect({
          origin: window.location.origin,
          next: `/${locale}`,
        }),
      },
    });
    if (error) {
      setFeedback("error");
    } else {
      setFeedback("success");
    }
    setCooldown(COOLDOWN_SECONDS);
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {feedback ? (
        <Aviso
          tono={feedback === "success" ? "exito" : "error"}
          rol={feedback === "success" ? "status" : "alert"}
          testId={`resend-confirmation-${feedback}`}
        >
          <p>{feedback === "success" ? t("resent") : t("resendError")}</p>
        </Aviso>
      ) : null}
      <Button
        type="button"
        variant="outline"
        color="neutral"
        isDisabled={cooldown > 0}
        onPress={handleResend}
        testId="resend-confirmation-button"
      >
        {cooldown > 0 ? t("resendCooldown", { seconds: cooldown }) : t("resend")}
      </Button>
      <Link href="/entrar" className="text-base text-link underline">
        {t("backToLogin")}
      </Link>
    </div>
  );
}
