"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { Button, toast } from "@hifago/ui";
import { SlotRulesEditor } from "@/components/slot-rules-editor";
import { toSlotRuleRows, validateSlotRules, type DraftSlotRule } from "@/lib/products/slotRules";

// Bloc séparé du formulaire d'édition — même patron que ProductTagsBlock.tsx : action distincte,
// sauvegarde immédiate, pas un champ de plus dans le submit principal de ProductForm. Contrairement
// aux tags (ajout/retrait incrémental), le jeu de règles est édité comme un tout : "Guardar
// horarios" remplace toutes les lignes existantes par l'état courant (pas de diff ligne-à-ligne,
// plus simple et suffisant pour le volume attendu — quelques règles par activité).
//
// Le remplacement passe par UNE RPC, replace_product_slot_rules (20261001235031) : le delete et
// les inserts se font dans la même transaction. Avant, deux requêtes séparées depuis le
// navigateur pouvaient laisser l'activité sans aucune règle — donc invendable — si la seconde
// échouait.
export function ProductSlotRulesBlock({
  productId,
  initialRules,
}: {
  productId: string;
  initialRules: DraftSlotRule[];
}) {
  const [rules, setRules] = useState(initialRules);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    const validationError = validateSlotRules(rules);
    if (validationError) {
      toast.danger(validationError);
      return;
    }

    setIsSaving(true);
    const supabase = createClient();

    const { data, error } = await supabase.rpc("replace_product_slot_rules", {
      p_product_id: productId,
      p_rules: toSlotRuleRows(rules),
    });
    if (error || !(data as { ok?: boolean } | null)?.ok) {
      toast.danger("No se pudo guardar los horarios.");
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    toast.success("Horarios guardados.");
  }

  return (
    <div className="rounded-lg border bg-surface p-4">
      <h2 className="mb-3 text-sm font-medium">Horarios</h2>
      <SlotRulesEditor rules={rules} onChange={setRules} />
      <div className="mt-3 flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          isDisabled={isSaving}
          onPress={handleSave}
          data-testid="save-slot-rules-button"
        >
          {isSaving ? "Guardando…" : "Guardar horarios"}
        </Button>
      </div>
    </div>
  );
}
