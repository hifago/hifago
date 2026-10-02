"use client";

import { Checkbox, Input, Label, TextArea, TextField } from "@hifago/ui";
import type { DraftStayRates } from "@/lib/products/stayRates";

// Spec 12 — extras de tarification d'un hébergement (saison, week-end, inclusions, dépôt, note).
// Composant UI pur, contrôlé (value/onChange), aucun I/O réseau — même discipline que
// SlotRulesEditor. Les paliers de prix par nombre de personnes n'apparaissent PAS ici : ils
// réutilisent le bloc "Precio por tramos" déjà présent dans ProductForm (price_tiers, spec 08).
const MONTHS: { value: number; label: string }[] = [
  { value: 1, label: "Ene" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Abr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Ago" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dic" },
];

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mié" },
  { value: 4, label: "Jue" },
  { value: 5, label: "Vie" },
  { value: 6, label: "Sáb" },
  { value: 7, label: "Dom" },
];

export function StayRatesEditor({
  value,
  onChange,
  testIdPrefix = "",
}: {
  value: DraftStayRates;
  onChange: (next: DraftStayRates) => void;
  // Vide par défaut (usage alojamiento existant, zéro changement de data-testid) — non vide quand
  // plusieurs instances coexistent sur le même écran (une par chambre d'hôtel, spec 13 suite),
  // pour éviter une collision de data-testid entre chambres.
  testIdPrefix?: string;
}) {
  function toggle(field: "seasonMonths" | "weekendDays", day: number) {
    const current = value[field];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    onChange({ ...value, [field]: next });
  }

  return (
    <div className="flex flex-col gap-4" data-testid={`${testIdPrefix}stay-rates-editor`}>
      <div className="flex flex-col gap-2">
        <Label>Temporada alta — opcional</Label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Meses de temporada alta">
          {MONTHS.map((month) => (
            <Checkbox
              key={month.value}
              data-testid={`${testIdPrefix}stay-rates-month-${month.value}`}
              isSelected={value.seasonMonths.includes(month.value)}
              onChange={() => toggle("seasonMonths", month.value)}
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                {month.label}
              </Checkbox.Content>
            </Checkbox>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <TextField
            value={value.seasonSurchargePct}
            onChange={(next) => onChange({ ...value, seasonSurchargePct: next })}
          >
            <Label>Recargo (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              data-testid={`${testIdPrefix}stay-rates-season-surcharge-input`}
            />
          </TextField>
          <TextField value={value.seasonNote} onChange={(next) => onChange({ ...value, seasonNote: next })}>
            <Label>Nota</Label>
            <Input data-testid={`${testIdPrefix}stay-rates-season-note-input`} />
          </TextField>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Recargo fin de semana — opcional</Label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Días de fin de semana">
          {WEEKDAYS.map((day) => (
            <Checkbox
              key={day.value}
              data-testid={`${testIdPrefix}stay-rates-weekend-day-${day.value}`}
              isSelected={value.weekendDays.includes(day.value)}
              onChange={() => toggle("weekendDays", day.value)}
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                {day.label}
              </Checkbox.Content>
            </Checkbox>
          ))}
        </div>
        <TextField
          value={value.weekendSurchargePct}
          onChange={(next) => onChange({ ...value, weekendSurchargePct: next })}
        >
          <Label>Recargo (%)</Label>
          <Input
            type="number"
            min={0}
            max={100}
            data-testid={`${testIdPrefix}stay-rates-weekend-surcharge-input`}
          />
        </TextField>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <TextField value={value.depositCop} onChange={(next) => onChange({ ...value, depositCop: next })}>
          <Label>Depósito (COP) — opcional</Label>
          <Input type="number" min={0} data-testid={`${testIdPrefix}stay-rates-deposit-input`} />
        </TextField>
      </div>
      <TextField value={value.extraNote} onChange={(next) => onChange({ ...value, extraNote: next })}>
        <Label>Nota adicional — opcional</Label>
        <TextArea data-testid={`${testIdPrefix}stay-rates-extra-note-input`} />
      </TextField>
    </div>
  );
}
