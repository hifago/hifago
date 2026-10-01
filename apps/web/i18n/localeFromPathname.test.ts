import { describe, expect, it } from "vitest";
import { localeFromPathname } from "./localeFromPathname";

// `global-error.tsx` est rendu HORS du routage localisé (il remplace le layout `[locale]`) : la
// langue de l'écran d'erreur ne peut venir que du chemin. Une locale inconnue retombe sur la locale
// par défaut — même règle que `[locale]/layout.tsx` et `i18n/request.ts`.
describe("localeFromPathname", () => {
  it.each([
    ["/en/productos/kayak", "en"],
    ["/en", "en"],
    ["/es/mi-viaje", "es"],
    ["/pt/productos/x", "es"],
    ["/", "es"],
    ["", "es"],
    ["/EN/x", "es"],
  ])("%j → %s", (chemin, attendue) => {
    expect(localeFromPathname(chemin)).toBe(attendue);
  });
});
