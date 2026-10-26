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
});

// Migration 20261025120000 : mêmes bornes que buildProductCreationPayload — NULL explicite là où le
// type n'en a plus, pour effacer une valeur d'avant la migration plutôt que la renvoyer à la base.
describe("buildProductEditPayload — bornes par réservation", () => {
  const bornes = (type: "activity" | "lodging" | "transport") => {
    const payload = buildProductEditPayload(type, NAME, DESCRIPTION, buildFields(FIXTURE_INIT[type]));
    return [payload.min_qty, payload.max_qty];
  };

  it("activité : le minimum seul", () => expect(bornes("activity")).toEqual([1, null]));
  it("logement : aucune borne", () => expect(bornes("lodging")).toEqual([null, null]));
  it("transport : les deux", () => expect(bornes("transport")).toEqual([1, 7]));
});
