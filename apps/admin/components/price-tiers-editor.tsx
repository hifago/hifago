"use client";

import { Input, Label, TextField } from "@hifago/ui";
import { emptyTier, type PriceTier } from "@/lib/products/priceTiers";

export type PriceTiersEditorTestIdPart =
  | "toggle"
  | "simple-input"
  | "tiers-editor"
  | "add-tier"
  | "tier-min"
  | "tier-max"
  | "tier-price"
  | "remove-tier";

// Bloc "prix simple ou par tramos" du prix d'un produit (ProductForm, spec 08). Composant UI pur,
// contrôlé, aucun I/O réseau. `testId` laisse l'appelant reproduire exactement ses data-testid
// existants sans que ce composant n'ait à connaître sa convention de nommage — le paramètre vient
// de l'époque où HotelRoomsEditor l'utilisait aussi, avec un index par chambre.
export function PriceTiersEditor({
  priceMode,
  onPriceModeChange,
  priceCop,
  onPriceCopChange,
  priceTiers,
  onPriceTiersChange,
  testId,
  label = "Precio",
  allowTiers = true,
}: {
  priceMode: "simple" | "tiers";
  onPriceModeChange: (mode: "simple" | "tiers") => void;
  priceCop: string;
  onPriceCopChange: (value: string) => void;
  priceTiers: PriceTier[];
  onPriceTiersChange: (tiers: PriceTier[]) => void;
  testId: (part: PriceTiersEditorTestIdPart, tierIndex?: number) => string;
  /** Libellé du prix — « Precio por hora (COP) » pour une activité à l'heure (spec 43). */
  label?: string;
  /** `false` : prix simple seulement (activité vendue entière, spec 43) — les tramos restent dans
   *  l'état mais ne sont ni affichés ni envoyés (productCreationPayload/productEditPayload). */
  allowTiers?: boolean;
}) {
  const modeAffiche = allowTiers ? priceMode : "simple";

  function updateTier(tierIndex: number, next: PriceTier) {
    onPriceTiersChange(priceTiers.map((tier, i) => (i === tierIndex ? next : tier)));
  }

  function removeTier(tierIndex: number) {
    onPriceTiersChange(priceTiers.filter((_, i) => i !== tierIndex));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {allowTiers ? (
          <button
            type="button"
            data-testid={testId("toggle")}
            onClick={() => onPriceModeChange(priceMode === "simple" ? "tiers" : "simple")}
            className="text-xs font-medium underline"
          >
            {priceMode === "simple" ? "Definir por tramos" : "Volver a precio simple"}
          </button>
        ) : null}
      </div>
      {modeAffiche === "simple" ? (
        <TextField fullWidth name="price" value={priceCop} onChange={onPriceCopChange} isRequired>
          <Input id="price" type="number" min={1} data-testid={testId("simple-input")} />
        </TextField>
      ) : (
        <div className="flex flex-col gap-2" data-testid={testId("tiers-editor")}>
          {priceTiers.map((tier, tierIndex) => (
            <div key={tierIndex} className="flex flex-wrap items-end gap-2">
              <TextField
                value={tier.minQty}
                onChange={(value) => updateTier(tierIndex, { ...tier, minQty: value })}
              >
                <Label>Desde</Label>
                <Input type="number" min={1} data-testid={testId("tier-min", tierIndex)} />
              </TextField>
              <TextField
                value={tier.maxQty}
                onChange={(value) => updateTier(tierIndex, { ...tier, maxQty: value })}
              >
                <Label>Hasta</Label>
                <Input type="number" min={1} data-testid={testId("tier-max", tierIndex)} />
              </TextField>
              <TextField
                value={tier.priceCop}
                onChange={(value) => updateTier(tierIndex, { ...tier, priceCop: value })}
              >
                <Label>Precio (COP)</Label>
                <Input type="number" min={1} data-testid={testId("tier-price", tierIndex)} />
              </TextField>
              {priceTiers.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeTier(tierIndex)}
                  aria-label="Quitar tramo"
                  data-testid={testId("remove-tier", tierIndex)}
                  className="pb-2 text-sm text-danger"
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            onClick={() => onPriceTiersChange([...priceTiers, emptyTier()])}
            data-testid={testId("add-tier")}
            className="self-start text-xs font-medium underline"
          >
            + Agregar tramo
          </button>
        </div>
      )}
    </div>
  );
}
