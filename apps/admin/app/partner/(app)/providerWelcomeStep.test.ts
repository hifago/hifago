import { describe, expect, it } from "vitest";
import { providerWelcomeStep, type ProviderWelcomeStep } from "./providerWelcomeStep";

// Chaque étape s'efface dès que son action est faite ; un établissement en revue suffit à passer
// à l'étape « service » (jamais « Aún no tienes ningún establecimiento » après sa création).

type Etat = Parameters<typeof providerWelcomeStep>[0];
const rien: Etat = { hasEstablishment: false, hasPendingEstablishment: false, hasService: false, hasPayoutAccount: false };

describe("providerWelcomeStep", () => {
  it.each<[string, Partial<Etat>, ProviderWelcomeStep | null]>([
    ["première connexion : rien", {}, "establishment"],
    ["compte Mercado Pago déjà saisi, toujours sans établissement", { hasPayoutAccount: true }, "establishment"],
    ["établissement en revue, aucun service", { hasPendingEstablishment: true }, "service"],
    ["établissement approuvé, aucun service", { hasEstablishment: true }, "service"],
    ["établissement en revue, service proposé", { hasPendingEstablishment: true, hasService: true }, "referrer"],
    ["établissement approuvé, service publié", { hasEstablishment: true, hasService: true }, "referrer"],
    [
      "établissement en revue, service proposé, compte saisi",
      { hasPendingEstablishment: true, hasService: true, hasPayoutAccount: true },
      null,
    ],
    ["tout est fait", { hasEstablishment: true, hasService: true, hasPayoutAccount: true }, null],
  ])("%s → %s", (_cas, etat, attendu) => {
    expect(providerWelcomeStep({ ...rien, ...etat })).toBe(attendu);
  });
});
