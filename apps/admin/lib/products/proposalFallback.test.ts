import { describe, expect, it } from "vitest";
import { buildProductEditPayload } from "./productEditPayload";
import { buildFields } from "./productPayloadFixtures";
import { withCurrentValuesForAbsentKeys } from "./proposalFallback";
import { payloadToFieldsInit } from "./useProductTypeFieldsState";

const NAME = { es: "Nombre de prueba" };
const DESCRIPTION = { es: "Descripción" };

describe("withCurrentValuesForAbsentKeys", () => {
  it("une clé absente de la proposition prend la valeur de la fiche", () => {
    const merged = withCurrentValuesForAbsentKeys(
      { name: { es: "Solo el nombre" } },
      { occurrence_date: "2026-10-15", start_time: "16:00:00", default_capacity: 3 },
    );
    expect(merged).toMatchObject({
      occurrence_date: "2026-10-15",
      start_time: "16:00:00",
      default_capacity: 3,
    });
  });

  it("une clé présente à null reste null : c'est une demande explicite d'effacement", () => {
    const merged = withCurrentValuesForAbsentKeys(
      { start_time: null, default_capacity: null },
      { start_time: "16:00:00", default_capacity: 3 },
    );
    expect(merged).toEqual({ start_time: null, default_capacity: null });
  });

  it("la valeur proposée l'emporte sur celle de la fiche", () => {
    const merged = withCurrentValuesForAbsentKeys(
      { occurrence_date: "2026-11-02" },
      { occurrence_date: "2026-10-15" },
    );
    expect(merged.occurrence_date).toBe("2026-11-02");
  });

  it("ne recopie que les clés gardées — jamais l'identité ni la durée d'un camp", () => {
    const merged = withCurrentValuesForAbsentKeys({}, { id: "abc", type: "camp", duration_days: 5, program: [] });
    expect(merged).toEqual({ program: [] });
  });
});

// Le parcours réel de l'écran de modération : proposition + fiche → état du formulaire → payload
// approuvé. C'est ce payload-là que moderate_product_proposal écrit.
describe("modération d'une proposition d'édition — payload approuvé", () => {
  const eventoEnBase = {
    price_label: "Entrada libre",
    occurrence_type: "once",
    occurrence_date: "2026-10-15",
    start_time: "16:00:00",
    duration_minutes: 120,
    online_bookable: false,
  };

  function approvedPayload(type: "evento" | "lodging", proposed: object, current: object) {
    return buildProductEditPayload(
      type, NAME, DESCRIPTION,
      buildFields(payloadToFieldsInit(withCurrentValuesForAbsentKeys(proposed, current))),
    );
  }

  it("evento : une proposition sans date ne renvoie pas une date vide", () => {
    const payload = approvedPayload("evento", { name: NAME, price_label: "Gratis" }, eventoEnBase);
    expect(payload).toMatchObject({
      occurrence_date: "2026-10-15",
      start_time: "16:00",
      duration_minutes: 120,
      price_label: "Gratis",
    });
  });

  it("evento : la date et l'heure proposées par le partenaire sont celles du payload approuvé", () => {
    const payload = approvedPayload(
      "evento",
      { name: NAME, occurrence_type: "once", occurrence_date: "2026-11-02", start_time: "18:30", duration_minutes: null },
      eventoEnBase,
    );
    expect(payload).toMatchObject({
      occurrence_date: "2026-11-02",
      start_time: "18:30",
      duration_minutes: null,
    });
  });

  it("logement : une proposition sans cupo par défaut ne le renvoie pas à null", () => {
    const payload = approvedPayload("lodging", { name: NAME, price_cop: 80000 }, { default_capacity: 3 });
    expect(payload.default_capacity).toBe(3);
  });
});
