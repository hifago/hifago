import { describe, expect, it } from "vitest";
import { buildProductCreationPayload } from "./productCreationPayload";
import { buildFields, FIXTURE_INIT } from "./productPayloadFixtures";

const NAME = { es: "Nombre de prueba", en: "Test name" };
const DESCRIPTION = { es: "Descripción", en: "Description" };

// Un describe par ProductType : pour chaque type, les clés que le formulaire montre pour ce type
// doivent être présentes, et les clés propres à un AUTRE type doivent être absentes — c'est
// exactement ce genre d'omission/débordement qui a déjà fait diverger le payload de création et le
// payload d'édition (cf. productEditPayload.ts, lobby_category_id/lobby_product_id).
describe("buildProductCreationPayload", () => {
  it("toujours présent quel que soit le type : name, description, photos", () => {
    const payload = buildProductCreationPayload("activity", NAME, DESCRIPTION, buildFields(FIXTURE_INIT.activity));
    expect(payload).toHaveProperty("name");
    expect(payload).toHaveProperty("description");
    expect(payload).toHaveProperty("photos");
  });

  it("activity : lieu générique, tags, prix, capacité par défaut, lien Lobby produit, créneaux — jamais logement/camp/evento/transport", () => {
    const payload = buildProductCreationPayload("activity", NAME, DESCRIPTION, buildFields(FIXTURE_INIT.activity));
    for (const key of [
      "address", "lat", "lon", "tag_ids", "price_cop", "price_tiers", "min_qty", "max_qty",
      "lobby_product_id", "default_capacity", "slot_rules", "external_booking_url", "price_label",
    ]) {
      expect(payload).toHaveProperty(key);
    }
    for (const key of [
      "check_in_time", "check_out_time", "capacity", "unit_count", "lodging_kind", "unit",
      "stay_rates", "lobby_category_id", "duration_days", "group_discount_threshold_qty",
      "group_discount_pct", "program", "online_bookable", "occurrence_type",
      "transport_contact_phone",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("evento : réservabilité en ligne + récurrence, jamais lieu/lobby/créneaux/logement/camp", () => {
    const payload = buildProductCreationPayload("evento", NAME, DESCRIPTION, buildFields(FIXTURE_INIT.evento));
    for (const key of [
      "tag_ids", "online_bookable", "evento_capacity_mode", "is_free", "evento_payment_mode",
      "evento_occupies_resource", "default_capacity", "price_label", "price_cop", "occurrence_type",
      "occurrence_date", "recurrence_frequency_days", "recurrence_end_date", "recurrence_end_count",
      "start_time", "duration_minutes", "external_booking_url",
    ]) {
      expect(payload).toHaveProperty(key);
    }
    for (const key of [
      "address", "lat", "lon", "min_qty", "max_qty", "price_tiers", "check_in_time", "check_out_time",
      "capacity", "unit_count", "lodging_kind", "unit", "stay_rates", "lobby_category_id",
      "lobby_product_id", "slot_rules", "transport_contact_phone", "duration_days",
      "group_discount_pct", "program",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("camp : programme + remise de groupe + durée, jamais lieu/lobby/créneaux/logement/evento", () => {
    const payload = buildProductCreationPayload("camp", NAME, DESCRIPTION, buildFields(FIXTURE_INIT.camp));
    for (const key of [
      "tag_ids", "price_cop", "duration_days", "group_discount_threshold_qty", "group_discount_pct",
      "program", "default_capacity", "external_booking_url", "price_label",
    ]) {
      expect(payload).toHaveProperty(key);
    }
    for (const key of [
      "address", "lat", "lon", "price_tiers", "min_qty", "max_qty", "check_in_time", "check_out_time",
      "capacity", "unit_count", "lodging_kind", "unit", "stay_rates", "lobby_category_id",
      "lobby_product_id", "slot_rules", "transport_contact_phone", "online_bookable", "occurrence_type",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("lodging : lieu, tarifs de séjour, lien Lobby catégorie, jamais créneaux/camp/evento/transport", () => {
    const payload = buildProductCreationPayload("lodging", NAME, DESCRIPTION, buildFields(FIXTURE_INIT.lodging));
    for (const key of [
      "address", "lat", "lon", "tag_ids", "price_cop", "price_tiers", "min_qty", "max_qty",
      "check_in_time", "check_out_time", "capacity", "unit_count", "lodging_kind", "unit",
      "stay_rates", "lobby_category_id", "default_capacity", "external_booking_url", "price_label",
      "amenity_ids",
    ]) {
      expect(payload).toHaveProperty(key);
    }
    expect(payload.amenity_ids).toEqual(["amenity-wifi"]);
    for (const key of [
      "lobby_product_id", "slot_rules", "transport_contact_phone", "duration_days",
      "group_discount_pct", "program", "online_bookable", "occurrence_type",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("transport : infos de départ/arrivée dédiées, lien Lobby produit, jamais lieu générique/logement/camp/evento/créneaux/capacité par défaut", () => {
    const payload = buildProductCreationPayload("transport", NAME, DESCRIPTION, buildFields(FIXTURE_INIT.transport));
    for (const key of [
      "tag_ids", "price_cop", "price_tiers", "min_qty", "max_qty", "lobby_product_id",
      "transport_contact_phone", "transport_first_departure_time", "transport_last_departure_time",
      "transport_seats_per_departure", "transport_departure_address", "transport_departure_lat",
      "transport_departure_lon", "transport_arrival_address", "transport_arrival_lat",
      "transport_arrival_lon", "external_booking_url", "price_label",
    ]) {
      expect(payload).toHaveProperty(key);
    }
    for (const key of [
      "address", "lat", "lon", "check_in_time", "check_out_time", "capacity", "unit_count",
      "lodging_kind", "unit", "stay_rates", "lobby_category_id", "default_capacity", "slot_rules",
      "duration_days", "group_discount_pct", "program", "online_bookable", "occurrence_type",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });
});

// Migration 20261025120000 (décision Jérôme du 2026-10-25) : la base refuse max_qty sur une activité
// ou un logement, et min_qty sur un logement. Les fixtures en portent (comme un état chargé d'avant
// la migration, ou saisi sous un autre type avant de basculer) : le payload envoie NULL.
describe("buildProductCreationPayload — bornes par réservation", () => {
  const bornes = (type: "activity" | "lodging" | "transport") => {
    const payload = buildProductCreationPayload(type, NAME, DESCRIPTION, buildFields(FIXTURE_INIT[type]));
    return [payload.min_qty, payload.max_qty];
  };

  it("activité : le minimum seul", () => expect(bornes("activity")).toEqual([1, null]));
  it("logement : aucune borne", () => expect(bornes("lodging")).toEqual([null, null]));
  it("transport : les deux", () => expect(bornes("transport")).toEqual([1, 7]));
});
