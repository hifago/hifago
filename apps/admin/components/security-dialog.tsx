"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { formatDateInBogota } from "@hifago/domain";
import { createClient } from "@hifago/supabase/client";
import { Alert, Button, Chip, Modal, toast } from "@hifago/ui";
import { factorLabels, purgeUnverifiedFactors, uniqueFactorName } from "@/lib/mfaFactors";
import { TotpEnrollment } from "./totp-enrollment";

type VerifiedFactor = { id: string; factor_type: string; created_at: string };

// Gestion du 2FA depuis l'app (docs/specs/07-connexion-inscription-complete.md §10) : où l'on active
// (app d'authentification TOTP ou clé de sécurité WebAuthn), ajoute un second appareil de secours,
// ou retire. Supabase Auth MFA fait toute la cryptographie ; ceci n'est que l'interface — ouverte
// depuis « Seguridad » en pied de la barre de navigation.
//
// Le secours de Supabase, c'est un SECOND facteur (pas de codes à usage unique) : d'où l'avertissement
// tant qu'il n'y en a qu'un. Retirer un facteur vérifié exige une session AAL2 — toujours le cas ici,
// puisque le garde (mfaGuard) impose le défi à tout compte qui en a un avant d'atteindre l'app.
async function fetchVerifiedFactors(): Promise<VerifiedFactor[] | null> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return null;
  // Plus ancien d'abord : la numérotation (« App de autenticación 1 », « Llave de seguridad 1 »…) ne
  // change pas quand on en ajoute un, et la date d'ajout permet de reconnaître l'appareil à retirer.
  return data.all
    .filter((factor) => factor.status === "verified")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// Aucun abonnement : la prise en charge ne change pas pendant la vie de la page. Le snapshot serveur
// vaut « non » (pas d'écart d'hydratation : le bouton n'apparaît qu'après coup, côté navigateur).
function useSupportsWebAuthn() {
  return useSyncExternalStore(
    () => () => {},
    () => typeof window !== "undefined" && "PublicKeyCredential" in window,
    () => false
  );
}

