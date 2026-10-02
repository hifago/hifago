"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { nowIsoInstant } from "@hifago/domain";
import { Button, Input, Label, TextArea, TextField, cn, toast } from "@hifago/ui";
import { mountAddressAutocomplete } from "@/components/address-autocomplete";
import { ActionConfirmation } from "@/components/action-confirmation";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type DescriptionLang = "es" | "en";

const SUBMIT_ERRORS: Record<string, string> = {
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
  establishment_not_found: "No se encontró el establecimiento.",
  capability_suspended: "Tu capacidad de operador para este establecimiento no está activa.",
  name_required: "El nombre es obligatorio.",
  pending_cap_exceeded:
    "Ya tienes 10 propuestas pendientes. Espera a que se revisen antes de enviar más.",
};

const WITHDRAW_ERRORS: Record<string, string> = {
  proposal_not_found: "No se encontró la propuesta.",
  not_pending: "Esta propuesta ya fue procesada.",
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
};

type PendingProposal = { id: string; payload: unknown; created_at: string } | null;

// Pré-rempli avec la fiche COMPLÈTE actuelle, pas seulement les champs à modifier (même propriété
// de sûreté que EditProposalForm.tsx, produits) — un champ non retouché porte sa valeur actuelle
// dans le payload envoyé au serveur. operated_directly n'apparaît jamais ici : jamais proposable
// par le socio (docs/specs/06-gestion-etablissement.md §3).
export function EditEstablishmentProposalForm({
  establishmentId,
  initialNameEs,
  initialDescriptionEs,
  initialDescriptionEn,
  initialAddress,
  initialLat,
  initialLon,
  pendingProposal,
}: {
  establishmentId: string;
  initialNameEs: string;
  initialDescriptionEs: string;
  initialDescriptionEn: string;
  initialAddress: string;
  initialLat: string;
  initialLon: string;
  pendingProposal: PendingProposal;
}) {
  const [nombre, setNombre] = useState(initialNameEs);
  const [descriptionEs, setDescriptionEs] = useState(initialDescriptionEs);
  const [descriptionEn, setDescriptionEn] = useState(initialDescriptionEn);
  const [descriptionLang, setDescriptionLang] = useState<DescriptionLang>("es");
  const [address, setAddress] = useState(initialAddress);
  const [lat, setLat] = useState(initialLat);
  const [lon, setLon] = useState(initialLon);
  const [lobbyApiToken, setLobbyApiToken] = useState("");

  const [proposal, setProposal] = useState(pendingProposal);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  // docs/specs/40 §4 — remplace l'ancien patron « bannière au-dessus du formulaire toujours
  // éditable » (qui laissait créer une 2e proposition en silence) : une proposition en attente
  // masque désormais le formulaire, « Editar de nuevo » le rouvre explicitement (pré-rempli),
  // « Retirar propuesta » reste l'autre issue. Réinitialisé à `false` après un envoi réussi pour
  // que la confirmation réapparaisse.
  const [showFormAnyway, setShowFormAnyway] = useState(false);

  const addressSearchRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = addressSearchRef.current;
    if (!container) return;
    return mountAddressAutocomplete(container, (place) => {
      setAddress(place.address);
      if (place.lat !== null && place.lon !== null) {
        setLat(String(place.lat));
        setLon(String(place.lon));
      }
    });
  }, []);

  function buildDescription(): Json | null {
    const es = descriptionEs.trim();
    const en = descriptionEn.trim();
    if (!es && !en) return null;
    const value: { [key: string]: Json } = {};
    if (es) value.es = es;
    if (en) value.en = en;
    return value;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!nombre.trim()) {
      toast.danger("El nombre es obligatorio.");
      return;
    }

    setIsSubmitting(true);

    const payload = {
      name: { es: nombre.trim() } as Json,
      description: buildDescription(),
      address: address.trim() || null,
      lat: lat.trim() ? Number(lat) : null,
      lon: lon.trim() ? Number(lon) : null,
      // Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — cf. NewEstablishmentProposalForm.tsx.
      ...(lobbyApiToken.trim() ? { lobby_api_token: lobbyApiToken.trim() } : {}),
    };

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("submit_establishment_edit_proposal", {
      p_establishment_id: establishmentId,
      p_payload: payload,
    });

    setIsSubmitting(false);

    const result = data as { ok: boolean; reason?: string; proposal_id?: string } | null;
    if (rpcError || !result?.ok) {
      toast.danger(
        SUBMIT_ERRORS[result?.reason ?? ""] ?? "No se pudo enviar la propuesta. Inténtalo de nuevo.",
      );
      return;
    }

    if (result.proposal_id) {
      setProposal({ id: result.proposal_id, payload, created_at: nowIsoInstant() });
    }
    setLobbyApiToken("");
    setShowFormAnyway(false);
  }

  async function handleWithdraw() {
    if (!proposal) return;
    setIsWithdrawing(true);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("withdraw_establishment_proposal", {
      p_proposal_id: proposal.id,
    });

    setIsWithdrawing(false);

    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      toast.danger(
        WITHDRAW_ERRORS[result?.reason ?? ""] ?? "No se pudo retirar la propuesta. Inténtalo de nuevo.",
      );
      return;
    }

    setProposal(null);
    toast.success("Propuesta retirada.");
  }

  if (proposal && !showFormAnyway) {
    return (
      <div className="w-full max-w-3xl self-center">
        <ActionConfirmation
          contained
          status="pending"
          title="Cambios enviados para revisión"
          body="Un administrador de Hifago revisará estos cambios antes de aplicarlos en la ficha pública."
          actionLabel="Editar de nuevo"
          onAction={() => setShowFormAnyway(true)}
          secondaryActionLabel={isWithdrawing ? "Retirando…" : "Retirar propuesta"}
          onSecondaryAction={handleWithdraw}
          testId="pending-edit-proposal"
        />
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6 self-center">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-proposal-nombre">Nombre</Label>
          <Input
            id="edit-proposal-nombre"
            name="edit-proposal-nombre"
            required
            value={nombre}
            onChange={(event) => setNombre(event.target.value)}
          />
        </div>

        <TextField
          fullWidth
          value={descriptionLang === "es" ? descriptionEs : descriptionEn}
          onChange={(value) =>
            descriptionLang === "es" ? setDescriptionEs(value) : setDescriptionEn(value)
          }
        >
          <div className="flex items-center justify-between">
            <Label>Descripción — opcional</Label>
            <div className="flex gap-1" role="group" aria-label="Idioma de la descripción">
              {(["es", "en"] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  data-testid={`edit-proposal-description-lang-${lang}`}
                  onClick={() => setDescriptionLang(lang)}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs font-medium uppercase",
                    descriptionLang === lang
                      ? "bg-accent text-accent-foreground"
                      : "text-muted hover:bg-muted/50",
                  )}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>
          <TextArea data-testid="edit-proposal-description-textarea" />
        </TextField>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-proposal-address-search">Buscar dirección (Google)</Label>
          <div
            id="edit-proposal-address-search"
            ref={addressSearchRef}
            data-testid="edit-proposal-address-search"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-proposal-address">Dirección</Label>
          <Input
            id="edit-proposal-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            data-testid="edit-proposal-address-input"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-proposal-lat">Latitud</Label>
            <Input
              id="edit-proposal-lat"
              value={lat}
              onChange={(event) => setLat(event.target.value)}
              data-testid="edit-proposal-lat-input"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-proposal-lon">Longitud</Label>
            <Input
              id="edit-proposal-lon"
              value={lon}
              onChange={(event) => setLon(event.target.value)}
              data-testid="edit-proposal-lon-input"
            />
          </div>
        </div>

        <TextField fullWidth value={lobbyApiToken} onChange={setLobbyApiToken}>
          <Label>Token LobbyPMS — opcional</Label>
          <Input type="password" autoComplete="off" data-testid="edit-proposal-lobby-token-input" />
        </TextField>
        <p className="text-xs text-muted">
          Déjalo en blanco si no quieres cambiar la conexión con LobbyPMS. Si pegas un token aquí,
          el equipo lo verificará antes de aprobar esta edición.
        </p>

        <Button type="submit" isDisabled={isSubmitting} data-testid="submit-edit-proposal-button">
          {isSubmitting ? "Enviando…" : "Enviar propuesta"}
        </Button>
      </form>
    </div>
  );
}
