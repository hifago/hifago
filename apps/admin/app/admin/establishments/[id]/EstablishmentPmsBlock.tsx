"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Checkbox, Input, Label, TextArea, TextField, toast } from "@hifago/ui";
import { formatDateTimeInBogota } from "@hifago/domain";
import { ActionConfirmation } from "@/components/action-confirmation";

// Spec 21 §5 — bloc "Connecteur PMS" de la fiche établissement. Le jeton LobbyPMS n'est jamais
// relu depuis la base (illisible même pour l'admin via PostgREST, cf. migration
// 20260819110000_pms_connector_schema.sql) : le champ démarre toujours vide, "Guardar" ne remplace
// le jeton en base que si l'admin a effectivement tapé une nouvelle valeur (sinon coalesce côté
// RPC préserve l'existant). "Tester la connexion" utilise le jeton TAPÉ à l'écran, jamais celui
// déjà en base (piège documenté hifago/CLAUDE.md §11.4-5 : cibler .locator("input") en test, pas
// le wrapper Checkbox).
//
// Remplacer un jeton déjà posé suppose, par défaut, un AUTRE compte Lobby (migration
// 20261004005336) : les bookings posés avec l'ancien jeton ne sont plus interrogés ni annulés
// automatiquement et passent en vérification manuelle. La case « misma cuenta » le dit pour une
// simple rotation du jeton sur le même compte — proposée seulement quand un jeton existe déjà et
// qu'un nouveau est tapé, décochée par défaut.
export function EstablishmentPmsBlock({
  establishmentId,
  initialConnectorActive,
  initialHasToken,
  initialLastSyncedAt,
}: {
  establishmentId: string;
  initialConnectorActive: boolean;
  initialHasToken: boolean;
  initialLastSyncedAt: string | null;
}) {
  const router = useRouter();

  const [connectorActive, setConnectorActive] = useState(initialConnectorActive);
  const [token, setToken] = useState("");
  const [sameLobbyAccount, setSameLobbyAccount] = useState(false);
  const replacingToken = initialHasToken && token.trim() !== "";
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  // Confirmation contenue dans cette carte (docs/specs/40 §4) — jamais plein écran, jamais
  // déclenchée par « Probar conexión » (diagnostic, pas une sauvegarde). Toujours « admin/succès »
  // (bloc jamais atteint par un partenaire).
  const [showConfirmation, setShowConfirmation] = useState(false);

  async function handleTestConnection() {
    if (!token.trim()) {
      toast.danger("Ingresa un token antes de probar la conexión.");
      return;
    }
    setIsTesting(true);
    try {
      const response = await fetch("/api/pms/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiToken: token.trim() }),
      });
      const result = (await response.json()) as { ok: boolean; roomsCount?: number };
      if (!result.ok) {
        toast.danger("No se pudo conectar con LobbyPMS.");
        return;
      }
      toast.success(`Conexión exitosa (${result.roomsCount ?? 0} categorías encontradas).`);
    } catch {
      toast.danger("No se pudo conectar con LobbyPMS.");
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!reason.trim()) {
      toast.danger("El motivo es obligatorio.");
      return;
    }

    setIsSubmitting(true);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("set_establishment_pms_connector", {
      p_establishment_id: establishmentId,
      p_lobby_api_token: token.trim() || undefined,
      p_connector_active: connectorActive,
      p_reason: reason.trim(),
      p_same_lobby_account: replacingToken && sameLobbyAccount,
    });

    setIsSubmitting(false);

    const result = data as { ok: boolean } | null;
    if (rpcError || !result?.ok) {
      toast.danger("No se pudo actualizar el conector PMS.");
      return;
    }

    setToken("");
    setSameLobbyAccount(false);
    setReason("");
    router.refresh();
    setShowConfirmation(true);
  }

  return (
    <div className="rounded-lg border bg-surface p-4" data-testid="establishment-pms-block">
      <h2 className="mb-4 text-sm font-medium">Conector PMS (LobbyPMS)</h2>

      <div className="mb-4 flex flex-col gap-1 text-sm text-muted">
        <p data-testid="pms-has-token-status">
          Token configurado: {initialHasToken ? "sí" : "no"}
        </p>
        <p data-testid="pms-last-synced-status">
          Última sincronización:{" "}
          {initialLastSyncedAt ? formatDateTimeInBogota(initialLastSyncedAt, "es-CO") : "nunca"}
        </p>
      </div>

      {showConfirmation ? (
        <ActionConfirmation
          contained
          status="success"
          title="Cambios guardados"
          body="Los cambios ya están visibles públicamente — no necesitan revisión adicional."
          actionLabel="Editar de nuevo"
          onAction={() => setShowConfirmation(false)}
          testId="establishment-pms-confirmation"
        />
      ) : (
      <form onSubmit={handleSubmit} noValidate className="flex max-w-2xl flex-col gap-4">
        <Checkbox
          data-testid="pms-connector-active-checkbox"
          isSelected={connectorActive}
          onChange={setConnectorActive}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            Conector activo
          </Checkbox.Content>
        </Checkbox>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pms-token">Token LobbyPMS (dejar vacío para no cambiarlo)</Label>
          <Input
            id="pms-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => {
              setToken(event.target.value);
              // Champ vidé : plus un remplacement — la déclaration « même compte » est à refaire.
              if (event.target.value.trim() === "") setSameLobbyAccount(false);
            }}
            data-testid="pms-token-input"
          />
        </div>

        {replacingToken ? (
          <div className="flex flex-col gap-1.5">
            <Checkbox
              data-testid="pms-same-lobby-account-checkbox"
              isSelected={sameLobbyAccount}
              onChange={setSameLobbyAccount}
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                Misma cuenta de LobbyPMS (solo se renueva el token)
              </Checkbox.Content>
            </Checkbox>
            <p className="text-sm text-muted" data-testid="pms-same-lobby-account-help">
              {sameLobbyAccount
                ? "Las reservas hechas con el token anterior se siguen consultando y cancelando con el nuevo. Márcalo solo si es la misma cuenta: si es otra, esas reservas no se encontrarían y se anularían en Hifago."
                : "Si es otra cuenta, las reservas hechas con el token anterior dejan de consultarse y cancelarse automáticamente: pasan a verificación manual en la conciliación."}
            </p>
          </div>
        ) : null}

        <Button
          type="button"
          variant="outline"
          onPress={handleTestConnection}
          isDisabled={isTesting || !token.trim()}
          data-testid="pms-test-connection-button"
          className="w-fit"
        >
          {isTesting ? "Probando…" : "Probar conexión"}
        </Button>

        <TextField fullWidth isRequired value={reason} onChange={setReason}>
          <Label>Motivo</Label>
          <TextArea name="pms-reason" data-testid="pms-reason-input" />
        </TextField>

        <Button type="submit" isDisabled={isSubmitting} data-testid="save-pms-connector-button" className="w-fit">
          {isSubmitting ? "Guardando…" : "Guardar"}
        </Button>
      </form>
      )}
    </div>
  );
}
