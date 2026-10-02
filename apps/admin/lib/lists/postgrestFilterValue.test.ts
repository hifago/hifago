import { describe, expect, it } from "vitest";
import { quotePostgrestValue } from "./postgrestFilterValue";

// Une valeur insérée dans un filtre `.or(...)` de PostgREST fait partie de sa GRAMMAIRE : une
// virgule, une parenthèse, un point ou deux-points y changent le sens du filtre ou le rendent
// invalide. Entre guillemets doubles, avec `"` et `\` échappés, elle redevient une simple valeur
// (vérifié contre le PostgREST local le 2026-10-02 : mêmes résultats sur une recherche ordinaire,
// plus d'erreur ni de filtre altéré sur `a,b` ou `a)`).

describe("quotePostgrestValue", () => {
  it("met la valeur entre guillemets doubles", () => {
    expect(quotePostgrestValue("%natur%")).toBe('"%natur%"');
  });

  it("garde intacts les caractères de la grammaire, protégés par les guillemets", () => {
    expect(quotePostgrestValue("%a,b).:(%")).toBe('"%a,b).:(%"');
  });

  it("échappe les guillemets et les barres obliques inverses", () => {
    expect(quotePostgrestValue('x"y')).toBe('"x\\"y"');
    expect(quotePostgrestValue("x\\y")).toBe('"x\\\\y"');
  });
});
