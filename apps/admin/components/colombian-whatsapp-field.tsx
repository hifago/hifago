"use client";

import { Description, InputGroup, Label, TextField } from "@hifago/ui";
import { COLOMBIA_PREFIX, colombianWhatsAppError } from "@/lib/establishments/colombianWhatsApp";

// Le WhatsApp du prestataire — un seul champ pour les trois écrans qui le saisissent (création
// admin, proposition du socio, validation d'une proposition, plus la fiche admin). Décision Jérôme
// du 2026-10-19 : obligatoire, colombien, et jamais montré au client avant qu'il ait finalisé sa
// réservation. Le préfixe +57 est FIXE : la saisie ne porte que les 10 chiffres, ce qui retire la
// première cause de numéro invalide (l'indicatif oublié ou doublé).
//
// `value` est la saisie brute ; l'appelant envoie `toColombianWhatsApp(value)`.

export const WHATSAPP_PRESTADOR_DESCRIPTION =
  "Número de contacto del prestador para todos los servicios que el cliente reserve. Solo se le " +
  "envía al cliente una vez finalizada su reserva — nunca aparece antes en la página pública.";

// Le même texte, adressé au socio qui saisit SON numéro.
export const WHATSAPP_SOCIO_DESCRIPTION =
  "Tu número de contacto para todos los servicios que un cliente te reserve. Se lo enviamos solo " +
  "cuando finaliza su reserva — nunca aparece antes en la página pública.";

export function ColombianWhatsAppField({
  value,
  onChange,
  showError,
  label = "WhatsApp del prestador",
  description = WHATSAPP_PRESTADOR_DESCRIPTION,
  testId = "establishment-whatsapp-input",
}: {
  value: string;
  onChange: (value: string) => void;
  /** Vrai après une tentative d'envoi — jamais pendant la frappe ni sur un champ vierge. */
  showError: boolean;
  label?: string;
  description?: string;
  testId?: string;
}) {
  const error = showError ? colombianWhatsAppError(value) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <TextField
        fullWidth
        isRequired
        isInvalid={error !== null}
        name="establishment-whatsapp"
        value={value}
        onChange={onChange}
      >
        <Label>{label}</Label>
        <InputGroup fullWidth>
          <InputGroup.Prefix>{COLOMBIA_PREFIX}</InputGroup.Prefix>
          <InputGroup.Input
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="300 123 4567"
            data-testid={testId}
          />
        </InputGroup>
        <Description>{description}</Description>
      </TextField>
      {/* Message porté à côté du champ plutôt que par `FieldError` : même forme que
          EstablishmentContactBlock et lobby-option-picker, la convention locale. */}
      {error ? (
        <p className="text-sm text-danger" data-testid={`${testId}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
