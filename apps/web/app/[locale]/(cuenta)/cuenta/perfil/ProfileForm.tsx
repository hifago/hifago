"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@hifago/supabase/client";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/atoms/Button";
import { PhoneField } from "@/components/atoms/PhoneField";
import { TextField, Input, Label } from "@hifago/ui";

// Spec 35 Tranche 3 — édition du profil. N'APPELLE PAS UNE RPC ÉCRITE POUR CE LOT :
// `update_my_account_profile` existe depuis le 2026-08-19 pour l'écran socio `apps/admin`, déjà
// `grant`ée à `authenticated`. Même contrat, même deux colonnes — la redéfinir ici aurait créé une
// seconde source de vérité pour la même règle (« le nom est obligatoire, le téléphone ne l'est
// pas », vue dans son corps SQL).
//
// Succès affiché EN LIGNE, jamais par toast : `SiteToaster` n'est monté nulle part dans `apps/web`
// (dette connue depuis le 2026-09-02) — c'est pourquoi `apps/admin/.../ProfileBlock.tsx` (même RPC)
// ne peut pas servir de modèle tel quel malgré la ressemblance.

type UpdateProfileResult = { ok: boolean };

export function ProfileForm({
  initialFullName,
  initialPhone,
}: {
  initialFullName: string;
  initialPhone: string;
}) {
  const t = useTranslations("AccountProfilePage");
  const router = useRouter();
  const [fullName, setFullName] = useState(initialFullName);
  const [phone, setPhone] = useState(initialPhone);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<"success" | "error" | null>(null);
  const isDirty = fullName !== initialFullName || phone !== initialPhone;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFeedback(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("update_my_account_profile", {
      p_full_name: fullName.trim(),
      p_phone: phone.trim() || undefined,
    });
    const result = data as UpdateProfileResult | null;
    setIsSubmitting(false);

    if (error || !result?.ok) {
      setFeedback("error");
      return;
    }

    setFeedback("success");
    // La liste blanche (security_definer_exposure.test.sql) et le tunnel (`pago/page.tsx`, T5)
    // relisent tous deux `partner_accounts` côté serveur : `router.refresh()` garde ce composant
    // simple (pas d'état local à resynchroniser) et le prochain rendu serveur reflète la vraie base.
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4" data-testid="profile-form">
      <TextField name="full-name" value={fullName} onChange={setFullName} isRequired>
        <Label>{t("fullNameLabel")}</Label>
        <Input autoComplete="name" data-testid="profile-full-name-input" />
      </TextField>
      <PhoneField
        label={t("phoneLabel")}
        countryLabel={t("phoneCountryLabel")}
        value={phone}
        onChange={setPhone}
        name="phone"
        testId="profile-phone"
      />
      {feedback === "success" ? (
        <p role="status" className="text-sm text-success" data-testid="profile-save-success">
          {t("saveSuccess")}
        </p>
      ) : null}
      {feedback === "error" ? (
        <p role="alert" className="text-sm text-danger" data-testid="profile-save-error">
          {t("saveError")}
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        isDisabled={!isDirty}
        isPending={isSubmitting}
        pendingLabel={t("saving")}
        width="auto"
        testId="profile-save-button"
      >
        {t("saveButton")}
      </Button>
    </form>
  );
}
