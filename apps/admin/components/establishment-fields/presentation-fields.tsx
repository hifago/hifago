"use client";

import { Input, Label, TextArea, TextField, cn } from "@hifago/ui";
import { useAddressAutocomplete } from "@/components/use-address-autocomplete";
import type { EstablishmentFieldsState } from "@/lib/establishments/useEstablishmentFieldsState";

// Nom, description ES/EN, adresse (recherche Google + saisie) et coordonnées d'un établissement —
// les champs que les deux formulaires de proposition du partenaire (création, édition) recopiaient
// chacun à la main. `idPrefix` conserve les identifiants et `data-testid` historiques de chaque
// écran (`proposal-…`, `edit-proposal-…`), sur lesquels reposent les tests e2e.
//
// `nombre` reste hors du hook d'état partagé (même patron que NewEstablishmentForm.tsx) : un nom
// d'établissement est un nom propre, jamais localisé (spec 03 §3).
export function PresentationFields({
  idPrefix,
  nombre,
  onNombreChange,
  fields,
}: {
  idPrefix: string;
  nombre: string;
  onNombreChange: (next: string) => void;
  fields: EstablishmentFieldsState;
}) {
  const addressSearchRef = useAddressAutocomplete((place) => {
    fields.setAddress(place.address);
    if (place.lat !== null && place.lon !== null) {
      fields.setLat(String(place.lat));
      fields.setLon(String(place.lon));
    }
  });

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}nombre`}>Nombre</Label>
        <Input
          id={`${idPrefix}nombre`}
          name={`${idPrefix}nombre`}
          required
          value={nombre}
          onChange={(event) => onNombreChange(event.target.value)}
        />
      </div>

      <TextField
        fullWidth
        value={fields.descriptionLang === "es" ? fields.descriptionEs : fields.descriptionEn}
        onChange={(value) =>
          fields.descriptionLang === "es" ? fields.setDescriptionEs(value) : fields.setDescriptionEn(value)
        }
      >
        <div className="flex items-center justify-between">
          <Label>Descripción — opcional</Label>
          <div className="flex gap-1" role="group" aria-label="Idioma de la descripción">
            {(["es", "en"] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                data-testid={`${idPrefix}description-lang-${lang}`}
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
        <TextArea data-testid={`${idPrefix}description-textarea`} />
      </TextField>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}address-search`}>Buscar dirección (Google)</Label>
        <div id={`${idPrefix}address-search`} ref={addressSearchRef} data-testid={`${idPrefix}address-search`} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}address`}>Dirección</Label>
        <Input
          id={`${idPrefix}address`}
          value={fields.address}
          onChange={(event) => fields.setAddress(event.target.value)}
          data-testid={`${idPrefix}address-input`}
        />
      </div>

      {/* Empilés sous md (.claude/rules/ui.md, responsive). */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}lat`}>Latitud</Label>
          <Input
            id={`${idPrefix}lat`}
            value={fields.lat}
            onChange={(event) => fields.setLat(event.target.value)}
            data-testid={`${idPrefix}lat-input`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}lon`}>Longitud</Label>
          <Input
            id={`${idPrefix}lon`}
            value={fields.lon}
            onChange={(event) => fields.setLon(event.target.value)}
            data-testid={`${idPrefix}lon-input`}
          />
        </div>
      </div>
    </>
  );
}
