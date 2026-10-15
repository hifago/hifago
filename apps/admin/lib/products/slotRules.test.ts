import { describe, expect, it } from "vitest";
import {
  emptySlotRule,
  generateSlotPreview,
  slotRulesFromColumn,
  slotRulesIfChanged,
  toSlotRuleRows,
  validateSlotRules,
  type DraftSlotRule,
} from "./slotRules";

function rule(overrides: Partial<DraftSlotRule> = {}): DraftSlotRule {
  return {
    weekdays: [1, 2, 3, 4, 5, 6],
    startTime: "10:00",
    endTime: "21:00",
    slotDurationMinutes: "60",
    capacity: "4",
    ...overrides,
  };
}

describe("validateSlotRules", () => {
  it("un tableau vide est valide — les créneaux restent optionnels", () => {
    expect(validateSlotRules([])).toBeNull();
  });

  it("une règle entièrement remplie est valide", () => {
    expect(validateSlotRules([rule()])).toBeNull();
  });

  it("aucun jour de la semaine coché → erreur", () => {
    expect(validateSlotRules([rule({ weekdays: [] })])).toMatch(/día de la semana/);
  });

  it("heure de fin avant ou égale à l'heure de début → erreur", () => {
    expect(validateSlotRules([rule({ startTime: "10:00", endTime: "10:00" })])).toMatch(/fin/);
    expect(validateSlotRules([rule({ startTime: "21:00", endTime: "10:00" })])).toMatch(/fin/);
  });

  it("durée du créneau non entière ou nulle → erreur", () => {
    expect(validateSlotRules([rule({ slotDurationMinutes: "0" })])).toMatch(/duración/);
    expect(validateSlotRules([rule({ slotDurationMinutes: "abc" })])).toMatch(/duración/);
  });

  it("capacité non entière ou nulle → erreur", () => {
    expect(validateSlotRules([rule({ capacity: "0" })])).toMatch(/capacidad/);
  });

  it("deux règles qui partagent un jour et se chevauchent en horaire → erreur", () => {
    const a = rule({ weekdays: [1, 2], startTime: "09:00", endTime: "12:00" });
    const b = rule({ weekdays: [2, 3], startTime: "11:00", endTime: "15:00" });
    expect(validateSlotRules([a, b])).toMatch(/superponerse/);
  });

  it("deux règles qui se touchent exactement (fin = début) sur un jour commun ne se chevauchent pas", () => {
    const a = rule({ weekdays: [1], startTime: "09:00", endTime: "12:00" });
    const b = rule({ weekdays: [1], startTime: "12:00", endTime: "15:00" });
    expect(validateSlotRules([a, b])).toBeNull();
  });

  it("deux règles qui se chevauchent en horaire mais sur des jours disjoints sont valides", () => {
    const a = rule({ weekdays: [1], startTime: "09:00", endTime: "12:00" });
    const b = rule({ weekdays: [2], startTime: "09:00", endTime: "12:00" });
    expect(validateSlotRules([a, b])).toBeNull();
  });
});

describe("generateSlotPreview", () => {
  it("cas jetski littéral : 10:00-21:00, créneaux de 60 min → 11 créneaux", () => {
    const slots = generateSlotPreview(rule());
    expect(slots).toHaveLength(11);
    expect(slots[0]).toBe("10:00–11:00");
    expect(slots[slots.length - 1]).toBe("20:00–21:00");
  });

  it("plage non multiple de la durée → le reliquat est tronqué, pas une erreur", () => {
    const slots = generateSlotPreview(rule({ startTime: "10:00", endTime: "10:50", slotDurationMinutes: "60" }));
    expect(slots).toEqual([]);
  });

  it("champs manquants ou invalides → tableau vide", () => {
    expect(generateSlotPreview(rule({ startTime: "" }))).toEqual([]);
    expect(generateSlotPreview(rule({ slotDurationMinutes: "0" }))).toEqual([]);
    expect(generateSlotPreview(rule({ startTime: "21:00", endTime: "10:00" }))).toEqual([]);
  });
});

describe("emptySlotRule / toSlotRuleRows", () => {
  it("emptySlotRule ne coche aucun jour et laisse les champs vides", () => {
    expect(emptySlotRule()).toEqual({
      weekdays: [],
      startTime: "",
      endTime: "",
      slotDurationMinutes: "",
      capacity: "",
    });
  });

  it("toSlotRuleRows convertit vers les types de colonne réels et trie les jours", () => {
    expect(toSlotRuleRows([rule({ weekdays: [6, 1, 3] })])).toEqual([
      {
        weekdays: [1, 3, 6],
        start_time: "10:00",
        end_time: "21:00",
        slot_duration_minutes: 60,
        capacity: 4,
      },
    ]);
  });
});

// Horaires d'une proposition d'ÉDITION (migration 20261015011812) : la clé n'entre que si les
// horaires ont changé — présente, elle REMPLACE tous les horaires à l'approbation.
describe("slotRulesIfChanged", () => {
  const EN_BASE = [{ weekdays: [3, 1], start_time: "08:00:00", end_time: "10:00:00", slot_duration_minutes: 60, capacity: 6 }];

  it("horaires inchangés (secondes de la base comprises) : rien n'est envoyé", () => {
    expect(slotRulesIfChanged(EN_BASE, slotRulesFromColumn(EN_BASE))).toEqual({});
  });

  it("une capacité changée : tous les horaires partent, sous leur forme de colonne", () => {
    const brouillon = slotRulesFromColumn(EN_BASE).map((rule) => ({ ...rule, capacity: "8" }));
    expect(slotRulesIfChanged(EN_BASE, brouillon)).toEqual({
      slot_rules: [{ weekdays: [1, 3], start_time: "08:00", end_time: "10:00", slot_duration_minutes: 60, capacity: 8 }],
    });
  });

  it("tous retirés : un tableau vide part — c'est une demande de les supprimer", () => {
    expect(slotRulesIfChanged(EN_BASE, [])).toEqual({ slot_rules: [] });
  });

  it("aucun horaire en place ni proposé : rien n'est envoyé", () => {
    expect(slotRulesIfChanged([], [])).toEqual({});
  });
});
