"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextArea, TextField, cn, toast } from "@hifago/ui";
import { mountAddressAutocomplete } from "@/components/address-autocomplete";
import { StagedEstablishmentPhotos, type StagedPhoto } from "@/components/establishment-photos-staged";
import { ActionConfirmation } from "@/components/action-confirmation";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type DescriptionLang = "es" | "en";

// pending_creation_exists retiré (2026-08-19, migration
// 20260819220000_establishment_creation_no_pending_cap.sql) : la RPC ne renvoie plus jamais cette
// raison, plusieurs propositions de création peuvent désormais coexister en attente.
const SUBMIT_ERRORS: Record<string, string> = {
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
  not_a_partner: "Tu cuenta no está asociada a ningún partner.",
  name_required: "El nombre es obligatorio.",
};

// docs/specs/06-gestion-etablissement.md §5.2 — jamais operated_directly (classification métier/
// plateforme, filtrée aussi côté RPC) : ce formulaire n'expose que les champs de présentation, même
// sous-ensemble que NewEstablishmentForm.tsx (admin) moins ce seul champ.
export function NewEstablishmentProposalForm() {
  const router = useRouter();

  const [nombre, setNombre] = useState("");
  const [descriptionEs, setDescriptionEs] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [descriptionLang, setDescriptionLang] = useState<DescriptionLang>("es");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [lobbyApiToken, setLobbyApiToken] = useState("");
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  // Écran de confirmation plein écran (docs/specs/40 §4) — toujours « partenaire/en attente », ce
  // formulaire n'est jamais atteint par un admin.
  const [showConfirmation, setShowConfirmation] = useState(false);

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

  function buildDescription(): Json | undefined {
    const es = descriptionEs.trim();
    const en = descriptionEn.trim();
    if (!es && !en) return undefined;
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
      description: buildDescription() ?? null,
      address: address.trim() || null,
      lat: lat.trim() ? Number(lat) : null,
      lon: lon.trim() ? Number(lon) : null,
      photos: stagedPhotos.map((photo) => ({ storage_path: photo.path })) as Json,
      // Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — optionnel, filtré côté RPC si vide ;
      // reste en clair uniquement tant que la proposition est "pending" (l'admin doit le lire pour
      // le tester), rédigé dès qu'elle est tranchée (cf. moderate_establishment_proposal).
      ...(lobbyApiToken.trim() ? { lobby_api_token: lobbyApiToken.trim() } : {}),
    };

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("submit_establishment_creation_proposal", {
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

    setShowConfirmation(true);
  }

  if (showConfirmation) {
    return (
      <ActionConfirmation
        status="pending"
        title="Propuesta enviada"
        body="Un administrador de Hifago revisará tu propuesta antes de publicar el establecimiento. Te avisaremos cuando esté disponible."
        actionLabel="Ir a mis establecimientos"
        onAction={() => {
          router.push("/partner/establishment");
          router.refresh();
        }}
        testId="establishment-proposal-confirmation"
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full max-w-3xl flex-col gap-4 self-center">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="proposal-nombre">Nombre</Label>
        <Input
          id="proposal-nombre"
          name="proposal-nombre"
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
                data-testid={`proposal-description-lang-${lang}`}
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
        <TextArea data-testid="proposal-description-textarea" />
      </TextField>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="proposal-address-search">Buscar dirección (Google)</Label>
        <div id="proposal-address-search" ref={addressSearchRef} data-testid="proposal-address-search" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="proposal-address">Dirección</Label>
        <Input
          id="proposal-address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          data-testid="proposal-address-input"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="proposal-lat">Latitud</Label>
          <Input
            id="proposal-lat"
            value={lat}
            onChange={(event) => setLat(event.target.value)}
            data-testid="proposal-lat-input"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="proposal-lon">Longitud</Label>
          <Input
            id="proposal-lon"
            value={lon}
            onChange={(event) => setLon(event.target.value)}
            data-testid="proposal-lon-input"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Fotos — opcional</Label>
        <StagedEstablishmentPhotos photos={stagedPhotos} onChange={setStagedPhotos} />
      </div>

      <TextField fullWidth value={lobbyApiToken} onChange={setLobbyApiToken}>
        <Label>Token LobbyPMS — opcional</Label>
        <Input type="password" autoComplete="off" data-testid="proposal-lobby-token-input" />
      </TextField>
      <p className="text-xs text-muted">
        Si ya usas LobbyPMS, pega aquí tu token de acceso — el equipo lo verificará antes de
        aprobar tu establecimiento. Puedes dejarlo en blanco y añadirlo más adelante.
      </p>

      <Button type="submit" isDisabled={isSubmitting} data-testid="submit-establishment-proposal-button">
        {isSubmitting ? "Enviando…" : "Enviar propuesta"}
      </Button>
    </form>
  );
}
