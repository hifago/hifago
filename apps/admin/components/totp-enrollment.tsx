"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextField, toast } from "@hifago/ui";
import { purgeUnverifiedFactors, uniqueFactorName } from "@/lib/mfaFactors";

// Assistant d'enrôlement TOTP partagé par la page /mfa/enroll et la modale « Seguridad »
// (components/security-dialog.tsx). Supabase Auth fait toute la cryptographie ; ici seulement
// l'interface, modelée sur ce que font GitHub/Auth0 : QR ET clé texte, code de confirmation,
// sortie explicite (docs/specs/07-connexion-inscription-complete.md §5/§10).
//
// data.totp.qr_code est déjà un SVG prêt à l'emploi renvoyé par Supabase (GoTrue le génère
// server-side) — pas de librairie QR côté client ; data.totp.uri est l'URI otpauth:// équivalente.
//
// ⚠️ Aucun nettoyage dans le cleanup du useEffect : React StrictMode (dev) monte/démonte/remonte, un
// unenroll en cleanup supprimerait le facteur qu'on vient de créer. Les facteurs `unverified`
// abandonnés (fermeture de l'onglet) sont purgés au montage SUIVANT, et sur « Cancelar » ; sans ça
// ils s'accumulent jusqu'à `max_enrolled_factors` (config.toml) et l'enrôlement échoue.
export function TotpEnrollment({
  onEnrolled,
  onCancel,
  cancelLabel = "Cancelar",
}: {
  onEnrolled: () => void;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Distinct de la validation du code (toast seul, transitoire, réessayable) : un échec ici est une
  // panne au montage qui bloque tout l'assistant (factorId ne sera jamais posé) — le toast s'efface
  // en 4s et laisserait l'utilisateur sur un écran mort. Message persistant EN PLUS du toast, avec
  // « Reintentar » (exception documentée docs/specs/16-notifications-toast.md, cas limites).
  const [enrollFailed, setEnrollFailed] = useState(false);
  const started = useRef(false);

  const start = useCallback(async () => {
    const supabase = createClient();
    try {
      const existing = await purgeUnverifiedFactors(supabase);
      // Le premier TOTP reste sans nom ; les suivants (appareil de secours) en reçoivent un unique.
      let friendlyName: string | undefined;
      if (existing.some((factor) => factor.status === "verified")) {
        const { data: userData } = await supabase.auth.getUser();
        friendlyName = uniqueFactorName(`${userData.user?.email ?? "Hifago"} (respaldo)`);
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName });
      if (error || !data) throw new Error("enroll");
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setUri(data.totp.uri);
    } catch {
      toast.danger("No se pudo generar el código QR.");
      setEnrollFailed(true);
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  function retry() {
    setEnrollFailed(false);
    void start();
  }

  async function handleCancel() {
    if (factorId) {
      const supabase = createClient();
      await supabase.auth.mfa.unenroll({ factorId });
    }
    onCancel();
  }

  async function handleCopySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast.success("Clave copiada.");
    } catch {
      toast.danger("No se pudo copiar. Selecciónala y cópiala a mano.");
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!factorId) return;
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });
    setIsSubmitting(false);

    if (verifyError) {
      // Un autre onglet a ouvert son propre enrôlement et purgé celui-ci (purgeUnverifiedFactors) :
      // GoTrue ne connaît plus ce facteur. Dire « code incorrect » enverrait la personne retaper un
      // code qui ne passera jamais — on repart d'un nouveau QR, en le disant.
      if ("code" in verifyError && verifyError.code === "mfa_factor_not_found") {
        toast.danger("Este código QR ya no es válido (¿abriste otra pestaña?). Escanea el nuevo.");
        setFactorId(null);
        setQrCode(null);
        setSecret(null);
        setUri(null);
        setCode("");
        void start();
        return;
      }
      toast.danger("Código incorrecto. Inténtalo de nuevo.");
      return;
    }

    toast.success("Verificación en dos pasos activada.");
    onEnrolled();
  }

  if (enrollFailed) {
    return (
      <div className="flex w-full max-w-sm flex-col items-center gap-3">
        <p role="alert" data-testid="mfa-enroll-error" className="text-center text-sm text-danger">
          No se pudo generar el código QR.
        </p>
        <div className="flex gap-2">
          <Button type="button" onPress={retry} data-testid="mfa-enroll-retry">
            Reintentar
          </Button>
          <Button type="button" variant="outline" onPress={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted">
        <li>Abre tu app de autenticación (Google Authenticator, 1Password, Authy…).</li>
        <li>Escanea el código QR, o copia la clave a mano.</li>
        <li>Escribe aquí el código de 6 dígitos que muestra la app.</li>
      </ol>

      <div className="flex flex-col items-center gap-3">
        {qrCode ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URI SVG renvoyé par Supabase, pas une image Storage à optimiser via next/image.
          <img src={qrCode} alt="Código QR de verificación en dos pasos" width={200} height={200} />
        ) : (
          <p className="text-sm text-muted">Generando código…</p>
        )}
        {uri ? (
          // L'URI otpauth:// ne mène à rien sur un ordinateur (aucune app associée) : réservé au
          // mobile, où elle ouvre directement l'app de l'utilisateur sans scanner.
          <a
            href={uri}
            data-testid="mfa-open-app"
            className="text-sm font-medium text-foreground underline md:hidden"
          >
            ¿Estás en el móvil? Abrir en mi app de autenticación
          </a>
        ) : null}
        {secret ? (
          <div className="flex w-full flex-col items-center gap-2 text-center text-xs text-muted">
            <span>¿No puedes escanear? Escribe esta clave en tu app:</span>
            <code className="break-all font-mono text-sm text-foreground" data-testid="mfa-secret">
              {secret}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onPress={handleCopySecret}
              data-testid="mfa-copy-secret"
            >
              Copiar clave
            </Button>
          </div>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} noValidate className="flex w-full flex-col gap-4">
        <TextField name="code" value={code} onChange={setCode} isRequired>
          <Label>Código de 6 dígitos</Label>
          <Input inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
        </TextField>
        <div className="flex flex-col gap-2">
          <Button
            type="submit"
            isDisabled={isSubmitting || !factorId}
            data-testid="mfa-enroll-submit"
          >
            {isSubmitting ? "Verificando…" : "Activar"}
          </Button>
          <Button
            type="button"
            variant="outline"
            isDisabled={isSubmitting}
            onPress={handleCancel}
            data-testid="mfa-enroll-cancel"
          >
            {cancelLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}
