"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { asLocalizedField } from "@hifago/domain";
import { Button, Checkbox, Input, Label, TextArea, TextField, toast } from "@hifago/ui";
import { LocalizedTextField, buildLocalizedPayload, type LocalizedValue } from "@/components/localized-text-field";

// storage_path résolu en URL publique côté client (bucket "catalog-media" public en lecture,
// aucun aller-retour réseau) — même idiome que ModerateProductCreationProposalForm.tsx.
function resolvePhotoUrl(storagePath: string): string {
  return createClient().storage.from("catalog-media").getPublicUrl(storagePath).data.publicUrl;
}

const MODERATE_ERRORS: Record<string, string> = {
  proposal_not_found: "No se encontró la propuesta.",
  version_conflict: "Esta propuesta fue modificada por otra persona. Recarga la página.",
};

type ModerateResult = { ok: boolean; reason?: string; status?: string; reviewed_by_email?: string };

type EstablishmentFieldsPayload = {
  name?: unknown;
  description?: unknown;
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
  photos?: { storage_path: string }[];
  // Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — lobby_api_token n'est présent QUE tant
  // que la proposition est "pending" (rédigé dès qu'elle est tranchée, cf.
  // moderate_establishment_proposal) ; lobby_api_token_provided reste comme trace après coup.
  lobby_api_token?: string;
  lobby_api_token_provided?: boolean;
};

