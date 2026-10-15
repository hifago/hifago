import { describe, expect, it } from "vitest";
import { describeStay, stayFromColumns, stayIfChanged, stayIfFilled, stayPayload } from "./stayFields";

// Les trois clés du séjour voyagent ENSEMBLE ou pas du tout : update_establishment_stay_details les
// remplace d'un bloc, et establishment_proposal_details refuse un séjour partiel (stay_incomplete,
// migration 20261015004421).
const EN_PLACE = stayFromColumns({ check_in_time: "15:00:00", check_out_time: "11:00:00", mode: "rooms" });

describe("stayFields", () => {
  it("lit les colonnes time au format attendu par <Input type=\"time\">", () => {
    expect(EN_PLACE).toEqual({ checkIn: "15:00", checkOut: "11:00", mode: "rooms" });
    expect(stayFromColumns({ check_in_time: null, check_out_time: null, mode: null })).toEqual({
      checkIn: "",
      checkOut: "",
      mode: "",
    });
  });

  it("édition : rien n'est envoyé tant que le séjour n'a pas changé", () => {
    expect(stayIfChanged(EN_PLACE, { ...EN_PLACE })).toEqual({});
  });

  it("édition : un seul champ changé envoie les TROIS clés", () => {
    expect(stayIfChanged(EN_PLACE, { ...EN_PLACE, checkIn: "14:00" })).toEqual({
      check_in_time: "14:00",
      check_out_time: "11:00",
      mode: "rooms",
    });
  });

  it("un champ vidé part à null — l'effacer est une demande réelle", () => {
    expect(stayPayload({ checkIn: "", checkOut: "10:00", mode: "" })).toEqual({
      check_in_time: null,
      check_out_time: "10:00",
      mode: null,
    });
  });

  it("création : rien tant qu'aucun champ n'est rempli, les trois clés sinon", () => {
    expect(stayIfFilled({ checkIn: "", checkOut: "", mode: "" })).toEqual({});
    expect(stayIfFilled({ checkIn: "", checkOut: "", mode: "whole_house" })).toEqual({
      check_in_time: null,
      check_out_time: null,
      mode: "whole_house",
    });
  });

  it("résumé lisible, colonnes comme payload", () => {
    expect(describeStay({ check_in_time: "15:00:00", check_out_time: null, mode: "whole_house" })).toBe(
      "check-in 15:00 · check-out — · Alojamiento completo",
    );
    expect(describeStay({})).toBe("check-in — · check-out — · sin especificar");
  });
});