export function SecurityDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal>
      <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
        <Modal.Container>
          <Modal.Dialog data-testid="security-dialog">
            {/* Le contenu n'est monté qu'à l'ouverture : chaque ouverture repart d'une liste fraîche
                (un facteur ajouté ou retiré depuis un autre onglet ne reste pas affiché), sans
                réinitialiser l'état à la main dans un effet. */}
            <SecurityPanel onClose={() => onOpenChange(false)} />
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function SecurityPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [view, setView] = useState<"list" | "enroll">("list");
  const [factors, setFactors] = useState<VerifiedFactor[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [registeringKey, setRegisteringKey] = useState(false);
  const supportsWebAuthn = useSupportsWebAuthn();

  // Lecture pure (aucun setState) : l'effet de montage et les rechargements après action passent par
  // la même requête, chacun appliquant le résultat depuis son propre rappel.
  const applyResult = useCallback((result: VerifiedFactor[] | null) => {
    setLoadFailed(result === null);
    if (result !== null) setFactors(result);
  }, []);

  const reload = useCallback(async () => {
    applyResult(await fetchVerifiedFactors());
  }, [applyResult]);

  useEffect(() => {
    void fetchVerifiedFactors().then(applyResult);
  }, [applyResult]);

  async function handleRemove(factorId: string) {
    setRemovingId(factorId);
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) {
      setRemovingId(null);
      toast.danger("No se pudo quitar el dispositivo. Inténtalo de nuevo.");
      return;
    }
    // Sans refresh, le JWT garde son claim aal2 jusqu'à son renouvellement naturel.
    await supabase.auth.refreshSession();
    setRemovingId(null);
    setConfirmingId(null);
    toast.success("Dispositivo quitado.");
    router.refresh();
    await reload();
  }

  // Clé de sécurité (WebAuthn) : enroll → challenge → cérémonie du navigateur → verify, en un appel du
  // SDK. Le nom est obligatoire et doit être unique pour le compte (cf. uniqueFactorName).
  async function handleAddKey() {
    setRegisteringKey(true);
    const supabase = createClient();
    await purgeUnverifiedFactors(supabase);
    const { error } = await supabase.auth.mfa.webauthn.register({
      friendlyName: uniqueFactorName("Llave de seguridad"),
    });
    setRegisteringKey(false);
    if (error) {
      // Annulée par la personne (fenêtre du navigateur fermée, délai dépassé) : pas une panne.
      const cancelled = "code" in error && error.code === "ERROR_CEREMONY_ABORTED";
      toast.danger(
        cancelled
          ? "Operación cancelada. Inténtalo de nuevo cuando tengas tu llave a mano."
          : "No se pudo registrar la llave de seguridad."
      );
      return;
    }
    toast.success("Llave de seguridad añadida.");
    router.refresh();
    await reload();
  }

  async function handleEnrolled() {
    setView("list");
    router.refresh();
    await reload();
  }

  const count = factors?.length ?? 0;
  const labels = factorLabels(factors ?? []);

  return (
    <>
      <Modal.Header>
        <Modal.Heading>
          {view === "enroll" ? "Activar verificación en dos pasos" : "Seguridad"}
        </Modal.Heading>
      </Modal.Header>
      <Modal.Body className="flex flex-col gap-4">
        {view === "enroll" ? (
          <TotpEnrollment onEnrolled={handleEnrolled} onCancel={() => setView("list")} />
        ) : loadFailed ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-danger" data-testid="security-load-error">
              No se pudo leer tu configuración de seguridad.
            </p>
            <Button type="button" variant="outline" size="sm" onPress={() => void reload()}>
              Reintentar
            </Button>
          </div>
        ) : factors === null ? (
          <p className="text-sm text-muted">Cargando…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Verificación en dos pasos</span>
              <Chip
                color={count > 0 ? "success" : "default"}
                variant="soft"
                data-testid="security-status"
              >
                {count > 0 ? "Activada" : "No activada"}
              </Chip>
            </div>

            {count === 0 ? (
              <p className="text-sm text-muted">
                Añade una segunda capa de seguridad: además de tu contraseña (o de Google), te
                pediremos un código de tu app de autenticación, o tu llave de seguridad, en cada
                inicio de sesión.
              </p>
            ) : (
              <>
                <ul className="flex flex-col gap-2" data-testid="security-factors">
                  {factors.map((factor) => (
                    <li
                      key={factor.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                      data-testid="security-factor"
                    >
                      <span className="text-sm">
                        {labels.get(factor.id) ?? "Dispositivo"}
                        <span className="text-muted">
                          {" "}
                          · añadida el {formatDateInBogota(factor.created_at, "es-CO")}
                        </span>
                      </span>
                      {confirmingId === factor.id ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            isDisabled={removingId !== null}
                            onPress={() => void handleRemove(factor.id)}
                            data-testid="security-remove-confirm"
                          >
                            {removingId === factor.id ? "Quitando…" : "Sí, quitar"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            isDisabled={removingId !== null}
                            onPress={() => setConfirmingId(null)}
                          >
                            Cancelar
                          </Button>
                        </span>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onPress={() => setConfirmingId(factor.id)}
                          data-testid="security-remove"
                        >
                          Quitar
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {confirmingId !== null && count === 1 ? (
                  <p className="text-sm text-muted">
                    Es tu único dispositivo: al quitarlo, la verificación en dos pasos queda
                    desactivada.
                  </p>
                ) : null}
                {count === 1 ? (
                  <Alert status="warning" data-testid="security-backup-hint">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>Añade un dispositivo de respaldo</Alert.Title>
                      <Alert.Description>
                        Si pierdes este dispositivo sin tener otro, otro administrador de Hifago
                        tendrá que desactivar tu verificación. Registra un segundo dispositivo: otra
                        app de autenticación (o un gestor de contraseñas con códigos TOTP) o una
                        llave de seguridad.
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : null}
              </>
            )}
          </>
        )}
      </Modal.Body>
      {view === "list" && factors !== null ? (
        <Modal.Footer className="flex flex-wrap gap-2">
          <Button
            type="button"
            isDisabled={registeringKey}
            onPress={() => setView("enroll")}
            data-testid="security-enable"
          >
            {count === 0 ? "Activar con una app" : "Añadir otra app"}
          </Button>
          {supportsWebAuthn ? (
            <Button
              type="button"
              variant="outline"
              isDisabled={registeringKey}
              onPress={() => void handleAddKey()}
              data-testid="security-add-key"
            >
              {registeringKey ? "Esperando la llave…" : "Añadir una llave de seguridad"}
            </Button>
          ) : null}
          <Button type="button" variant="outline" isDisabled={registeringKey} onPress={onClose}>
            Cerrar
          </Button>
        </Modal.Footer>
      ) : null}
    </>
  );
}
