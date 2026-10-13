import { describe, expect, it } from "vitest";
import { buildProductCreationPayload } from "./productCreationPayload";
import { buildProductEditPayload } from "./productEditPayload";
import { buildFields, FIXTURE_INIT, ALL_PRODUCT_TYPES } from "./productPayloadFixtures";
import type { ProductType } from "./productTypeGating";

const NAME = { es: "Nombre de prueba", en: "Test name" };
const DESCRIPTION = { es: "Descripción", en: "Description" };

// Le test de non-régression du chantier de dédoublonnage payload (2026-09-17) : pour chaque type,
// compare l'ensemble des clés des deux payloads. Toute clé qui diverge SANS figurer dans
// l'allowlist ci-dessous fait échouer ce test — c'est exactement ce qui aurait attrapé
// `lobby_category_id`/`lobby_product_id`/le bloc evento réservable avant qu'on ne les trouve à la
// main en écrivant ce chantier. L'allowlist elle-même est de la documentation vivante des écarts
// VOLONTAIRES : un ajout doit toujours pointer vers la raison (commentaire du fichier concerné ou
// docs/dette-technique.md), jamais être élargi pour simplement faire passer le test.
//
// Deux allowlists distinctes par type, parce que la divergence a un SENS : une clé "creation-only"
// est déléguée à la création (photos/tag_ids/slot_rules) ou un gap connu jamais rouvert en édition
// (occurrence_*/duration_days) ; une clé "edit-only" existe seulement côté édition.
const CREATION_ONLY: Record<ProductType, string[]> = {
  activity: ["photos", "tag_ids", "slot_rules"],
  // external_booking_url + les 7 champs d'occurrence : dette-technique.md — "Un evento reste le
  // seul type dont l'URL de vitrine n'est pas modifiable" / champs "création seulement", jamais
  // réécrits par aucun des deux update() historiques (admin-direct ni proposition).
  evento: [
    "photos", "tag_ids", "external_booking_url", "occurrence_type", "occurrence_date",
    "recurrence_frequency_days", "recurrence_end_date", "recurrence_end_count", "start_time",
    "duration_minutes",
  ],
  // duration_days : productCreationPayload.ts, "gap préexistant, jamais éditable aujourd'hui".
  camp: ["photos", "tag_ids", "duration_days"],
  // amenity_ids : comme tag_ids, ajouté à une proposition d'édition par le formulaire lui-même et
  // seulement si la sélection change (lib/amenities/proposedAmenities.ts).
  lodging: ["photos", "tag_ids", "amenity_ids"],
  transport: ["photos", "tag_ids"],
};

// price_tiers : productEditPayload.ts le pose TOUJOURS (même `null` quand le type ne l'utilise
// pas), productCreationPayload.ts le gate derrière `hasPriceQtyFields` (absent pour camp/evento).
// Résultat identique en pratique (aucune valeur pour ces deux types) — asymétrie préexistante,
// pas introduite par ce chantier, PAS l'un des bugs ciblés (lobby_*/evento réservable).
const EDIT_ONLY: Record<ProductType, string[]> = {
  activity: [],
  evento: ["price_tiers"],
  camp: ["price_tiers"],
  lodging: [],
  transport: [],
};

function onlyInA(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  return Object.keys(a).filter((key) => !(key in b)).sort();
}

describe("payloadParity — buildProductCreationPayload vs buildProductEditPayload", () => {
  for (const type of ALL_PRODUCT_TYPES) {
    it(`${type} : les clés qui divergent sont exactement celles documentées`, () => {
      const fields = buildFields(FIXTURE_INIT[type]);
      const creationPayload = buildProductCreationPayload(type, NAME, DESCRIPTION, fields);
      const editPayload = buildProductEditPayload(type, NAME, DESCRIPTION, fields);

      expect(onlyInA(creationPayload, editPayload)).toEqual([...CREATION_ONLY[type]].sort());
      expect(onlyInA(editPayload, creationPayload)).toEqual([...EDIT_ONLY[type]].sort());
    });
  }
});
