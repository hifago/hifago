"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Checkbox, Input, Label, TextField, toast } from "@hifago/ui";
import { OAuthSection } from "@/components/GoogleButton";
import { PartnerTermsModal } from "./PartnerTermsModal";

// Messages en espagnol en dur (2026-10-02 ; ils étaient en français) : cette app est hors
// next-intl (cf. hifago/CLAUDE.md — l'i18n ne vise qu'apps/web), pas une violation de la règle i18n.
const ERROR_MESSAGES: Record<string, string> = {
  invitation_not_found: "Este enlace de invitación no existe.",
  already_consumed: "Esta invitación ya fue utilizada.",
  already_revoked: "Esta invitación fue revocada.",
  already_expired: "Esta invitación expiró.",
  expired: "Esta invitación expiró.",
  account_already_has_partner: "Esta cuenta ya está vinculada a un socio.",
  not_authenticated: "No se pudo iniciar la sesión. Inténtalo de nuevo.",
  // Liste blanche des sessions anonymes (migration 20260909200000) : devenir partenaire
  // exige un compte réel. Un visiteur qui a seulement rempli un panier sur la vitrine et
  // ouvre un lien d'invitation tombe ici — le message doit lui dire quoi faire, pas juste
  // que c'est refusé.
  anonymous_not_allowed:
    "Crea una cuenta o inicia sesión antes de usar este enlace de invitación.",
  // Feature 31 (docs/specs/07-connexion-inscription-complete.md §7) : raisons propres à
  // POST /api/auth/invitation-signup — qui relaie aussi, telles quelles, celles de
  // consume_partner_invitation ci-dessus, puisqu'il consomme l'invitation lui-même.
  email_already_used: "Este correo ya lo usa otra cuenta.",
  session_failed: "No se pudo iniciar la sesión. Inténtalo de nuevo.",
  consume_failed: "Ocurrió un error. Inténtalo de nuevo.",
  invalid_request: "Indica tu nombre, tu correo y una contraseña.",
};

type ConsumeResult = { ok: boolean; reason?: string; roles?: string[]; partner_id?: string };
type SignupResult = { ok: boolean; reason?: string };
type InitialUser = { email: string; fullName: string } | null;

export function JoinForm({
  token,
  initialUser,
}: {
  token: string | null;
  initialUser: InitialUser;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialUser?.fullName ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  if (!token) {
    return (
      <p role="alert" data-testid="invalid-token-error" className="text-sm text-danger">
        Ce lien d&apos;invitation est invalide : le jeton est manquant.
      </p>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Inatteignable en pratique (l'écran affiche déjà le message "lien invalide" plus haut sans
    // rendre ce formulaire quand token est absent) — garde ici uniquement pour que TypeScript
    // resserre `token` en `string` dans cette fermeture, définie après ce early return.
    if (!token) return;
    setIsSubmitting(true);

    if (!initialUser) {
      // Feature 31 (docs/specs/07-connexion-inscription-complete.md §7) : la vérification email
      // (enable_confirmations = true) empêcherait désormais un signUp() client-side de renvoyer une
      // session immédiate — ce Route Handler crée le compte déjà confirmé côté serveur (service_role),
      // établit la session ET consomme l'invitation dans la même requête, pour que ce parcours reste
      // instantané comme avant. Rien à consommer ici : une seconde consommation échouerait.
      const signupResponse = await fetch("/api/auth/invitation-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, password, name }),
      });
      const signupResult = (await signupResponse.json()) as SignupResult;

      if (!signupResult.ok) {
        toast.danger(
          ERROR_MESSAGES[signupResult.reason ?? ""] ??
            "No se pudo crear la cuenta. Revisa tus datos o inicia sesión si ya tienes una cuenta."
        );
        setIsSubmitting(false);
        return;
      }
    } else {
      // Un visiteur déjà authentifié (retour de GoogleButton, ou toute session existante) saute la
      // création de compte email/mot de passe : consume_partner_invitation ne s'appuie que sur
      // auth.uid(), jamais sur le mode de connexion — inutile de repasser par le Route Handler
      // service_role qui ne sait créer QUE des comptes email/mot de passe.
      const supabase = createClient();

      // Un seul aller-retour pour la consommation elle-même — explicit_consent vaut true dès que ce
      // formulaire est soumis (case cochée obligatoire pour activer le bouton, pas une vérification
      // serveur en plus, cf. plan Feature 13).
      const { data, error: rpcError } = await supabase.rpc("consume_partner_invitation", {
        p_token: token,
        p_signer_name: name,
        p_document_version: "v1",
      });

      setIsSubmitting(false);

      if (rpcError) {
        toast.danger("Ocurrió un error. Inténtalo de nuevo.");
        return;
      }

      const result = data as ConsumeResult;
      if (!result.ok) {
        toast.danger(ERROR_MESSAGES[result.reason ?? ""] ?? "Ocurrió un error. Inténtalo de nuevo.");
        return;
      }
    }

    // Redirection immédiate vers le dashboard (spec §5.2) plutôt qu'un message inline : l'état
    // (rôle obtenu, établissement en attente éventuel) est recalculé à la volée par cette page,
    // pas transmis ici — robuste à un refresh, jamais un state éphémère perdu.
    toast.success("¡Te damos la bienvenida!");
    router.push("/partner");
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {!initialUser ? (
        // Le jeton survit à l'aller-retour Google via OAuthSection → GoogleButton →
        // /auth/callback?next=… (même mécanique que /login et /signup, cf. GoogleButton.tsx) — au
        // retour, page.tsx détecte la session et repasse initialUser, cette branche disparaît.
        <OAuthSection next={`/partner/join?token=${token}`} />
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="flex w-full flex-col gap-4">
        {initialUser ? (
          <p className="text-sm text-muted" data-testid="join-connected-as">
            Conectado como <span className="font-medium">{initialUser.email}</span>.
          </p>
        ) : null}

        <TextField fullWidth name="name" value={name} onChange={setName} isRequired>
          <Label>Nombre completo</Label>
          <Input />
        </TextField>
        {!initialUser ? (
          <>
            <TextField fullWidth name="email" value={email} onChange={setEmail} isRequired>
              <Label>Correo electrónico</Label>
              <Input type="email" autoComplete="email" />
            </TextField>
            <TextField fullWidth name="password" value={password} onChange={setPassword} isRequired>
              <Label>Contraseña</Label>
              <Input type="password" autoComplete="new-password" />
            </TextField>
          </>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Checkbox data-testid="consent-checkbox" isSelected={consent} onChange={setConsent}>
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              Acepto las condiciones del rol de socio.
            </Checkbox.Content>
          </Checkbox>
          {/* Hors de Checkbox.Content (CheckboxButton react-aria, toute la zone est pressable) —
              un bouton imbriqué y déclencherait aussi le toggle de la case au lieu d'ouvrir la
              modale seule. */}
          <button
            type="button"
            onClick={() => setTermsOpen(true)}
            data-testid="view-terms-button"
            className="self-start text-xs text-muted underline"
          >
            Ver las condiciones
          </button>
        </div>
        <PartnerTermsModal open={termsOpen} onOpenChange={setTermsOpen} />
        <Button type="submit" isDisabled={isSubmitting || !consent} data-testid="join-submit-button">
          {isSubmitting ? "Creando…" : "Unirme"}
        </Button>
      </form>
    </div>
  );
}
