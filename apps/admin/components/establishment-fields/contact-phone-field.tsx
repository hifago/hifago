"use client";

import { Input, Label, TextField } from "@hifago/ui";
import { isContactPhoneInvalid } from "@/lib/establishments/contactPhone";

// Le contact WhatsApp PUBLIC d'un établissement — le champ du bloc admin EstablishmentContactBlock,
// partagé avec les formulaires de proposition du partenaire.
//
// ⚠️ Ce numéro est PUBLIC, contrairement à `partners.phone` et `partner_accounts.phone` : il décrit
// un LIEU, pas une personne ni une organisation.
export function ContactPhoneField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <>
      <p className="text-sm text-muted">
        Se muestra en la ficha pública del establecimiento como botón de WhatsApp. Déjalo vacío para
        no mostrar ningún contacto.
      </p>

      <TextField fullWidth name="establishment-contact-phone" value={value} onChange={onChange}>
        <Label>WhatsApp — opcional</Label>
        <Input type="tel" placeholder="+573001234567" data-testid="establishment-contact-phone-input" />
      </TextField>

      {/* Message porté à côté du champ plutôt que par une prop `error` : le `TextField` de
          `@hifago/ui` n'en a pas. Même forme que `lobby-option-picker.tsx`, la convention locale. */}
      {isContactPhoneInvalid(value) ? (
        <p className="text-sm text-danger" data-testid="establishment-contact-phone-error">
          Formato internacional obligatorio, por ejemplo +573001234567.
        </p>
      ) : null}
    </>
  );
}
