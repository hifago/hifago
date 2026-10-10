import { describe, expect, it } from "vitest";
import { delayBeforeNextCall } from "./rateLimitPacing";

const headers = (values: Record<string, string>) => new Headers(values);

describe("delayBeforeNextCall", () => {
  it.each([
    ["aucun en-tête de débit", {}],
    ["des requêtes restent dans la fenêtre", { "ratelimit-remaining": "3", "ratelimit-reset": "1" }],
    ["fenêtre épuisée mais remise à zéro inconnue", { "ratelimit-remaining": "0" }],
    ["en-têtes illisibles", { "ratelimit-remaining": "beaucoup", "ratelimit-reset": "bientôt" }],
    ["valeurs négatives", { "ratelimit-remaining": "-1", "ratelimit-reset": "-5" }],
  ])("%s : l'espacement minimal seul", (_cas, values) => {
    expect(delayBeforeNextCall(headers(values), 250, 2_000)).toBe(250);
  });

  it("fenêtre épuisée : attendre sa remise à zéro (secondes → ms, arrondi au-dessus)", () => {
    expect(delayBeforeNextCall(headers({ "ratelimit-remaining": "0", "ratelimit-reset": "1" }), 250, 2_000)).toBe(1_000);
    expect(delayBeforeNextCall(headers({ "ratelimit-remaining": "0", "ratelimit-reset": "0.4005" }), 250, 2_000)).toBe(401);
  });

  it("une remise à zéro plus courte que l'espacement minimal ne le raccourcit jamais", () => {
    expect(delayBeforeNextCall(headers({ "ratelimit-remaining": "0", "ratelimit-reset": "0.1" }), 250, 2_000)).toBe(250);
  });

  it("au-delà de l'attente maximale : null, le reste du lot attend le passage suivant", () => {
    expect(delayBeforeNextCall(headers({ "ratelimit-remaining": "0", "ratelimit-reset": "5" }), 250, 2_000)).toBeNull();
    expect(delayBeforeNextCall(headers({ "ratelimit-remaining": "0", "ratelimit-reset": "2" }), 250, 2_000)).toBe(2_000);
  });
});
