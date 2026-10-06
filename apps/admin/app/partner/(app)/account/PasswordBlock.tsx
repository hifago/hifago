"use client";

import { useState } from "react";
import { meetsPasswordPolicy, PASSWORD_MIN_LENGTH } from "@hifago/domain";
import { createClient } from "@hifago/supabase/client";
import { Button, Card, Description, Input, Label, TextField, toast } from "@hifago/ui";
import { PASSWORD_HINT, PASSWORD_POLICY_ERROR, SAME_PASSWORD_ERROR } from "@/lib/auth/passwordMessages";

// Changement de mot de passe depuis /partner/account. `secure_password_change` est ACTIF depuis le
// 2026-10-06 : une session de plus de 24 h doit prouver qu'elle tient encore la boîte mail.
// Supabase Auth répond alors `reauthentication_needed` ; ce bloc fait envoyer un code par e-mail
// (`reauthenticate()`), puis renvoie le même mot de passe avec ce code (`nonce`). Une session
// récente change directement : le serveur ne demande rien, et ce bloc non plus. Le déclencheur
// est la réponse du serveur, jamais un calcul de l'âge de la session ici : il reste juste même si
// le réglage est coupé, ou sa fenêtre changée. Les champs restent modifiables pendant l'attente du
// code : il n'est pas lié au mot de passe, et un refus (même mot de passe…) se corrige sans en
// redemander un.

const MESSAGES: Record<string, string> = {
  weak_password: PASSWORD_POLICY_ERROR,
  same_password: SAME_PASSWORD_ERROR,
  reauthentication_not_valid: "El código no es válido o ya venció. Pide uno nuevo.",
  over_email_send_rate_limit: "Espera unos segundos antes de pedir otro código.",
  // Compte doté d'un second facteur, session encore en un seul facteur.
  insufficient_aal: "Para cambiar la contraseña, primero confirma tu verificación en dos pasos.",
};

export function PasswordBlock() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  // Un code a été envoyé : le changement attend sa saisie.
  const [codeSent, setCodeSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isDirty = password !== "" || confirmPassword !== "";

  function reset() {
    setPassword("");
    setConfirmPassword("");
    setCode("");
    setCodeSent(false);
  }

  async function sendCode() {
    const { error } = await createClient().auth.reauthenticate();
    if (error) {
      toast.danger(MESSAGES[error.code ?? ""] ?? "No se pudo enviar el código. Inténtalo de nuevo.");
      return false;
    }
    setCodeSent(true);
    return true;
  }

  async function resendCode() {
    setIsSubmitting(true);
    if (await sendCode()) toast.success("Te enviamos un código nuevo.");
    setIsSubmitting(false);
  }

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
    if (codeSent && code.trim() === "") {
      toast.danger("Ingresa el código que te enviamos por correo.");
      return;
    }

    setIsSubmitting(true);
    const { error } = await createClient().auth.updateUser(
      codeSent ? { password, nonce: code.trim() } : { password }
    );
    if (error?.code === "reauthentication_needed") {
      await sendCode();
      setIsSubmitting(false);
      return;
    }
    setIsSubmitting(false);

    if (error) {
      toast.danger(MESSAGES[error.code ?? ""] ?? "No se pudo actualizar la contraseña. Inténtalo de nuevo.");
      return;
    }

    toast.success("Contraseña actualizada.");
    reset();
  }

  return (
    <Card data-testid="password-block">
      <Card.Header>
        <Card.Title>Contraseña</Card.Title>
      </Card.Header>
      <Card.Content>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <TextField
            name="password"
            value={password}
            onChange={setPassword}
            isRequired
          >
            <Label>Nueva contraseña</Label>
            <Input
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              data-testid="account-password-input"
            />
            <Description>{PASSWORD_HINT}</Description>
          </TextField>
          <TextField
            name="confirm-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            isRequired
          >
            <Label>Confirmar contraseña</Label>
            <Input
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              data-testid="account-confirm-password-input"
            />
          </TextField>
          {codeSent ? (
            <TextField name="reauth-code" value={code} onChange={setCode} isRequired>
              <Label>Código de verificación</Label>
              {/* Le champ apparaît après l'envoi : le focus y va, c'est là que l'on attend la saisie. */}
              <Input
                autoComplete="one-time-code"
                inputMode="numeric"
                autoFocus
                data-testid="account-reauth-code-input"
              />
              <Description data-testid="account-reauth-code-hint">
                Por seguridad, te enviamos un código a tu correo. Ingrésalo para confirmar el cambio.
              </Description>
            </TextField>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" isDisabled={isSubmitting || !isDirty} data-testid="save-password-button">
              {isSubmitting ? "Guardando…" : codeSent ? "Confirmar cambio" : "Guardar"}
            </Button>
            {codeSent ? (
              <>
                <Button
                  variant="outline"
                  isDisabled={isSubmitting}
                  onPress={resendCode}
                  data-testid="resend-reauth-code-button"
                >
                  Reenviar código
                </Button>
                <Button
                  variant="ghost"
                  isDisabled={isSubmitting}
                  onPress={reset}
                  data-testid="cancel-password-change-button"
                >
                  Cancelar
                </Button>
              </>
            ) : null}
          </div>
        </form>
      </Card.Content>
    </Card>
  );
}
