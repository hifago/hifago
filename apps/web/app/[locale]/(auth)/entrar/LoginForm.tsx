"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
// ⚠️ `useRouter` vient d'`@/i18n/navigation`, JAMAIS de `next/navigation` (contrôlé par
// scripts/check-i18n-links.sh depuis le 2026-09-07). `localePrefix: "always"` : le routeur nu
// pousse `/pago`, un chemin qui n'existe pas — le proxy le rattrape par une redirection qui
// redevine la langue depuis un cookie au lieu de garder celle de la page lue. Rien ne casse
// visiblement, et c'est bien le problème.
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@hifago/supabase/client";
import { Input, Label, TextField } from "@hifago/ui";
import { Button } from "@/components/atoms/Button";
import { OAuthSection } from "@/components/molecules/GoogleButton";

// `callbackFailed` : posé par `page.tsx` depuis `?error=auth_callback_failed`. Cette redirection
// existait depuis la feature 32 (`app/auth/callback/route.ts`) et RIEN ne l'affichait — un échec de
// confirmation d'email ramenait sur un écran de connexion muet. Le chemin devient réellement
// emprunté maintenant qu'une entrée Google existe : son échec passe par là aussi.
export function LoginForm({ next, callbackFailed = false }: { next: string; callbackFailed?: boolean }) {
  const t = useTranslations("Login");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Initialisé depuis la prop plutôt que rendu dans un second bloc d'alerte : deux `role="alert"`
  // sur le même écran se disputent l'annonce, et le premier envoi efface de toute façon celui-ci.
  const [error, setError] = useState<string | null>(
    callbackFailed ? tCommon("oauth.callbackFailed") : null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();

    // ⚠️ Retour Jérôme (2026-09-14) : un panier ajouté en visiteur (session anonyme, spec 31
    // invariant 1) disparaissait après connexion vers un compte RÉEL déjà existant — jamais
    // documenté nulle part (spec 32 §10 ne parle que des COMMANDES déjà passées, via
    // `attach_orders_to_account`, appelée à l'INSCRIPTION seulement). Cause : `cart_items` est
    // scopé par `account_id`, `signInWithPassword` bascule `auth.uid()` sur une identité TOTALEMENT
    // différente (spec 31 invariant 7 interdit `linkIdentity`/`updateUser({email})`), et la RLS
    // (`cart_items_select`, `account_id = auth.uid()`) rend les lignes de l'ancienne identité
    // structurellement invisibles à la nouvelle — pas un cache, reproductible à chaque fois.
    //
    // Correctif : lecture PUIS réécriture par CE MÊME client, aux deux instants (avant/après le
    // changement d'identité) — jamais un rattachement serveur cross-identité comme
    // `attach_orders_to_account` (qui, lui, prouve l'identité par un EMAIL VÉRIFIÉ ; `cart_items` ne
    // porte aucun email, cette preuve n'existe pas ici). Best-effort : une erreur de lecture/écriture
    // ne bloque jamais la connexion elle-même — cohérent avec le reste du panier (attribution,
    // CartContext.tsx).
    const { data: anonLines } = await supabase
      .from("cart_items")
      .select("product_id, date, end_date, slot_start_time, qty");

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(t("error"));
      setIsSubmitting(false);
      return;
    }

    if (anonLines && anonLines.length > 0) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        await supabase
          .from("cart_items")
          .insert(anonLines.map((line) => ({ ...line, account_id: session.user.id })));
      }
    }

    router.push(next);
    router.refresh();
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <OAuthSection next={next} />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField name="email" value={email} onChange={setEmail} isRequired>
          <Label>{t("email")}</Label>
          <Input type="email" autoComplete="email" />
        </TextField>
        <TextField name="password" value={password} onChange={setPassword} isRequired>
          <Label>{t("password")}</Label>
          <Input type="password" autoComplete="current-password" />
        </TextField>
        <Link
          href="/olvide-password"
          data-testid="forgot-password-link"
          className="self-start text-xs text-muted underline"
        >
          {t("forgotPasswordLink")}
        </Link>
        {error ? (
          <p role="alert" data-testid="login-error" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" isDisabled={isSubmitting}>
          {isSubmitting ? t("submitting") : t("submit")}
        </Button>
      </form>

      {/* Un client n'a besoin d'aucune capacité pour exister (contrairement à admin, où le
          point d'entrée self-service a été retiré le 2026-08-19 — décision propre à ce
          contexte-là, sans rapport ici) — lien discret vers l'inscription, jamais mis en avant. */}
      <p className="text-center text-sm text-muted">
        <Link
          href={next !== "/" ? `/registro?next=${encodeURIComponent(next)}` : "/registro"}
          className="underline"
        >
          {t("signupLink")}
        </Link>
      </p>
    </div>
  );
}
