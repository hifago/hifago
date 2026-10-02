"use client";

import { Input, Label, TextField } from "@hifago/ui";
import { ProgramEditor } from "@/components/program-editor";
import type { ProductTypeFieldsState } from "@/lib/products/useProductTypeFieldsState";

// Extrait de product-type-fields.tsx (découpage des god components, 2026-09-17) — les trois blocs
// aujourd'hui exclusifs à `type === "camp"` (hasGroupDiscount/hasProgram valent `isCamp` dans
// productTypeGating.ts, la durée est gatée directement sur `isCamp`) — gardés comme trois props
// séparées plutôt qu'un seul `isCamp`, pour ne pas figer une équivalence que le gating ne garantit
// pas dans le temps (hasGroupDiscount/hasProgram pourraient un jour s'ouvrir à un autre type sans
// que ce composant change).
export function CampFields({
  state,
  section,
  hasGroupDiscount,
  isCamp,
  hasProgram,
  campDurationDays = null,
}: {
  state: ProductTypeFieldsState;
  // Assistant par étapes (docs/specs/40) — descuento por grupo vit dans « pricing » (c'est un
  // ajustement de prix), durée+programme dans « details » (ce sont des faits descriptifs du
  // séjour) : les deux étaient rendus l'un après l'autre dans ce même fichier, jamais séparés par
  // section avant ce chantier.
  section?: "details" | "pricing";
  hasGroupDiscount: boolean;
  isCamp: boolean;
  hasProgram: boolean;
  // Durée PERSISTÉE du camp (spec 37), pour que l'éditeur de programme ouvre le bon nombre de
  // journées en ÉDITION — où l'input « Duración (días) » reste volontairement vierge (gap
  // création-only, cf. le commentaire du select dans admin/products/[id]/edit/page.tsx). En
  // création, la valeur saisie dans le formulaire prime sur cette prop. Elle n'alimente QUE
  // l'éditeur de programme : la réinjecter dans l'input afficherait une valeur que l'update
  // n'écrit pas.
  campDurationDays?: number | null;
}) {
  const showDetails = !section || section === "details";
  const showPricing = !section || section === "pricing";

  return (
    <>
      {showPricing && hasGroupDiscount ? (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextField
              fullWidth
              name="group-discount-threshold-qty"
              value={state.groupDiscount.thresholdQty}
              onChange={(value) => state.setGroupDiscount({ ...state.groupDiscount, thresholdQty: value })}
            >
              <Label>Descuento por grupo — a partir de (personas) — opcional</Label>
              <Input type="number" min={1} data-testid="group-discount-threshold-qty-input" />
            </TextField>
            <TextField
              fullWidth
              name="group-discount-pct"
              value={state.groupDiscount.pct}
              onChange={(value) => state.setGroupDiscount({ ...state.groupDiscount, pct: value })}
            >
              <Label>Porcentaje de descuento — opcional</Label>
              <Input type="number" min={1} max={99} data-testid="group-discount-pct-input" />
            </TextField>
          </div>
          <p className="text-xs text-muted" data-testid="group-discount-help">
            Si el total de personas ya inscritas en esta salida (todas las reservas juntas) alcanza
            este umbral, el precio de esa reserva y de las siguientes baja el porcentaje indicado.
            Distinto de los tramos de precio: esto depende de cuánta gente se anota en total, no de
            la cantidad de UNA sola reserva. Completa los dos campos juntos, o deja ambos vacíos.
          </p>
        </div>
      ) : null}

      {showDetails && isCamp ? (
        <TextField
          fullWidth
          name="duration-days"
          value={state.durationDays}
          onChange={state.setDurationDays}
          isRequired
        >
          <Label>Duración (días)</Label>
          <Input type="number" min={1} data-testid="duration-days-input" />
        </TextField>
      ) : null}

      {showDetails && hasProgram ? (
        <ProgramEditor
          value={state.program}
          onChange={state.setProgram}
          // La durée SAISIE prime sur la durée persistée : en création elle n'existe que dans le
          // formulaire, et en édition on veut suivre l'écran si l'admin la renseigne. `Number("")`
          // vaut 0, d'où le test sur la chaîne avant la conversion (même garde que
          // productCreationPayload).
          durationDays={
            state.durationDays.trim() !== "" && Number(state.durationDays) >= 1
              ? Number(state.durationDays)
              : campDurationDays
          }
        />
      ) : null}
    </>
  );
}
