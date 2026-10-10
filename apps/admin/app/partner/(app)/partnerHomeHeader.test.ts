import { describe, expect, it } from "vitest";
import { partnerHomeHeader, type PartnerHomeCapability } from "./partnerHomeHeader";

// Le prestataire qui vient de s'inscrire (capacité operator active, sans établissement) doit voir
// « crée ton établissement », jamais « Prestador activo / Mi establecimiento » vers un
// établissement qui n'existe pas.

const op = (status: string, establishment_id: string | null = null): PartnerHomeCapability => ({
  role: "operator",
  status,
  establishment_id,
});
const ref = (status: string): PartnerHomeCapability => ({ role: "referrer", status, establishment_id: null });

describe("partnerHomeHeader", () => {
  it.each<[string, PartnerHomeCapability[], string]>([
    ["prestataire inscrit, sans établissement (actif par défaut)", [op("active")], "first-establishment"],
    ["prestataire et référent, sans établissement", [op("active"), ref("active")], "first-establishment"],
    ["prestataire seul, actif avec établissement", [op("active", "e-1")], "provider-banner"],
    ["mixte : prestataire avec établissement + référent", [op("active", "e-1"), ref("active")], "provider-banner"],
    ["avec établissement, plus une capacité operator encore vide", [op("active", "e-1"), op("active")], "provider-banner"],
    ["une capacité operator vide AVANT celle qui a un établissement", [op("active"), op("active", "e-1")], "provider-banner"],
    ["référent seul, actif", [ref("active")], "referrer-banner"],
    ["référent seul, suspendu", [ref("suspended")], "roles-card"],
    ["mixte avec établissement, référent suspendu", [op("active", "e-1"), ref("suspended")], "roles-card"],
    ["prestataire suspendu, sans établissement", [op("suspended")], "roles-card"],
    ["aucun rôle", [], "roles-card"],
    // Un rôle que cet écran ne connaît pas n'est jamais présenté comme référent.
    ["rôle inconnu, actif, sans operator", [{ role: "inconnu", status: "active", establishment_id: null }], "roles-card"],
  ])("%s → %s", (_cas, rows, attendu) => {
    expect(partnerHomeHeader(rows)).toBe(attendu);
  });
});
