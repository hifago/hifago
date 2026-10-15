import { describe, expect, it } from "vitest";
import { buildProductEditPayload } from "./productEditPayload";
import { buildFields, FIXTURE_INIT } from "./productPayloadFixtures";
import { payloadToFieldsInit } from "./useProductTypeFieldsState";

const NAME = { es: "Nombre de prueba", en: "Test name" };
const DESCRIPTION = { es: "Descripción", en: "Description" };

// Miroir de productCreationPayload.test.ts, MAIS jamais tags/photos/slot_rules (délégués à des
// blocs séparés à sauvegarde immédiate, jamais réécrits par ce payload — cf. l'en-tête du fichier
// testé) et price_tiers/price_cop toujours présents (jamais gatés par le type, contrairement à la
// création). Écrire ce test a trouvé un 3e bug réel, en plus des deux déjà identifiés
// (lobby_category_id/lobby_product_id) : ce fichier ne portait ENTIÈREMENT AUCUN champ evento
// réservable en ligne — corrigé dans le même chantier, cf. productEditPayload.ts.
describe("buildProductEditPayload", () => {
  it("toujours présent quel que soit le type : name, description, price_cop, price_tiers", () => {
    const payload = buildProductEditPayload("activity", NAME, DESCRIPTION, buildFields(FIXTURE_INIT.activity));
    expect(payload).toHaveProperty("name");
    expect(payload).toHaveProperty("description");
    expect(payload).toHaveProperty("price_cop");
    expect(payload).toHaveProperty("price_tiers");
  });

  it("jamais de tags/photos/slot_rules, quel que soit le type — délégués à des blocs séparés", () => {
    for (const type of ["activity", "evento", "camp", "lodging", "transport"] as const) {
      const payload = buildProductEditPayload(type, NAME, DESCRIPTION, buildFields(FIXTURE_INIT[type]));
      expect(payload).not.toHaveProperty("tag_ids");
      expect(payload).not.toHaveProperty("photos");
      expect(payload).not.toHaveProperty("slot_rules");
    }
  });

  it("activity : lieu générique, prix/qty, capacité par défaut, lien Lobby produit — jamais logement/camp/evento/transport", () => {
    const payload = buildProductEditPayload("activity", NAME, DESCRIPTION, buildFields(FIXTURE_INIT.activity));
    for (const key of [
      "address", "lat", "lon", "price_cop", "price_tiers", "external_booking_url", "price_label",
      "min_qty", "max_qty", "lobby_product_id", "default_capacity",
    ]) {
      expect(payload).toHaveProperty(key);
    }
    for (const key of [
      "check_in_time", "check_out_time", "capacity", "unit_count", "lodging_kind", "unit",
      "stay_rates", "lobby_category_id", "group_discount_threshold_qty", "group_discount_pct",
      "program", "online_bookable", "evento_capacity_mode", "transport_contact_phone",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("evento : réservabilité en ligne réécrite (bug corrigé par ce chantier), jamais lieu/lobby/logement/camp", () => {
    const payload = buildProductEditPayload("evento", NAME, DESCRIPTION, buildFields(FIXTURE_INIT.evento));
    for (const key of [
      "price_cop", "price_tiers", "online_bookable", "evento_capacity_mode", "is_free",
      "evento_payment_mode", "evento_occupies_resource", "default_capacity", "price_label",
      "occurrence_type", "occurrence_date", "recurrence_frequency_days", "recurrence_end_date",
      "recurrence_end_count", "start_time", "duration_minutes",
    ]) {
      expect(payload).toHaveProperty(key);
    }
    // Un evento réservable en ligne (online_bookable=true dans la fixture) n'a jamais d'URL externe
    // ni de min/max qty — jamais posés par le bloc générique (isEvento ? {} : {...}) ni par
    // hasPriceQtyFields (qui exclut evento).
    for (const key of [
      "address", "lat", "lon", "external_booking_url", "min_qty", "max_qty", "check_in_time",
      "check_out_time", "capacity", "unit_count", "lodging_kind", "unit", "stay_rates",
      "lobby_category_id", "lobby_product_id", "transport_contact_phone",
      "group_discount_threshold_qty", "group_discount_pct", "program",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  // La panne du 2026-10-13 (« Exposición Mirarte ») : le formulaire d'édition du socio est hydraté
  // depuis la LIGNE `products`, puis reconstruit le payload. La date et l'heure en place doivent
  // en ressortir — elles n'y étaient pas, la proposition arrivait à la modération sans elles.
  it("evento : la date et l'heure de la fiche repartent dans le payload d'édition", () => {
    const fichaEnBase = {
      price_label: "Entrada libre",
      occurrence_type: "once",
      occurrence_date: "2026-10-15",
      start_time: "16:00:00",
      duration_minutes: 120,
      online_bookable: false,
    };
    const payload = buildProductEditPayload(
      "evento", NAME, DESCRIPTION, buildFields(payloadToFieldsInit(fichaEnBase)),
    );
    expect(payload).toMatchObject({
      occurrence_type: "once",
      occurrence_date: "2026-10-15",
      start_time: "16:00",
      duration_minutes: 120,
      recurrence_frequency_days: null,
      recurrence_end_date: null,
      recurrence_end_count: null,
      price_label: "Entrada libre",
    });
  });

  it("evento réservable en ligne : relu depuis la fiche, il ne repart pas en evento vitrine", () => {
    const fichaEnBase = {
      price_cop: 50000,
      default_capacity: 40,
      online_bookable: true,
      evento_capacity_mode: "metered",
      is_free: false,
      evento_payment_mode: "online",
      evento_occupies_resource: true,
      occurrence_type: "once",
      occurrence_date: "2026-12-01",
    };
    const payload = buildProductEditPayload(
      "evento", NAME, DESCRIPTION, buildFields(payloadToFieldsInit(fichaEnBase)),
    );
    expect(payload).toMatchObject({
      online_bookable: true,
      evento_capacity_mode: "metered",
      evento_payment_mode: "online",
      default_capacity: 40,
      price_cop: 50000,
      price_label: null,
    });
  });

  it("camp : programme + remise de groupe réécrits (parité avec la création), jamais lieu/lobby/logement/evento", () => {
    const payload = buildProductEditPayload("camp", NAME, DESCRIPTION, buildFields(FIXTURE_INIT.camp));
    for (const key of [
      "price_cop", "price_tiers", "external_booking_url", "price_label", "default_capacity",
      "group_discount_threshold_qty", "group_discount_pct", "program",
    ]) {
      expect(payload).toHaveProperty(key);
    }
    for (const key of [
      "address", "lat", "lon", "min_qty", "max_qty", "check_in_time", "check_out_time", "capacity",
      "unit_count", "lodging_kind", "unit", "stay_rates", "lobby_category_id", "lobby_product_id",
      "transport_contact_phone", "online_bookable", "evento_capacity_mode",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("lodging : lieu, tarifs de séjour, lien Lobby catégorie (bug corrigé par ce chantier) — jamais camp/evento/transport", () => {
    const payload = buildProductEditPayload("lodging", NAME, DESCRIPTION, buildFields(FIXTURE_INIT.lodging));
    for (const key of [
      "address", "lat", "lon", "price_cop", "price_tiers", "external_booking_url", "price_label",
      "min_qty", "max_qty", "check_in_time", "check_out_time", "capacity", "unit_count",
      "lodging_kind", "unit", "stay_rates", "lobby_category_id", "default_capacity",
    ]) {
      expect(payload).toHaveProperty(key);
    }
    for (const key of [
      "lobby_product_id", "transport_contact_phone", "group_discount_threshold_qty",
      "group_discount_pct", "program", "online_bookable", "evento_capacity_mode",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("transport : infos de départ/arrivée dédiées, lien Lobby produit — jamais lieu générique/logement/camp/evento/capacité par défaut", () => {
    const payload = buildProductEditPayload("transport", NAME, DESCRIPTION, buildFields(FIXTURE_INIT.transport));
    for (const key of [
      "price_cop", "price_tiers", "external_booking_url", "price_label", "min_qty", "max_qty",
      "lobby_product_id", "transport_contact_phone", "transport_first_departure_time",
      "transport_last_departure_time", "transport_seats_per_departure", "transport_departure_address",
      "transport_departure_lat", "transport_departure_lon", "transport_arrival_address",
      "transport_arrival_lat", "transport_arrival_lon",
    ]) {
      expect(payload).toHaveProperty(key);
    }
    for (const key of [
      "address", "lat", "lon", "check_in_time", "check_out_time", "capacity", "unit_count",
      "lodging_kind", "unit", "stay_rates", "lobby_category_id", "default_capacity",
      "group_discount_threshold_qty", "group_discount_pct", "program", "online_bookable",
      "evento_capacity_mode",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  // 2026-10-14 : les tests ci-dessus partent d'un état DÉJÀ hydraté (FIXTURE_INIT, camelCase), si
  // bien qu'ils n'ont jamais vu la vraie panne — l'hydratation elle-même. Les deux écrans d'édition
  // ne lisaient pas group_discount_*, ProductForm ne recopiait pas external_booking_url : le
  // formulaire s'ouvrait vide sur ces champs, et l'enregistrement écrivait null. Ces cas partent donc
  // d'une LIGNE `products` (snake_case), par le même chemin que les deux écrans.
  it("camp : la remise de groupe lue sur la fiche repart telle quelle", () => {
    const row = {
      type: "camp",
      price_cop: 300000,
      duration_days: 3,
      group_discount_threshold_qty: 16,
      group_discount_pct: 20,
    };
    const fields = buildFields(payloadToFieldsInit({ ...row, duration_days: null }));
    const payload = buildProductEditPayload("camp", NAME, DESCRIPTION, fields);
    expect(payload.group_discount_threshold_qty).toBe(16);
    expect(payload.group_discount_pct).toBe(20);
  });

  it("activity en vitrine : l'URL et le prix libre lus sur la fiche repartent tels quels", () => {
    const row = {
      type: "activity",
      price_cop: null,
      external_booking_url: "https://reservas.example.com/tour",
      price_label: "Desde 80.000 COP",
    };
    const fields = buildFields(payloadToFieldsInit(row));
    const payload = buildProductEditPayload("activity", NAME, DESCRIPTION, fields);
    expect(payload.external_booking_url).toBe("https://reservas.example.com/tour");
    expect(payload.price_label).toBe("Desde 80.000 COP");
  });
});
