"use client";

import { Checkbox, Input, Label, TextField } from "@hifago/ui";
import {
  emptySlotRule,
  formatSlotPreviewSummary,
  type DraftSlotRule,
} from "@/lib/products/slotRules";

// Spec 11 — éditeur de créneaux horaires récurrents. Composant UI pur, contrôlé (rules/onChange),
// AUCUN I/O réseau : réutilisable tel quel en création (état "stagé" dans ProductForm) et en
// édition (ProductSlotRulesBlock, sauvegarde immédiate) — et, par construction sans dépendance à
// `products`, réutilisable ailleurs plus tard comme demandé ("ceci doit être un module qui va à
// plusieurs endroits"). Zéro logique de réservation/capacité live : Tranche 2 future, cf. spec 11.
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mié" },
  { value: 4, label: "Jue" },
  { value: 5, label: "Vie" },
  { value: 6, label: "Sáb" },
  { value: 7, label: "Dom" },
];

export function SlotRulesEditor({
  rules,
  onChange,
}: {
  rules: DraftSlotRule[];
  onChange: (next: DraftSlotRule[]) => void;
}) {
  function updateRule(index: number, next: DraftSlotRule) {
    onChange(rules.map((rule, i) => (i === index ? next : rule)));
  }

  function toggleWeekday(index: number, weekday: number) {
    const rule = rules[index];
    const nextWeekdays = rule.weekdays.includes(weekday)
      ? rule.weekdays.filter((day) => day !== weekday)
      : [...rule.weekdays, weekday];
    updateRule(index, { ...rule, weekdays: nextWeekdays });
  }

  function removeRule(index: number) {
    onChange(rules.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3" data-testid="slot-rules-editor">
      {rules.map((rule, index) => {
        const preview = formatSlotPreviewSummary(rule);
        return (
          <div key={index} className="flex flex-col gap-2 rounded-md border border-default p-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Días de la semana">
              {WEEKDAYS.map((day) => (
                <Checkbox
                  key={day.value}
                  data-testid={`slot-rule-weekday-${day.value}-${index}`}
                  isSelected={rule.weekdays.includes(day.value)}
                  onChange={() => toggleWeekday(index, day.value)}
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
            <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
              <TextField
                value={rule.startTime}
                onChange={(value) => updateRule(index, { ...rule, startTime: value })}
              >
                <Label>Hora de inicio</Label>
                <Input type="time" data-testid={`slot-rule-start-${index}`} />
              </TextField>
              <TextField
                value={rule.endTime}
                onChange={(value) => updateRule(index, { ...rule, endTime: value })}
              >
                <Label>Hora de fin</Label>
                <Input type="time" data-testid={`slot-rule-end-${index}`} />
              </TextField>
              <TextField
                value={rule.slotDurationMinutes}
                onChange={(value) => updateRule(index, { ...rule, slotDurationMinutes: value })}
              >
                <Label>Duración (min)</Label>
                <Input type="number" min={1} data-testid={`slot-rule-duration-${index}`} />
              </TextField>
              <TextField
                value={rule.capacity}
                onChange={(value) => updateRule(index, { ...rule, capacity: value })}
              >
                <Label>Capacidad</Label>
                <Input type="number" min={1} data-testid={`slot-rule-capacity-${index}`} />
              </TextField>
            </div>
            {preview ? (
              <p className="text-xs text-muted" data-testid={`slot-rule-preview-${index}`}>
                {preview}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => removeRule(index)}
              data-testid={`remove-slot-rule-${index}`}
              className="self-start text-xs font-medium text-danger underline"
            >
              Quitar horario
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange([...rules, emptySlotRule()])}
        data-testid="add-slot-rule-button"
        className="self-start text-xs font-medium underline"
      >
        + Agregar horario
      </button>
    </div>
  );
}
