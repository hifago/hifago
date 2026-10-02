"use client";

import { Input, Label, ListBox, Select, TextField } from "@hifago/ui";
import { StayRatesEditor } from "@/components/stay-rates-editor";
import { LODGING_KINDS, LODGING_UNITS, type LodgingKind, type LodgingUnit } from "@hifago/domain";
import { LODGING_KIND_LABELS } from "@/lib/products/lodgingKindLabels";
import { LODGING_UNIT_LABELS } from "@/lib/products/lodgingUnitLabels";
import type { ProductTypeFieldsState } from "@/lib/products/useProductTypeFieldsState";

// Le sentinel « none » existe parce que products.lodging_kind est facultative et que react-aria ne
// sait pas représenter « aucune option » avec une clé vide. Les libellés, eux, sont partagés avec
// l'écran de modération (lib/products/lodgingKindLabels.ts) — jamais redéclarés ici.
const LODGING_KIND_NONE = "none";

// Extrait de product-type-fields.tsx (découpage des god components, 2026-09-17) — rendu pour
// `type === "lodging"`. Monté par le fichier hôte sur `isLodging` (même gate que StayRatesEditor
// ci-dessous, TOUJOURS rendu quand ce composant l'est) ; `hasCheckInOut` reste une prop séparée
// bien qu'identique à `isLodging` aujourd'hui (`hasCheckInOut: isLodging`, productTypeGating.ts) —
// gardé distinct pour ne pas figer une équivalence que le gating ne garantit pas dans le temps.
export function LodgingFields({
  state,
  section,
  hasCheckInOut,
  establishmentLobbyConnected,
}: {
  state: ProductTypeFieldsState;
  // Assistant par étapes (docs/specs/40) — la grille check-in/capacidad/tipo décrit le logement
  // (« details »), `StayRatesEditor` en revanche ajuste le prix par saison/week-end (« pricing ») :
  // les deux étaient rendus l'un après l'autre sans condition, jamais séparés avant ce chantier.
  section?: "details" | "pricing";
  hasCheckInOut: boolean;
  establishmentLobbyConnected?: boolean;
}) {
  const showDetails = !section || section === "details";
  const showPricing = !section || section === "pricing";

  return (
    <>
      {/* 2 colonnes dans tous les cas : un hôtel n'a que check-in/check-out, un alojamiento
          complète la 2e ligne avec capacité + cantidad (ajoutée le 2026-08-26). Une grille de 4
          colonnes serait illisible sur un écran étroit. */}
      {showDetails && hasCheckInOut ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField fullWidth name="check-in" value={state.checkInTime} onChange={state.setCheckInTime}>
            <Label>Check-in — opcional</Label>
            <Input type="time" data-testid="check-in-input" />
          </TextField>
          <TextField fullWidth name="check-out" value={state.checkOutTime} onChange={state.setCheckOutTime}>
            <Label>Check-out — opcional</Label>
            <Input type="time" data-testid="check-out-input" />
          </TextField>
          {/* Arbitrage Jérôme du 2026-08-26 (« import à la liaison ») : la capacité redevient
              éditable même pour une chambre liée. Elle était masquée parce qu'elle faisait doublon
              avec le `capacity` de Lobby — sauf que rien ne la lisait chez eux, donc le champ
              restait simplement vide, et la fiche publique avec. Elle est désormais PRÉREMPLIE
              depuis Lobby (bouton « Usar estos datos » du picker) puis corrigeable ici. */}
          <TextField fullWidth name="capacity" value={state.capacity} onChange={state.setCapacity}>
            <Label>Capacidad (couchage) — opcional</Label>
            <Input type="number" min={1} data-testid="capacity-input" />
          </TextField>
          {/* `quantity` (2026-08-26) : combien d'unités de ce type existent — 3 cabañas, 8 lits.
              Purement DESCRIPTIF, aucune RPC ne s'en sert pour autoriser une réservation (pour un
              logement PMS-backed, c'est Lobby qui tranche la disponibilité en direct). Préremplie
              depuis Lobby comme la capacité juste à côté ; le libellé nomme les deux unités
              possibles parce que « cantidad » seul se confondrait avec la capacité. */}
          <TextField fullWidth name="unit-count" value={state.unitCount} onChange={state.setUnitCount}>
            <Label>Cantidad (habitaciones o camas) — opcional</Label>
            <Input type="number" min={1} data-testid="unit-count-input" />
          </TextField>

          {/* Nature du couchage (2026-08-27) — TROIS valeurs, pas deux. « Casa entera » n'est pas
              théorique : la v1 en production loue déjà Bania Travel comme maison entière. Elle ne
              viendra JAMAIS d'un import, le vocabulaire de Lobby n'ayant que privada/compartida —
              d'où la mention sous le champ quand l'établissement est connecté, sans quoi on
              chercherait longtemps pourquoi « Usar estos datos » ne la remplit pas. Descriptif :
              aucune RPC de commande ne le lit (cf. migration 20260827120000). */}
          <div className="flex flex-col gap-1">
            <Select
              fullWidth
              value={state.lodgingKind || LODGING_KIND_NONE}
              onChange={(value) =>
                state.setLodgingKind(
                  !value || value === LODGING_KIND_NONE ? "" : (value as LodgingKind),
                )
              }
            >
              <Label>Tipo de alojamiento — opcional</Label>
              <Select.Trigger data-testid="lodging-kind-select">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id={LODGING_KIND_NONE} textValue="Sin especificar">
                    Sin especificar
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  {LODGING_KINDS.map((kind) => (
                    <ListBox.Item key={kind} id={kind} textValue={LODGING_KIND_LABELS[kind]}>
                      {LODGING_KIND_LABELS[kind]}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            {establishmentLobbyConnected ? (
              <p className="text-xs text-muted">
                «Casa entera» no existe en LobbyPMS: siempre se elige a mano.
              </p>
            ) : null}
          </div>

          {/* Unité de PRIX (2026-08-27, défaut C4). `products.unit` existait depuis le 13/08,
              contrainte et lue par la fiche publique, mais n'était écrite par RIEN — seul seed.sql
              la renseignait. Elle est ici pour la première fois saisissable. À ne pas confondre
              avec le champ juste au-dessus : celui-là dit ce QU'ON VEND (un lit, une chambre, une
              maison), celui-ci dit COMMENT ON LE FACTURE. La liaison Lobby ne la prérremplit que
              dans les cas non ambigus — leurs prix sont par niveau d'occupation, un modèle que
              hifago n'a pas (cf. proposeLodgingUnit). */}
          <Select
            fullWidth
            value={state.unit || LODGING_KIND_NONE}
            onChange={(value) =>
              state.setUnit(!value || value === LODGING_KIND_NONE ? "" : (value as LodgingUnit))
            }
          >
            <Label>Unidad de precio — opcional</Label>
            <Select.Trigger data-testid="lodging-unit-select">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id={LODGING_KIND_NONE} textValue="Sin especificar">
                  Sin especificar
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                {LODGING_UNITS.map((unit) => (
                  <ListBox.Item key={unit} id={unit} textValue={LODGING_UNIT_LABELS[unit]}>
                    {LODGING_UNIT_LABELS[unit]}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
      ) : null}

      {showPricing ? <StayRatesEditor value={state.stayRates} onChange={state.setStayRates} /> : null}
    </>
  );
}
