"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { REF_CODE_MAX_LENGTH } from "@hifago/domain";
import {
  Button,
  Description,
  Input,
  Label,
  ListBox,
  Select,
  toast,
} from "@hifago/ui";

type OnboardingPath = "referrer" | "provider";
type CreateInvitationResult = { ok: boolean; invitation_id?: string; token?: string };

export function NewInvitationForm() {
  const [code, setCode] = useState("");
  const [onboardingPath, setOnboardingPath] = useState<OnboardingPath | "">("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    // Même borne que la vitrine (REF_CODE_MAX_LENGTH, @hifago/domain), qui ignore un code plus
    // long : créé ici, il aurait perdu son attribution en silence. Refus explicite, jamais une
    // troncature (un `maxLength` couperait un code collé sans le dire).
    if (code.trim().length > REF_CODE_MAX_LENGTH) {
      toast.danger(`El código no puede tener más de ${REF_CODE_MAX_LENGTH} caracteres.`);
      return;
    }
    if (!code.trim() || !onboardingPath) {
      toast.danger("El código y el tipo de invitación son obligatorios.");
      return;
    }

    setIsSubmitting(true);

    // Un seul aller-retour (jamais de génération de jeton côté client) — le jeton brut n'est
    // retourné qu'ici, une seule fois : seul son hash persiste côté serveur. p_email optionnel
    // (spec 23) : canal email EN PLUS du lien à copier-coller, jamais un remplacement — sans
    // email, le flux WhatsApp manuel reste inchangé.
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_partner_invitation", {
      p_code: code.trim(),
      p_onboarding_path: onboardingPath,
      p_email: email.trim() || undefined,
    });

    setIsSubmitting(false);

    const result = data as CreateInvitationResult | null;
    if (rpcError || !result?.ok || !result.token) {
      // Código ya asignado a otro socio (create_partner_invitation, errcode 23505) : message
      // précis plutôt que le générique ci-dessous — le seul cas où l'échec vient d'une saisie
      // corrigeable par l'admin, pas d'un problème réseau/serveur.
      toast.danger(rpcError?.code === "23505" ? rpcError.message : "No se pudo crear la invitación.");
      return;
    }

    toast.success("Invitación creada.");
    setLink(`${window.location.origin}/partner/join?token=${result.token}`);
  }

  async function handleCopy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
  }

  if (link) {
    return (
      <div className="flex max-w-md flex-col gap-4">
        <Description>
          Este enlace solo se muestra una vez — cópialo ahora, no podrás recuperarlo después (solo
          su hash queda guardado).
        </Description>
        {email.trim() ? (
          <Description data-testid="invitation-email-sent-hint">
            También se envió por correo a {email.trim()}.
          </Description>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invitation-link">Enlace de invitación</Label>
          <Input id="invitation-link" data-testid="invitation-link" readOnly value={link} />
        </div>
        <Button type="button" onPress={handleCopy} data-testid="copy-link-button">
          {copied ? "Copiado" : "Copiar enlace"}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="code">Código</Label>
        <Input
          id="code"
          name="code"
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Select
          fullWidth
          placeholder="Selecciona un tipo"
          value={onboardingPath === "" ? null : onboardingPath}
          onChange={(value) => setOnboardingPath((value as OnboardingPath | null) ?? "")}
        >
          <Label htmlFor="onboarding-path">Tipo de invitación</Label>
          <Select.Trigger id="onboarding-path" data-testid="onboarding-path-select">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="referrer" textValue="Referente">
                Referente
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="provider" textValue="Prestador">
                Prestador
                <ListBox.ItemIndicator />
              </ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invitation-email">Correo (opcional)</Label>
        <Input
          id="invitation-email"
          name="invitation-email"
          type="email"
          data-testid="invitation-email-input"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Description>
          Si lo completas, la invitación también se envía por correo — el enlace de arriba sigue
          disponible para copiar y compartir manualmente (ej. WhatsApp).
        </Description>
      </div>
      <Button type="submit" isDisabled={isSubmitting} data-testid="create-invitation-button">
        {isSubmitting ? "Creando…" : "Crear invitación"}
      </Button>
    </form>
  );
}
