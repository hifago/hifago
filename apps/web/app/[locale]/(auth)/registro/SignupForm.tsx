"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
// ⚠️ `useRouter` d'`@/i18n/navigation`, jamais de `next/navigation` — voir LoginForm.tsx.
// Ici l'enjeu est direct : le `router.push` de fin d'inscription vise `/verificar-email`, et un
// anglophone y arrivait en espagnol.
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@hifago/supabase/client";
import { buildAuthCallbackRedirect, meetsPasswordPolicy, PASSWORD_MIN_LENGTH } from "@hifago/domain";
import { Input, Label, TextField } from "@hifago/ui";
import { Button } from "@/components/atoms/Button";
import { Aviso } from "@/components/molecules/Aviso";
import { CamposContrasena } from "@/components/molecules/CamposContrasena";
import { OAuthSection } from "@/components/molecules/GoogleButton";

// Adapté de l'ancien apps/admin/app/signup/SignupForm.tsx (git show bb254e9, supprimé depuis —
// périmètre closed pour l'admin, cf. supabase/config.toml §11.13/§11.14, sans rapport avec ici) et
// localisé via useTranslations (apps/web est routé ES/EN, contrairement à apps/admin).
//
// `OAuthSection` était l'écart assumé de la feature 32 (« hors périmètre, cadrage minimale ») —
// REFERMÉ le 2026-09-11 : cf. l'en-tête de `components/molecules/GoogleButton.tsx`. Un même bouton
// sert la connexion ET l'inscription, `signInWithOAuth` créant le compte s'il n'existe pas ; c'est
// cohérent avec l'inscription libre que cet écran assume déjà (registro/page.tsx).
export function SignupForm({ next, initialEmail = "" }: { next: string; initialEmail?: string }) {
  const t = useTranslations("Signup");
  const locale = useLocale();
  const router = useRouter();
  // Spec 33 : pré-rempli quand on arrive depuis l'écran de résultat d'une commande — le
  // rattachement se fait par adresse email, une autre adresse ne retrouverait rien. Reste éditable.
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Règle commune aux deux apps, miroir de Supabase Auth : dite avant l'envoi plutôt qu'en
    // « erreur générique » au retour.
    if (!meetsPasswordPolicy(password)) {
      setError(t("passwordPolicy", { min: PASSWORD_MIN_LENGTH }));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();

    // emailRedirectTo absolu, locale déjà encodée dans `next` : ce lien part dans l'email de
    // confirmation (supabase/templates/confirmation.html, {{ .RedirectTo }}), une navigation
    // externe hors client-side router — le router.push ci-dessous, lui, est localisé.
    // buildAuthCallbackRedirect (@hifago/domain) : même contrat déjà écrit à la main 3 fois côté
    // apps/admin (GoogleButton.tsx, ForgotPasswordForm.tsx, EmailBlock.tsx) — extrait ici plutôt
    // que dupliqué une 4e fois.
    const emailRedirectTo = buildAuthCallbackRedirect({
      origin: window.location.origin,
      next: `/${locale}${next === "/" ? "" : next}`,
    });

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo },
    });
    setIsSubmitting(false);

    if (signUpError) {
      // Message générique (ni email_exists ni user_already_exists distingué) — même discipline
      // que l'ancien écran admin : ne jamais confirmer l'existence d'un compte par ce message.
      // `weak_password` n'en dit rien : c'est la règle du serveur, si elle diffère un jour de la
      // nôtre.
      setError(
        signUpError.code === "weak_password"
          ? t("passwordPolicy", { min: PASSWORD_MIN_LENGTH })
          : t("genericError")
      );
      return;
    }

    // Compte déjà confirmé (ex. rare cas de lien automatique) : session immédiate, sinon
    // confirmation par email requise.
    if (data.session) {
      router.push(next);
      router.refresh();
      return;
    }

    router.push(`/verificar-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <OAuthSection next={next} />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField name="email" value={email} onChange={setEmail} isRequired>
          <Label>{t("email")}</Label>
          <Input type="email" autoComplete="email" />
        </TextField>
        <CamposContrasena
          password={password}
          confirmPassword={confirmPassword}
          onPasswordChange={setPassword}
          onConfirmPasswordChange={setConfirmPassword}
          labelPassword={t("password")}
          labelConfirmPassword={t("confirmPassword")}
          ayudaPassword={t("passwordHint", { min: PASSWORD_MIN_LENGTH })}
        />
        {error ? (
          <Aviso tono="error" rol="alert" testId="signup-error">
            <p>{error}</p>
          </Aviso>
        ) : null}
        <Button
          type="submit"
          size="lg"
          width="full"
          isPending={isSubmitting}
          pendingLabel={t("submitting")}
          testId="signup-submit-button"
        >
          {t("submit")}
        </Button>
      </form>

      <p className="text-center text-base text-muted">
        {t("loginLink")}{" "}
        <Link
          href={next !== "/" ? `/entrar?next=${encodeURIComponent(next)}` : "/entrar"}
          className="underline"
        >
          {t("loginLinkAction")}
        </Link>
      </p>
    </div>
  );
}
