import { describe, expect, it } from "vitest";
import { PRODUCT_EDIT_COLUMNS } from "./productEditColumns";
import { buildProductEditPayload } from "./productEditPayload";
import { ALL_PRODUCT_TYPES, buildFields, FIXTURE_INIT } from "./productPayloadFixtures";

const NAME = { es: "Nombre de prueba", en: "Test name" };
const DESCRIPTION = { es: "Descripción", en: "Description" };

const LUES = new Set(PRODUCT_EDIT_COLUMNS.split(",").map((column) => column.trim()));

// La règle de productEditColumns.ts, exécutée : une colonne que l'édition réécrit sans que les
// écrans d'édition la relisent part à null à chaque enregistrement. Ce test aurait attrapé les
// quatre pertes de la même famille (price_label, occurrence d'un evento, external_booking_url,
// group_discount_*), chacune trouvée à la main, des semaines après.
describe("PRODUCT_EDIT_COLUMNS", () => {
  for (const type of ALL_PRODUCT_TYPES) {
    it(`${type} : toute colonne réécrite par l'édition est relue par les deux écrans`, () => {
      const payload = buildProductEditPayload(type, NAME, DESCRIPTION, buildFields(FIXTURE_INIT[type]));
      const nonLues = Object.keys(payload).filter((column) => !LUES.has(column));
      expect(nonLues).toEqual([]);
    });
  }
});
