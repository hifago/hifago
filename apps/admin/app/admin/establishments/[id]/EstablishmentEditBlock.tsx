"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@hifago/supabase/client";
import { Button, Checkbox, Input, Label, TextArea, TextField, cn, toast } from "@hifago/ui";
import { useAddressAutocomplete } from "@/components/use-address-autocomplete";
import { useEstablishmentFieldsState } from "@/lib/establishments/useEstablishmentFieldsState";
import { buildEstablishmentRpcParams } from "@/lib/establishments/establishmentPayload";
import { ActionConfirmation } from "@/components/action-confirmation";

// docs/specs/06-gestion-etablissement.md §5.1 — comble le gap cahier admin §3c ("toute la
// présentation d'un établissement s'édite depuis l'admin") : jusqu'ici seules les photos étaient
// éditables après création (EstablishmentPhotosBlock, spec 04). update_establishment remplace tous
// les champs de présentation en un seul appel (pas un patch partiel).
export function EstablishmentEditBlock({
  establishmentId,
  initialNameEs,
  initialDescriptionEs,
  initialDescriptionEn,
  initialAddress,
  initialLat,
  initialLon,
  initialOperatedDirectly,
  pendingEditProposalId,
}: {
  establishmentId: string;
  initialNameEs: string;
  initialDescriptionEs: string;
  initialDescriptionEn: string;
  initialAddress: string;
  initialLat: string;
  initialLon: string;
  initialOperatedDirectly: boolean;
  pendingEditProposalId: string | null;
}) {
  const router = useRouter();

  // `nombre` reste hors du hook d'état partagé — même patron que NewEstablishmentForm.tsx.
  const [nombre, setNombre] = useState(initialNameEs);
  // State partagé avec NewEstablishmentForm.tsx (revue de packaging admin, 2026-09-17) — `initialLat`/
  // `initialLon` passent tels quels (déjà des chaînes sérialisées par page.tsx) : le hook accepte
  // `string | number | null` pour lat/lon précisément pour ça (cf. son commentaire).
  const fields = useEstablishmentFieldsState({
    descriptionEs: initialDescriptionEs,
    descriptionEn: initialDescriptionEn,
    address: initialAddress,
    lat: initialLat || null,
    lon: initialLon || null,
    operatedDirectly: initialOperatedDirectly,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Confirmation contenue dans cette carte (docs/specs/40 §4) — jamais plein écran : les 8 autres
  // blocs de cet écran restent visibles. Toujours « admin/succès » ici (ce bloc n'est jamais
  // atteint par un partenaire), donc pas besoin d'un statut variable comme côté produit.
  const [showConfirmation, setShowConfirmation] = useState(false);

  const addressSearchRef = useAddressAutocomplete((place) => {
    fields.setAddress(place.address);
    if (place.lat !== null && place.lon !== null) {
      fields.setLat(String(place.lat));
      fields.setLon(String(place.lon));
    }
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!nombre.trim()) {
      toast.danger("El nombre es obligatorio.");
      return;
    }

    setIsSubmitting(true);

    const supabase = createClient();
    // Dédoublonnage payload établissement (chantier 2026-09-17) — même builder que
    // NewEstablishmentForm.tsx.
    const { data, error: rpcError } = await supabase.rpc("update_establishment", {
      p_establishment_id: establishmentId,
      ...buildEstablishmentRpcParams(nombre, fields),
    });

    setIsSubmitting(false);

    const result = data as { ok: boolean } | null;
    if (rpcError || !result?.ok) {
      toast.danger("No se pudo actualizar el establecimiento.");
      return;
    }

    router.refresh();
    setShowConfirmation(true);
  }

  return (
    <div className="rounded-lg border bg-surface p-4" data-testid="establishment-edit-block">
      <h2 className="mb-4 text-sm font-medium">Editar establecimiento</h2>

      {pendingEditProposalId ? (
        <p
          role="status"
          data-testid="pending-edit-proposal-banner"
          className="mb-4 rounded-md border border-warning bg-warning/10 p-3 text-sm"
        >
          Hay una propuesta de edición pendiente del partner.{" "}
          <Link
            href={`/admin/proposals/${pendingEditProposalId}?entity=establishment`}
            className="underline"
          >
            Revisar propuesta
          </Link>
        </p>
      ) : null}

      {showConfirmation ? (
        <ActionConfirmation
          contained
          status="success"
          title="Cambios guardados"
          body="Los cambios ya están visibles públicamente — no necesitan revisión adicional."
          actionLabel="Editar de nuevo"
          onAction={() => setShowConfirmation(false)}
          testId="establishment-edit-confirmation"
        />
      ) : (
      <form onSubmit={handleSubmit} noValidate className="flex max-w-2xl flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-nombre">Nombre</Label>
          <Input
            id="edit-nombre"
            name="edit-nombre"
            required
            value={nombre}
            onChange={(event) => setNombre(event.target.value)}
          />
        </div>

        <Checkbox
          data-testid="edit-operated-directly-checkbox"
          isSelected={fields.operatedDirectly}
          onChange={fields.setOperatedDirectly}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            Operado directamente por la plataforma
          </Checkbox.Content>
        </Checkbox>

        <TextField
          fullWidth
          value={fields.descriptionLang === "es" ? fields.descriptionEs : fields.descriptionEn}
          onChange={(value) =>
            fields.descriptionLang === "es" ? fields.setDescriptionEs(value) : fields.setDescriptionEn(value)
          }
        >
          <div className="flex items-center justify-between">
            <Label>Descripción</Label>
            <div className="flex gap-1" role="group" aria-label="Idioma de la descripción">
              {(["es", "en"] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  data-testid={`edit-description-lang-${lang}`}
                  onClick={() => fields.setDescriptionLang(lang)}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs font-medium uppercase",
                    fields.descriptionLang === lang
                      ? "bg-accent text-accent-foreground"
                      : "text-muted hover:bg-muted/50",
                  )}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>
          <TextArea data-testid="edit-description-textarea" />
        </TextField>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-address-search">Buscar dirección (Google)</Label>
          <div id="edit-address-search" ref={addressSearchRef} data-testid="edit-address-search" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-address">Dirección</Label>
          <Input
            id="edit-address"
            value={fields.address}
            onChange={(event) => fields.setAddress(event.target.value)}
            data-testid="edit-address-input"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-lat">Latitud</Label>
            <Input
              id="edit-lat"
              value={fields.lat}
              onChange={(event) => fields.setLat(event.target.value)}
              data-testid="edit-lat-input"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-lon">Longitud</Label>
            <Input
              id="edit-lon"
              value={fields.lon}
              onChange={(event) => fields.setLon(event.target.value)}
              data-testid="edit-lon-input"
            />
          </div>
        </div>

        <Button type="submit" isDisabled={isSubmitting} data-testid="save-establishment-button">
          {isSubmitting ? "Guardando…" : "Guardar cambios"}
        </Button>
      </form>
      )}
    </div>
  );
}
