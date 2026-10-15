"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, toast } from "@hifago/ui";
import { ActionConfirmation } from "@/components/action-confirmation";
import { ContactPhoneField } from "@/components/establishment-fields/contact-phone-field";
import { FormSection } from "@/components/establishment-fields/form-section";
import { CONTACT_PHONE_FORMAT_MESSAGE, isContactPhoneInvalid } from "@/lib/establishments/contactPhone";

// Spec 30 (Tranche 2) — le contact WhatsApp PUBLIC du lieu, affiché sur la fiche établissement.
//
// Bloc séparé à sauvegarde immédiate, exactement comme EstablishmentStayBlock : il appelle
// `update_establishment_contact` et JAMAIS `update_establishment`, qui remplace tous ses champs et
// est appelée par trois chemins de modération de propositions — l'étendre aurait fait écraser ce
// contact à chaque approbation, sans erreur et sans trace.
//
// ⚠️ Sans cet écran, la colonne posée ce matin ne serait remplissable que par le seed : un
// établissement créé en préprod ou en production naîtrait sans contact et le RESTERAIT. C'est la
// leçon de la spec 29 Tranche 3 — la différence entre une fonctionnalité montrable et une
// fonctionnalité livrée.
//
// ⚠️ Ce numéro est PUBLIC, contrairement à `partners.phone` et `partner_accounts.phone`, qui
// restent protégés par l'absence de policy publique. Ne jamais « simplifier » en lisant l'un des
// deux : ils décrivent une PERSONNE ou une ORGANISATION, celui-ci décrit un LIEU.

// Le motif E.164 et le champ lui-même sont partagés avec les formulaires de proposition du
// partenaire depuis le 2026-10-14 (lib/establishments/contactPhone.ts, ContactPhoneField).

export function EstablishmentContactBlock({
  establishmentId,
  initialContactPhone,
}: {
  establishmentId: string;
  initialContactPhone: string | null;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState(initialContactPhone ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Confirmation contenue dans cette carte (docs/specs/40 §4) — jamais plein écran, toujours
  // « admin/succès » (bloc jamais atteint par un partenaire).
  const [showConfirmation, setShowConfirmation] = useState(false);

  const saisi = phone.trim();
  // Le champ VIDE est valide : c'est ainsi qu'on retire le bouton de la fiche publique.
  const formatInvalide = isContactPhoneInvalid(phone);

  async function handleSave() {
    setIsSubmitting(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("update_establishment_contact", {
      p_establishment_id: establishmentId,
      // `undefined` et non `null` : un paramètre à valeur par défaut est typé optionnel côté types
      // générés, et la RPC applique alors son défaut `null` — donc vider le champ EFFACE bien le
      // contact. Même idiome qu'EstablishmentStayBlock.
      p_contact_phone: saisi || undefined,
    });
    setIsSubmitting(false);

    const result = data as { ok: boolean; reason?: string } | null;
    if (error || !result?.ok) {
      toast.danger(
        result?.reason === "invalid_phone" ? CONTACT_PHONE_FORMAT_MESSAGE : "No se pudo guardar el contacto.",
      );
      return;
    }
    router.refresh();
    setShowConfirmation(true);
  }

  return (
    <FormSection title="Contacto público" testId="establishment-contact-block">
      {showConfirmation ? (
        <ActionConfirmation
          contained
          status="success"
          title="Cambios guardados"
          body="Los cambios ya están visibles públicamente — no necesitan revisión adicional."
          actionLabel="Editar de nuevo"
          onAction={() => setShowConfirmation(false)}
          testId="establishment-contact-confirmation"
        />
      ) : (
      <>
      <ContactPhoneField value={phone} onChange={setPhone} />

      <div>
        <Button
          onPress={handleSave}
          isDisabled={isSubmitting || formatInvalide}
          data-testid="save-establishment-contact-button"
        >
          Guardar
        </Button>
      </div>
      </>
      )}
    </FormSection>
  );
}
