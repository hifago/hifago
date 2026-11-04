import { describe, expect, it } from "vitest";
import {
  emptySlotRule,
  formatSlotRulesSummary,
  generateSlotPreview,
  proposedSlotRules,
  requiredSlotRulesError,
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
  it("un tableau vide est valide ici — l'exigence d'un horaire vit dans requiredSlotRulesError", () => {
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

// Migration 20261104120000 — horaires obligatoires à la création, proposables en édition.
describe("requiredSlotRulesError", () => {
  it("aucun horaire → erreur (une activité sans règle n'a aucun créneau réservable)", () => {
    expect(requiredSlotRulesError([])).toBe("Una actividad necesita al menos un horario.");
  });

  it("un horaire valide → null ; un horaire invalide → l'erreur de validateSlotRules", () => {
    expect(requiredSlotRulesError([rule()])).toBeNull();
    expect(requiredSlotRulesError([rule({ weekdays: [] })])).toBe(validateSlotRules([rule({ weekdays: [] })]));
  });
});

describe("slotRulesIfChanged", () => {
  it("horaires inchangés → aucune clé (l'approbation garderait sinon l'existant écrasé)", () => {
    expect(slotRulesIfChanged([rule()], [rule()])).toEqual({});
  });

  it("l'ordre des jours cochés ne compte pas comme un changement", () => {
    expect(slotRulesIfChanged([rule({ weekdays: [1, 3] })], [rule({ weekdays: [3, 1] })])).toEqual({});
  });

  it("une capacité changée → la clé part, avec TOUS les horaires", () => {
    const edited = [rule(), rule({ startTime: "06:00", endTime: "09:00", capacity: "2" })];
    expect(slotRulesIfChanged([rule()], edited)).toEqual({ slot_rules: toSlotRuleRows(edited) });
  });

  it("tous les horaires retirés → la clé part vide (refusée ensuite par la validation et la base)", () => {
    expect(slotRulesIfChanged([rule()], [])).toEqual({ slot_rules: [] });
  });
});

describe("proposedSlotRules", () => {
  it("null quand la proposition ne porte pas la clé, les brouillons sinon", () => {
    expect(proposedSlotRules({})).toBeNull();
    expect(
      proposedSlotRules({
        slot_rules: [{ weekdays: [2], start_time: "14:00:00", end_time: "17:00:00", slot_duration_minutes: 60, capacity: 6 }],
      }),
    ).toEqual([{ weekdays: [2], startTime: "14:00", endTime: "17:00", slotDurationMinutes: "60", capacity: "6" }]);
  });
});

describe("formatSlotRulesSummary", () => {
  it("résume chaque horaire, jours triés", () => {
    expect(formatSlotRulesSummary([rule({ weekdays: [3, 1] })])).toBe("Lun, Mié 10:00–21:00 (60 min, cupo 4)");
    expect(formatSlotRulesSummary([])).toBe("—");
  });
});
