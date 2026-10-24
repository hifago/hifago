import { describe, expect, it } from "vitest";
import { cuposPerUnit, pmsUnitsToCupos } from "./lodgingCupos";

// Le vocabulaire vient du garde-fou `capacity_exceeds_physical` (migration 20260827250000). Depuis
// le 2026-10-23, un produit PMS-backed passe par pmsUnitsToCupos (facteur 1) et plus par
// cuposPerUnit — cf. l'en-tête du module. Le vrai garde-fou
// contre l'oubli est l'exhaustivité du `switch`, vérifiée par le typecheck (témoin rejoué le
// 2026-08-28 : ajouter un 4e lodging_kind casse la compilation).
describe("cuposPerUnit", () => {
  it("vend un dortoir au lit : une unité offre autant de cupos que sa capacité", () => {
    expect(cuposPerUnit("dorm", 6)).toBe(6);
  });

  it("vend une chambre privée à l'unité, quelle que soit sa capacité", () => {
    expect(cuposPerUnit("private", 4)).toBe(1);
  });

  it("vend une maison entière à l'unité — on ne loue pas une maison à la personne", () => {
    expect(cuposPerUnit("whole_house", 8)).toBe(1);
  });

  it("suit le dortoir (borne haute) quand le type de couchage n'est pas renseigné", () => {
    // lodging_kind est facultatif et NULL sur la plupart des logements existants ; le garde-fou SQL
    // retient la borne la plus permissive dans ce cas, l'écran doit retenir la même.
    expect(cuposPerUnit(null, 2)).toBe(2);
  });

  it("retombe à l'unité pour un type de couchage inconnu, comme la branche else du SQL", () => {
    // Inatteignable via asLodgingKind (qui normalise à null), mais la valeur peut arriver d'un
    // payload jsonb non normalisé. Le repli est 1, celui du `else` SQL — la première version
    // retombait sur `capacity`, soit le défaut OPPOSÉ.
    expect(cuposPerUnit("cabana" as never, 4)).toBe(1);
  });

  it("retombe sur 1 cupo par unité quand la capacité est absente ou absurde", () => {
    // capacity est nullable, et une valeur <= 0 ferait disparaître toute disponibilité par
    // multiplication — jamais un calendrier vide sur une donnée manquante.
    expect(cuposPerUnit("dorm", null)).toBe(1);
    expect(cuposPerUnit(null, 0)).toBe(1);
    expect(cuposPerUnit("dorm", -3)).toBe(1);
  });
});

describe("pmsUnitsToCupos", () => {
  it("VIDPOVO (capacity 8, 8 lits libres chez Lobby) vaut 8 cupos, pas 64", () => {
    expect(pmsUnitsToCupos(8)).toBe(8);
  });

  it("GLAMPING (private, 3 tentes libres) vaut 3", () => {
    expect(pmsUnitsToCupos(3)).toBe(3);
  });

  it("jamais de disponibilité fabriquée sur une valeur invalide", () => {
    expect(pmsUnitsToCupos(-1)).toBe(0);
    expect(pmsUnitsToCupos(Number.NaN)).toBe(0);
  });
});