// Aperçu "valeur actuelle" vide pour kind='create' (l'établissement n'existe pas encore, donc
// currentPayload est null) — espace réservé explicite plutôt qu'un tableau vide silencieux
// (docs/specs/06-gestion-etablissement.md §9). Formulaire de correction pré-rempli avec les
// valeurs PROPOSÉES, même patron que ModerateProposalForm.tsx (produits) — currentPayload/
// proposedPayload passés tels quels depuis la ligne de requête de la page, plus de 16 props
// scalaires dépliées à la main côté appelant.
export function ModerateEstablishmentProposalForm({
  proposalId,
  expectedVersion,
  kind,
  currentPayload,
  proposedPayload,
}: {
  proposalId: string;
  expectedVersion: number;
  kind: "create" | "edit";
  currentPayload: EstablishmentFieldsPayload | null;
  proposedPayload: EstablishmentFieldsPayload;
}) {
  const router = useRouter();
  const [name, setName] = useState<LocalizedValue>(() => ({ ...(asLocalizedField(proposedPayload.name) ?? {}) }));
  const [description, setDescription] = useState<LocalizedValue>(() => ({
    ...(asLocalizedField(proposedPayload.description) ?? {}),
  }));
  const [address, setAddress] = useState(proposedPayload.address ?? "");
  const [lat, setLat] = useState(proposedPayload.lat != null ? String(proposedPayload.lat) : "");
  const [lon, setLon] = useState(proposedPayload.lon != null ? String(proposedPayload.lon) : "");
  const [rejectionReason, setRejectionReason] = useState("");
  const [lobbyApiToken, setLobbyApiToken] = useState(proposedPayload.lobby_api_token ?? "");
  const [activatePmsConnector, setActivatePmsConnector] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);

  function buildCorrectedPayload() {
    const nameEsValue = name.es?.trim() ?? "";
    return {
      name: buildLocalizedPayload(name) ?? { es: nameEsValue },
      description: buildLocalizedPayload(description) ?? null,
      address: address.trim() || null,
      lat: lat.trim() ? Number(lat) : null,
      lon: lon.trim() ? Number(lon) : null,
      // Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — vide = l'admin a effacé le champ,
      // moderate_establishment_proposal traite "" comme "aucun token" (nullif(btrim(...), '')).
      lobby_api_token: lobbyApiToken.trim(),
    };
  }

  async function handleTestConnection() {
    if (!lobbyApiToken.trim()) return;
    setIsTestingConnection(true);
    setConnectionTestResult(null);
    try {
      const response = await fetch("/api/pms/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiToken: lobbyApiToken.trim() }),
      });
      const result = (await response.json()) as { ok: boolean; roomsCount?: number };
      setConnectionTestResult(
        result.ok
          ? `Conexión exitosa (${result.roomsCount ?? 0} categorías encontradas).`
          : "No se pudo conectar con LobbyPMS. Verifica el token con el partner."
      );
    } catch {
      setConnectionTestResult("No se pudo conectar con LobbyPMS. Verifica el token con el partner.");
    } finally {
      setIsTestingConnection(false);
    }
  }

  async function handleDecision(decision: "approve" | "reject") {
    if (decision === "approve" && !(name.es ?? "").trim()) {
      toast.danger("El nombre (es) es obligatorio.");
      return;
    }
    if (decision === "reject" && !rejectionReason.trim()) {
      toast.danger("El motivo es obligatorio para rechazar.");
      return;
    }

    setIsSubmitting(true);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("moderate_establishment_proposal", {
      p_proposal_id: proposalId,
      p_decision: decision,
      p_expected_version: expectedVersion,
      p_corrected_payload: decision === "approve" ? buildCorrectedPayload() : null,
      p_rejection_reason: decision === "reject" ? rejectionReason.trim() : undefined,
      p_activate_pms_connector: decision === "approve" ? activatePmsConnector : undefined,
    });

    const result = data as ModerateResult | null;
    if (rpcError || !result?.ok) {
      // Échec seulement : sur un succès, le bouton reste inactif jusqu'à la navigation, qui
      // démonte ce formulaire — le réactiver avant permettait un second envoi pendant le
      // rechargement (2026-10-01).
      setIsSubmitting(false);
      if (result?.reason === "already_handled") {
        toast.danger(
          `Esta propuesta ya fue procesada${result.reviewed_by_email ? ` por ${result.reviewed_by_email}` : ""} (estado: ${result.status}).`,
        );
        return;
      }
      toast.danger(
        MODERATE_ERRORS[result?.reason ?? ""] ?? "No se pudo procesar la propuesta. Inténtalo de nuevo.",
      );
      return;
    }

    toast.success(
      decision === "approve"
        ? kind === "create"
          ? "Propuesta aprobada — establecimiento creado."
          : "Propuesta aprobada."
        : "Propuesta rechazada.",
    );
    router.push("/admin/proposals");
    router.refresh();
  }

  const currentNameField = asLocalizedField(currentPayload?.name);
  const currentDescriptionField = asLocalizedField(currentPayload?.description);
  const proposedNameField = asLocalizedField(proposedPayload.name);
  const proposedDescriptionField = asLocalizedField(proposedPayload.description);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
        <div data-testid="current-values">
          <p className="text-sm font-medium">Valor actual</p>
          {kind === "create" ? (
            <p className="mt-2 text-sm text-muted" data-testid="no-current-establishment">
              — nuevo establecimiento —
            </p>
          ) : (
            <dl className="mt-2 flex flex-col gap-1 text-sm text-muted">
              <div>
                <dt className="inline font-medium text-foreground">Nombre (es): </dt>
                <dd className="inline">{currentNameField?.es || "—"}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Nombre (en): </dt>
                <dd className="inline">{currentNameField?.en || "—"}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Descripción (es): </dt>
                <dd className="inline">{currentDescriptionField?.es || "—"}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Descripción (en): </dt>
                <dd className="inline">{currentDescriptionField?.en || "—"}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Dirección: </dt>
                <dd className="inline">{currentPayload?.address || "—"}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Lat/Lon: </dt>
                <dd className="inline">
                  {currentPayload?.lat != null ? String(currentPayload.lat) : "—"} /{" "}
                  {currentPayload?.lon != null ? String(currentPayload.lon) : "—"}
                </dd>
              </div>
            </dl>
          )}
        </div>
        <div data-testid="proposed-values">
          <p className="text-sm font-medium">Valor propuesto</p>
          <dl className="mt-2 flex flex-col gap-1 text-sm text-muted">
            <div>
              <dt className="inline font-medium text-foreground">Nombre (es): </dt>
              <dd className="inline">{proposedNameField?.es || "—"}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">Nombre (en): </dt>
              <dd className="inline">{proposedNameField?.en || "—"}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">Descripción (es): </dt>
              <dd className="inline">{proposedDescriptionField?.es || "—"}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">Descripción (en): </dt>
              <dd className="inline">{proposedDescriptionField?.en || "—"}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">Dirección: </dt>
              <dd className="inline">{proposedPayload.address || "—"}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">Lat/Lon: </dt>
              <dd className="inline">
                {proposedPayload.lat != null ? String(proposedPayload.lat) : "—"} /{" "}
                {proposedPayload.lon != null ? String(proposedPayload.lon) : "—"}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="flex max-w-md flex-col gap-4">
        <LocalizedTextField
          label="Nombre"
          value={name}
          onChange={setName}
          isRequired
          inputName="nombre"
          testIdPrefix="name"
        />

        <LocalizedTextField
          label="Descripción — opcional"
          value={description}
          onChange={setDescription}
          multiline
          testIdPrefix="description"
          fieldTestId="description-textarea"
        />

        {/* Lecture seule : ce formulaire n'édite jamais les photos (même invariant que
            ModerateProductCreationProposalForm.tsx) — toujours rattachées telles que proposées par
            le socio, jamais via p_corrected_payload. Uniquement pour kind='create' (une proposition
            d'édition n'en porte jamais, cf. submit_establishment_edit_proposal). */}
        {kind === "create" && proposedPayload.photos && proposedPayload.photos.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label>Fotos propuestas</Label>
            <div className="flex flex-wrap gap-2" data-testid="proposed-photos">
              {proposedPayload.photos.map((photo, index) => (
                // eslint-disable-next-line @next/next/no-img-element -- aperçu de modération, pas une image de contenu (next/image inutile ici)
                <img
                  key={photo.storage_path}
                  src={resolvePhotoUrl(photo.storage_path)}
                  alt=""
                  data-testid={`proposed-photo-${index}`}
                  className="h-20 w-20 rounded object-cover"
                />
              ))}
            </div>
          </div>
        ) : null}

        <TextField value={address} onChange={setAddress}>
          <Label>Dirección — opcional</Label>
          <Input id="address" name="address" />
        </TextField>

        <div className="grid grid-cols-2 gap-4">
          <TextField value={lat} onChange={setLat}>
            <Label>Latitud</Label>
            <Input id="lat" name="lat" />
          </TextField>
          <TextField value={lon} onChange={setLon}>
            <Label>Longitud</Label>
            <Input id="lon" name="lon" />
          </TextField>
        </div>

        {/* Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — le token proposé n'est visible ici
            que tant que la proposition est "pending" (rédigé après décision, cf.
            moderate_establishment_proposal). "Probar conexión" réutilise la même route que
            EstablishmentPmsBlock.tsx (admin-direct), sans rien persister. */}
        <TextField fullWidth value={lobbyApiToken} onChange={setLobbyApiToken}>
          <Label>Token LobbyPMS {proposedPayload.lobby_api_token ? "(propuesto por el partner)" : "— opcional"}</Label>
          <Input type="password" autoComplete="off" data-testid="moderate-lobby-token-input" />
        </TextField>
        {lobbyApiToken.trim() ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              isDisabled={isTestingConnection}
              onPress={handleTestConnection}
              data-testid="moderate-test-connection-button"
            >
              {isTestingConnection ? "Probando…" : "Probar conexión"}
            </Button>
            {connectionTestResult ? (
              <p className="text-sm text-muted" data-testid="moderate-connection-test-result">
                {connectionTestResult}
              </p>
            ) : null}
            <Checkbox
              data-testid="activate-pms-connector-checkbox"
              isSelected={activatePmsConnector}
              onChange={setActivatePmsConnector}
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                Activar conector al aprobar
              </Checkbox.Content>
            </Checkbox>
          </>
        ) : null}

        <TextField value={rejectionReason} onChange={setRejectionReason}>
          <Label>Motivo de rechazo — obligatorio para rechazar</Label>
          <TextArea id="rejection-reason" name="rejection-reason" />
        </TextField>

        <div className="flex gap-2">
          <Button
            type="button"
            isDisabled={isSubmitting}
            onPress={() => handleDecision("approve")}
            data-testid="approve-button"
          >
            {isSubmitting ? "Procesando…" : "Aprobar"}
          </Button>
          <Button
            type="button"
            variant="outline"
            isDisabled={isSubmitting}
            onPress={() => handleDecision("reject")}
            data-testid="reject-button"
          >
            {isSubmitting ? "Procesando…" : "Rechazar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
