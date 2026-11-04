// Règles de créneaux horaires récurrents — spec 11. Miroir structurel de priceTiers.ts (même
// convention : type "brouillon" en strings pour les inputs contrôlés, validation retournant un
// message d'erreur ou null, conversion vers les types réels de colonne juste avant l'écriture).
// Comparé à l'app legacy (règle "refaire pas réinventer") : zéro précédent, même partiel — le seul
// niveau de granularité horaire jamais implémenté côté V1 est un choix binaire matin/après-midi
// (products.schedule='slot'), jamais des créneaux récurrents par jour de semaine. Terrain vierge,
// cf. spec 11 §1.
export type DraftSlotRule = {
  weekdays: number[]; // ISO 8601 : 1=lundi..7=dimanche
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  slotDurationMinutes: string;
  capacity: string;
};

export type ParsedSlotRule = {
  weekdays: number[];
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  capacity: number;
};

export function emptySlotRule(): DraftSlotRule {
  return { weekdays: [], startTime: "", endTime: "", slotDurationMinutes: "", capacity: "" };
}

// Retourne un message d'erreur (à afficher tel quel) si une règle est invalide, sinon null. Un
// tableau vide est valide ICI (l'édition admin peut encore vider les horaires) ; la création d'une
// activité et la proposition du partenaire passent par requiredSlotRulesError, qui l'interdit.
export function validateSlotRules(rules: DraftSlotRule[]): string | null {
  for (const rule of rules) {
    if (rule.weekdays.length === 0) {
      return "Cada horario necesita al menos un día de la semana.";
    }
    if (!rule.startTime || !rule.endTime) {
      return "Cada horario necesita una hora de inicio y una hora de fin.";
    }
    if (rule.endTime <= rule.startTime) {
      return "La hora de fin debe ser posterior a la hora de inicio.";
    }
    const duration = Number(rule.slotDurationMinutes);
    if (!Number.isInteger(duration) || duration < 1) {
      return "La duración del turno debe ser un número entero de al menos 1 minuto.";
    }
    const capacity = Number(rule.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      return "La capacidad de cada turno debe ser un número entero de al menos 1.";
    }
  }

  // Non-chevauchement entre règles du même produit (spec 18 §0 Tranche 1) — même algorithme que
  // validatePriceTiers (comparaison pairwise), restreint aux paires qui partagent au moins un jour
  // de semaine : deux règles sur des jours disjoints peuvent librement se chevaucher en horaire
  // (ex. "lundi 9h-12h" et "mardi 14h-18h" ne se gênent jamais). Comparaison de chaînes "HH:MM"
  // valide ici (zero-padded, même convention que la validation endTime <= startTime ci-dessus).
  for (let i = 0; i < rules.length; i += 1) {
    for (let j = i + 1; j < rules.length; j += 1) {
      const a = rules[i];
      const b = rules[j];
      const sharesWeekday = a.weekdays.some((day) => b.weekdays.includes(day));
      if (!sharesWeekday) continue;
      if (a.startTime < b.endTime && b.startTime < a.endTime) {
        return "Dos horarios no pueden superponerse el mismo día de la semana.";
      }
    }
  }

  return null;
}

/**
 * Une activité a au moins un horaire (demande Jérôme du 2026-11-04, migration 20261104120000) :
 * sans règle, aucun créneau n'est dérivé et le client ne peut choisir aucune heure. Même exigence
 * côté base (slot_rules_required) pour toute proposition du partenaire.
 */
export function requiredSlotRulesError(rules: DraftSlotRule[]): string | null {
  if (rules.length === 0) {
    return "Una actividad necesita al menos un horario.";
  }
  return validateSlotRules(rules);
}

/**
 * La clé `slot_rules` n'entre dans une proposition d'ÉDITION que si les horaires ont changé — même
 * règle que tagIdsIfChanged (lib/tags/proposedTags.ts), et pour la même raison : côté SQL, une clé
 * présente REMPLACE tous les horaires à l'approbation. L'envoyer à chaque fois ferait d'une simple
 * correction de nom un écrasement des horaires qu'un admin aurait changés entre-temps.
 */
