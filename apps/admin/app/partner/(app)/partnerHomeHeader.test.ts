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
    ["prestataire actif avec établissement", [op("active", "e-1")], "active-banner"],
    ["avec établissement, plus une capacité operator encore vide", [op("active", "e-1"), op("active")], "active-banner"],
    ["une capacité operator vide AVANT celle qui a un établissement", [op("active"), op("active", "e-1")], "active-banner"],
    ["référent seul, actif", [ref("active")], "active-banner"],
    ["prestataire suspendu, sans établissement", [op("suspended")], "roles-card"],
    ["référent suspendu", [ref("suspended")], "roles-card"],
    ["aucun rôle", [], "roles-card"],
  ])("%s → %s", (_cas, rows, attendu) => {
    expect(partnerHomeHeader(rows)).toBe(attendu);
  });
});
