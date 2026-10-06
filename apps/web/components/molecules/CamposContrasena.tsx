"use client";

import { PASSWORD_MIN_LENGTH } from "@hifago/domain";
import { Description, Input, Label, TextField } from "@hifago/ui";

/**
 * Le couple « mot de passe + confirmation » — la SEULE définition des champs de mot de passe de
 * la vitrine (`autoComplete="new-password"`, nommage des champs, texte d'aide).
 *
 * ⚠️ Recopié entre `SignupForm` et `ResetPasswordForm` : la durcir (8 caractères, une majuscule,
 * un indicateur de force) demandait de toucher deux fichiers, et rien n'aurait signalé l'oubli du
 * second. La comparaison des deux valeurs reste chez l'appelant : c'est lui qui possède le message
 * d'erreur et son namespace de traduction — une molécule ne traduit rien (convention du dépôt).
 *
 * La règle elle-même (8 caractères, lettres et chiffres, 2026-10-06) vit dans `@hifago/domain`
 * (`meetsPasswordPolicy`), commune aux deux apps et alignée sur Supabase Auth : l'appelant la
 * vérifie avant l'envoi et affiche son message — le formulaire est en `noValidate`, `minLength`
 * ne bloque rien. `ayudaPassword` (traduit par l'appelant) l'annonce sous le champ, avant l'erreur.
 */

export function CamposContrasena({
  password,
  confirmPassword,
  onPasswordChange,
  onConfirmPasswordChange,
  labelPassword,
  labelConfirmPassword,
  ayudaPassword,
}: {
  password: string;
  confirmPassword: string;
  onPasswordChange: (valeur: string) => void;
  onConfirmPasswordChange: (valeur: string) => void;
  labelPassword: string;
  labelConfirmPassword: string;
  ayudaPassword: string;
}) {
  return (
    <>
      <TextField name="password" value={password} onChange={onPasswordChange} isRequired>
        <Label>{labelPassword}</Label>
        <Input type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} />
        <Description data-testid="password-hint">{ayudaPassword}</Description>
      </TextField>
      <TextField
        name="confirm-password"
        value={confirmPassword}
        onChange={onConfirmPasswordChange}
        isRequired
      >
        <Label>{labelConfirmPassword}</Label>
        <Input type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} />
      </TextField>
    </>
  );
}
