import { describe, expect, it } from "vitest";
import { LEGACY_ORIGIN, legacyRedirects } from "./legacyRedirects";

// Garde la table contre une suppression ou un passage en 301. Le comportement réel (ordre de
// correspondance, query transmise) se prouve contre un serveur servi — journal du 2026-10-08.
describe("legacyRedirects", () => {
  const vers = (source: string, avecPromo: boolean) =>
    legacyRedirects.find((r) => r.source === source && Boolean(r.has) === avecPromo)?.destination;

  it("un QR /guatape ou /reservar avec ?promo= mène à la route d'attribution, la promo d'abord", () => {
    for (const source of ["/guatape", "/reservar"]) {
      expect(vers(source, true)).toBe("/es/r/:promo");
      expect(vers(source, false)).toBe("/es");
      const indices = legacyRedirects.flatMap((r, i) => (r.source === source ? [i] : []));
      expect(legacyRedirects[indices[0]].has).toBeDefined();
    }
  });

  it("le portail socio et les liens d'e-mail du legacy restent sur l'app legacy", () => {
    for (const source of ["/partner/:path*", "/register", "/reset", "/admin", "/api/comprobante/:path*"]) {
      expect(vers(source, false)).toBe(`${LEGACY_ORIGIN}${source}`);
    }
  });

  it("toutes temporaires : elles changeront à la reprise des données", () => {
    expect(legacyRedirects.every((r) => r.permanent === false)).toBe(true);
  });
});
