import { describe, expect, it, vi } from "vitest";
import { loadMessages } from "@/messages";
import { reserveNightsErrorKey } from "./CheckoutForm";

// `@/i18n/navigation` tire next-intl/navigation → next/navigation, irrésolu sous Vitest (même
// bouchon que BuscadorInicio.test.tsx). Seule la fonction pure est testée ici.
vi.mock("@/i18n/navigation", () => ({ Link: () => null, useRouter: () => ({ push: vi.fn() }) }));

// Correctif minimal (P4a, décision « 2i ») : chaque échec de /api/pms/reserve-nights affiche le
// message de son `reason` / `released`. Avant, seul `released === false` était lu : un 504 sans
// corps ou une erreur de base affichaient « fechas liberadas » alors que rien n'avait été relâché,
// et un délai dépassé chez Lobby était présenté comme une indisponibilité.
describe("reserveNightsErrorKey — un message juste pour chaque réponse de reserve-nights", () => {
  it.each([
    // [cas, corps de la réponse, clé attendue]
    ["504 / 500 de la plateforme, corps illisible", null, "pms_unconfirmed_pending"],
    ["erreur de base (db_error)", { reason: "db_error", released: false }, "pms_unconfirmed_pending"],
    ["commande introuvable", { reason: "order_not_found", released: false }, "pms_unconfirmed_pending"],
    ["claim déjà tenu (double soumission)", { reason: "pms_claim_in_progress", released: false }, "pms_claim_in_progress"],
    ["refus Lobby, commande défaite", { reason: "pms_refused", released: true }, "pms_refused"],
    ["refus Lobby, relâchement impossible", { reason: "pms_refused", released: false }, "pms_refused_pending"],
    ["issue inconnue chez Lobby, commande défaite", { reason: "pms_unreachable", released: true }, "pms_unreachable"],
    ["issue inconnue, relâchement impossible", { reason: "pms_unreachable", released: false }, "pms_unconfirmed_pending"],
    ["connecteur coupé, commande défaite", { reason: "pms_unavailable", released: true }, "pms_unavailable"],
    ["commande déjà défaite (order_not_active)", { reason: "order_not_active", released: true }, "pms_unreachable"],
    ["corps sans `released` (400 invalid_body)", { reason: "invalid_body" }, "pms_unconfirmed_pending"],
  ] as const)("%s → %s", (_cas, corps, attendu) => {
    expect(reserveNightsErrorKey(corps)).toBe(attendu);
  });

  it.each(["es", "en"] as const)("chaque clé possible existe dans les messages %s", async (locale) => {
    const messages = (await loadMessages(locale)) as { CheckoutPage: { errors: Record<string, string> } };
    for (const key of [
      "pms_refused",
      "pms_refused_pending",
      "pms_unavailable",
      "pms_unreachable",
      "pms_unconfirmed_pending",
      "pms_claim_in_progress",
    ]) {
      expect(messages.CheckoutPage.errors[key], key).toBeTruthy();
    }
  });
});
