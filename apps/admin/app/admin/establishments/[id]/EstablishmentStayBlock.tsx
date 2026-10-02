"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, ListBox, Select, TextField, toast } from "@hifago/ui";
import { ActionConfirmation } from "@/components/action-confirmation";

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

const MODE_NONE = "none";
const MODE_LABELS: Record<string, string> = {
  rooms: "Habitaciones a elegir",
  whole_house: "Alojamiento completo",
};

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

  // "HH:MM:SS" en base → "HH:MM" attendu par <Input type="time">, même conversion que le formulaire
  // produit.
  const [checkIn, setCheckIn] = useState(initialCheckInTime ? initialCheckInTime.slice(0, 5) : "");
  const [checkOut, setCheckOut] = useState(initialCheckOutTime ? initialCheckOutTime.slice(0, 5) : "");
  const [mode, setMode] = useState(initialMode ?? "");
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
      p_check_in_time: checkIn || undefined,
      p_check_out_time: checkOut || undefined,
      p_mode: mode || undefined,
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
    <section className="flex flex-col gap-4 rounded-lg border bg-surface p-4" data-testid="establishment-stay-block">
      <h2 className="text-lg font-medium">Alojamiento</h2>

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
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextField fullWidth name="establishment-check-in" value={checkIn} onChange={setCheckIn}>
          <Label>Check-in — opcional</Label>
          <Input type="time" data-testid="establishment-check-in-input" />
        </TextField>
        <TextField fullWidth name="establishment-check-out" value={checkOut} onChange={setCheckOut}>
          <Label>Check-out — opcional</Label>
          <Input type="time" data-testid="establishment-check-out-input" />
        </TextField>
      </div>

      {/* « Sin especificar » n'est pas un oubli à combler : un établissement qui ne vend que des
          activités n'a pas de mode d'hébergement, et lui en imposer un fabriquerait une information
          fausse. La page publique retombe alors sur un intitulé neutre. */}
      <Select
        fullWidth
        value={mode || MODE_NONE}
        onChange={(value) => setMode(!value || value === MODE_NONE ? "" : String(value))}
      >
        <Label>¿Cómo se vende este establecimiento? — opcional</Label>
        <Select.Trigger data-testid="establishment-mode-select">
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id={MODE_NONE} textValue="Sin especificar">
              Sin especificar
              <ListBox.ItemIndicator />
            </ListBox.Item>
            {Object.entries(MODE_LABELS).map(([value, label]) => (
              <ListBox.Item key={value} id={value} textValue={label}>
                {label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

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
    </section>
  );
}
