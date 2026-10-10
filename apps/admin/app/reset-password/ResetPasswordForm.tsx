"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { meetsPasswordPolicy, PASSWORD_MIN_LENGTH } from "@hifago/domain";
import { createClient } from "@hifago/supabase/client";
import { Button, Description, Input, Label, TextField, toast } from "@hifago/ui";
import { PASSWORD_HINT, PASSWORD_POLICY_ERROR, SAME_PASSWORD_ERROR } from "@/lib/auth/passwordMessages";

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!meetsPasswordPolicy(password)) {
      toast.danger(PASSWORD_POLICY_ERROR);
      return;
    }
    if (password !== confirmPassword) {
      toast.danger("Las contraseñas no coinciden.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsSubmitting(false);

    // Une session de récupération est neuve : la ré-authentification de `secure_password_change`
    // ne la concerne jamais (elle ne vise que les sessions de plus de 24 h).
    if (updateError) {
      if (updateError.code === "weak_password") toast.danger(PASSWORD_POLICY_ERROR);
      else if (updateError.code === "same_password") toast.danger(SAME_PASSWORD_ERROR);
      else toast.danger("No se pudo restablecer la contraseña. Inténtalo de nuevo.");
      return;
    }

    toast.success("Contraseña actualizada.");

    // La session de récupération, une fois le mot de passe posé, est une session valide comme une
    // autre (docs/specs/07-connexion-inscription-complete.md §4) — pas de reconnexion à refaire.
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full max-w-sm flex-col gap-4">
      <TextField name="password" value={password} onChange={setPassword} isRequired>
        <Label>Nueva contraseña</Label>
        <Input type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} />
        <Description>{PASSWORD_HINT}</Description>
      </TextField>
      <TextField
        name="confirm-password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        isRequired
      >
        <Label>Confirmar contraseña</Label>
        <Input type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} />
      </TextField>
      <Button type="submit" isDisabled={isSubmitting} data-testid="reset-password-submit">
        {isSubmitting ? "Guardando…" : "Restablecer contraseña"}
      </Button>
    </form>
  );
}
