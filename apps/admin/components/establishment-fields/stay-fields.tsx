"use client";

import { Input, Label, ListBox, Select, TextField } from "@hifago/ui";
import { STAY_MODE_LABELS, type StayValues } from "@/lib/establishments/stayFields";

const MODE_NONE = "none";

// Check-in, check-out et « ¿Cómo se vende? » d'un établissement — les champs du bloc admin
// EstablishmentStayBlock, partagés avec les formulaires de proposition du partenaire. Les
// identifiants de test sont ceux de l'admin : un seul formulaire par écran, jamais deux.
export function StayFields({ value, onChange }: { value: StayValues; onChange: (next: StayValues) => void }) {
  return (
    <>
      {/* Empilés sous md (.claude/rules/ui.md, responsive). */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextField
          fullWidth
          name="establishment-check-in"
          value={value.checkIn}
          onChange={(checkIn) => onChange({ ...value, checkIn })}
        >
          <Label>Check-in — opcional</Label>
          <Input type="time" data-testid="establishment-check-in-input" />
        </TextField>
        <TextField
          fullWidth
          name="establishment-check-out"
          value={value.checkOut}
          onChange={(checkOut) => onChange({ ...value, checkOut })}
        >
          <Label>Check-out — opcional</Label>
          <Input type="time" data-testid="establishment-check-out-input" />
        </TextField>
      </div>

      {/* « Sin especificar » n'est pas un oubli à combler : un établissement qui ne vend que des
          activités n'a pas de mode d'hébergement, et lui en imposer un fabriquerait une information
          fausse. La page publique retombe alors sur un intitulé neutre. */}
      <Select
        fullWidth
        value={value.mode || MODE_NONE}
        onChange={(next) => onChange({ ...value, mode: !next || next === MODE_NONE ? "" : String(next) })}
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
            {Object.entries(STAY_MODE_LABELS).map(([mode, label]) => (
              <ListBox.Item key={mode} id={mode} textValue={label}>
                {label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </>
  );
}
