"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, toast } from "@hifago/ui";
import { ActionConfirmation } from "@/components/action-confirmation";
import { FormSection } from "@/components/establishment-fields/form-section";
import { StayFields } from "@/components/establishment-fields/stay-fields";
import { stayFromColumns } from "@/lib/establishments/stayFields";

// T1 du modèle hébergement (spec 24 §4) — les champs que la page publique établissement affiche.
// Bloc séparé à sauvegarde immédiate, comme EstablishmentPhotosBlock et EstablishmentPmsBlock : il
// appelle `update_establishment_stay_details` et JAMAIS `update_establishment`, qui remplace tous
// ses champs et est appelée par trois chemins de modération de propositions — l'étendre aurait fait
// écraser ces trois valeurs à chaque approbation, sans erreur et sans trace (cf. l'en-tête de la
// migration 20260827210000).
//
// LES HORAIRES SONT UNE PROPRIÉTÉ DU LIEU, pas de chaque chambre. `products.check_in_time` existe
// encore et reste renseignable produit par produit ; cet écran est l'endroit qui a du sens, et la
// page publique lit celui de l'établissement.
//
// Les champs eux-mêmes (StayFields) sont partagés avec les formulaires de proposition du
// partenaire depuis le 2026-10-14 : il propose désormais son séjour, modéré comme le reste.

export function EstablishmentStayBlock({
  establishmentId,
  initialCheckInTime,
  initialCheckOutTime,
  initialMode,
}: {
  establishmentId: string;
  initialCheckInTime: string | null;
  initialCheckOutTime: string | null;
  initialMode: string | null;
}) {
  const router = useRouter();

  // "HH:MM:SS" en base → "HH:MM" attendu par <Input type="time"> (stayFromColumns).
  const [stay, setStay] = useState(() =>
    stayFromColumns({ check_in_time: initialCheckInTime, check_out_time: initialCheckOutTime, mode: initialMode }),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Confirmation contenue dans cette carte (docs/specs/40 §4) — jamais plein écran, toujours
  // « admin/succès » (bloc jamais atteint par un partenaire).
  const [showConfirmation, setShowConfirmation] = useState(false);

  async function handleSave() {
    setIsSubmitting(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("update_establishment_stay_details", {
      p_establishment_id: establishmentId,
      // `undefined` et non `null` : un paramètre à valeur par défaut est typé optionnel côté
      // types générés. Vider un champ l'EFFACE quand même — la clé est alors omise, Postgres
      // applique le défaut `null`, et l'update assigne sans condition. Même idiome que
      // update_establishment (`p_address: address.trim() || undefined`), qui repose exactement sur
      // ce mécanisme depuis la spec 06. Un horaire saisi par erreur reste donc corrigeable.
      p_check_in_time: stay.checkIn || undefined,
      p_check_out_time: stay.checkOut || undefined,
      p_mode: stay.mode || undefined,
    });
    setIsSubmitting(false);

    const result = data as { ok: boolean } | null;
    if (error || !result?.ok) {
      toast.danger("No se pudo guardar la información de alojamiento.");
      return;
    }
    router.refresh();
    setShowConfirmation(true);
  }

  return (
    <FormSection title="Alojamiento" testId="establishment-stay-block">
      {showConfirmation ? (
        <ActionConfirmation
          contained
          status="success"
          title="Cambios guardados"
          body="Los cambios ya están visibles públicamente — no necesitan revisión adicional."
          actionLabel="Editar de nuevo"
          onAction={() => setShowConfirmation(false)}
          testId="establishment-stay-confirmation"
        />
      ) : (
      <>
      <StayFields value={stay} onChange={setStay} />

      <div>
        <Button
          onPress={handleSave}
          isDisabled={isSubmitting}
          data-testid="save-establishment-stay-button"
        >
          Guardar
        </Button>
      </div>
      </>
      )}
    </FormSection>
  );
}