export function slotRulesIfChanged(
  current: DraftSlotRule[],
  edited: DraftSlotRule[],
): { slot_rules?: ParsedSlotRule[] } {
  const rows = toSlotRuleRows(edited);
  return JSON.stringify(rows) === JSON.stringify(toSlotRuleRows(current)) ? {} : { slot_rules: rows };
}

/** Les horaires proposés, ou `null` quand la proposition n'y touche pas. */
export function proposedSlotRules(payload: { slot_rules?: unknown }): DraftSlotRule[] | null {
  return Array.isArray(payload.slot_rules) ? slotRulesFromColumn(payload.slot_rules) : null;
}

const WEEKDAY_SHORT = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/** Résumé lisible des horaires en place (écran de modération, « Valor actual »). */
export function formatSlotRulesSummary(rules: DraftSlotRule[]): string {
  if (rules.length === 0) return "—";
  return rules
    .map((rule) => {
      const days = [...rule.weekdays].sort((a, b) => a - b).map((d) => WEEKDAY_SHORT[d]).join(", ");
      return `${days} ${rule.startTime}–${rule.endTime} (${rule.slotDurationMinutes} min, cupo ${rule.capacity})`;
    })
    .join(" · ");
}

export function toSlotRuleRows(rules: DraftSlotRule[]): ParsedSlotRule[] {
  return rules.map((rule) => ({
    weekdays: [...rule.weekdays].sort((a, b) => a - b),
    start_time: rule.startTime,
    end_time: rule.endTime,
    slot_duration_minutes: Number(rule.slotDurationMinutes),
    capacity: Number(rule.capacity),
  }));
}

// Sens inverse de toSlotRuleRows (colonne/payload → brouillon), spec 15 — hydrate le formulaire de
// modération d'une proposition de création à partir de payload.slot_rules (même forme JSON qu'une
// ligne product_slot_rules, "HH:MM:SS" compris — cf. toTimeInputValue déjà utilisé ailleurs dans
// ProductForm pour la même conversion). Une entrée illisible est ignorée plutôt que de faire
// planter l'hydratation de tout le formulaire, même philosophie que stayRatesFromColumn.
export function slotRulesFromColumn(value: unknown): DraftSlotRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Partial<ParsedSlotRule> => !!row && typeof row === "object")
    .map((row) => ({
      weekdays: Array.isArray(row.weekdays)
        ? row.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7)
        : [],
      startTime: typeof row.start_time === "string" ? row.start_time.slice(0, 5) : "",
      endTime: typeof row.end_time === "string" ? row.end_time.slice(0, 5) : "",
      slotDurationMinutes:
        typeof row.slot_duration_minutes === "number" ? String(row.slot_duration_minutes) : "",
      capacity: typeof row.capacity === "number" ? String(row.capacity) : "",
    }));
}

const PREVIEW_LIMIT = 8;

// Prévisualisation purement client-side — aucune écriture, aucune logique de réservation/capacité
// live (Tranche 2, cf. spec 11 §2). Un reliquat non multiple de la durée est simplement tronqué,
// pas signalé comme une erreur.
export function generateSlotPreview(rule: DraftSlotRule): string[] {
  const duration = Number(rule.slotDurationMinutes);
  if (!rule.startTime || !rule.endTime || !Number.isInteger(duration) || duration < 1) return [];

  const startMinutes = toMinutes(rule.startTime);
  const endMinutes = toMinutes(rule.endTime);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return [];

  const slots: string[] = [];
  for (let cursor = startMinutes; cursor + duration <= endMinutes; cursor += duration) {
    slots.push(`${formatMinutes(cursor)}–${formatMinutes(cursor + duration)}`);
  }
  return slots;
}

// Résumé tronqué prêt à afficher (data-testid="slot-rule-preview-*") — évite une liste illisible
// pour une plage longue à petits créneaux (ex. 11h de créneaux de 15 min = 44 entrées).
export function formatSlotPreviewSummary(rule: DraftSlotRule): string {
  const slots = generateSlotPreview(rule);
  if (slots.length === 0) return "";
  if (slots.length <= PREVIEW_LIMIT) return slots.join(", ");
  return `${slots.slice(0, PREVIEW_LIMIT).join(", ")}… (+${slots.length - PREVIEW_LIMIT} más)`;
}

function toMinutes(time: string): number | null {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  return h * 60 + m;
}

function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
