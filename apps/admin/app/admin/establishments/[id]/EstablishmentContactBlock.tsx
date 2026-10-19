"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, toast } from "@hifago/ui";
import { ActionConfirmation } from "@/components/action-confirmation";
import { ColombianWhatsAppField } from "@/components/colombian-whatsapp-field";
import {
  colombianWhatsAppError,
  colombianWhatsAppReasonMessage,
  localPartOfColombianWhatsApp,
  toColombianWhatsApp,
} from "@/lib/establishments/colombianWhatsApp";

// Le WhatsApp du prestataire — PRIVÉ depuis le 2026-10-19 (décision Jérôme : jamais montré au client
// avant qu'il ait finalisé sa réservation ; migration 20261019170000). Il était public depuis la
// spec 30 (2026-09-08) et affiché sur la fiche établissement : ce n'est plus le cas.
//
// Bloc séparé à sauvegarde immédiate, exactement comme EstablishmentStayBlock : il appelle
// `update_establishment_contact` et JAMAIS `update_establishment`, qui remplace tous ses champs et
// est appelée par trois chemins de modération de propositions — l'étendre aurait fait écraser ce
// contact à chaque approbation, sans erreur et sans trace.
//
// ⚠️ Le numéro est obligatoire : ce bloc le REMPLACE, il ne l'efface jamais (la RPC refuse
// `phone_required`). Un établissement créé avant le 2026-10-19 peut encore ne pas en avoir — c'est
// ici qu'on le renseigne.
//
// ⚠️ Ne jamais « simplifier » en lisant `partners.phone` ou `partner_accounts.phone` : ils décrivent
// une PERSONNE ou une ORGANISATION, celui-ci le contact du prestataire pour ce lieu.

export function EstablishmentContactBlock({
  establishmentId,
  initialContactPhone,
}: {
  establishmentId: string;
  initialContactPhone: string | null;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState(() => localPartOfColombianWhatsApp(initialContactPhone));
  const [showError, setShowError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Confirmation contenue dans cette carte (docs/specs/40 §4) — jamais plein écran, toujours
  // « admin/succès » (bloc jamais atteint par un partenaire).
  const [showConfirmation, setShowConfirmation] = useState(false);

  async function handleSave() {
    const error = colombianWhatsAppError(phone);
    if (error) {
      setShowError(true);
      return;
    }
    setIsSubmitting(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("update_establishment_contact", {
      p_establishment_id: establishmentId,
      p_contact_phone: toColombianWhatsApp(phone) ?? undefined,
    });
    setIsSubmitting(false);

    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      toast.danger(colombianWhatsAppReasonMessage(result?.reason) ?? "No se pudo guardar el contacto.");
      return;
    }
    router.refresh();
    setShowConfirmation(true);
  }

  return (
    <section
      className="flex flex-col gap-4 rounded-lg border bg-surface p-4"
      data-testid="establishment-contact-block"
    >
      <h2 className="text-lg font-medium">Contacto del prestador</h2>

      {showConfirmation ? (
        <ActionConfirmation
          contained
          status="success"
          title="Cambios guardados"
          body="El nuevo número se enviará a los clientes en sus próximas reservas finalizadas."
          actionLabel="Editar de nuevo"
          onAction={() => setShowConfirmation(false)}
          testId="establishment-contact-confirmation"
        />
      ) : (
        <>
          {initialContactPhone ? null : (
            <p className="text-sm text-danger" data-testid="establishment-contact-missing">
              Este establecimiento todavía no tiene WhatsApp: sus clientes no reciben ningún contacto
              del prestador tras reservar.
            </p>
          )}

          <ColombianWhatsAppField
            value={phone}
            onChange={setPhone}
            showError={showError}
            testId="establishment-contact-phone-input"
          />

          <div>
            <Button
              onPress={handleSave}
              isDisabled={isSubmitting}
              data-testid="save-establishment-contact-button"
            >
              Guardar
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
