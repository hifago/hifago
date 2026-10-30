// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkMfaGuard } from "./mfaGuard";

// Le garde ne décide QUE de l'envoi vers /mfa/verify. Il ne renvoie jamais vers l'enrôlement : le 2FA
// est un choix (spec 07 §10), et un compte qui n'a rien activé — ou a abandonné un enrôlement — ne
// doit jamais être arrêté.
function clientAvec(aal: { currentLevel: string; nextLevel: string } | null) {
  return {
    auth: {
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: aal, error: null }) },
    },
  } as unknown as SupabaseClient;
}

describe("checkMfaGuard", () => {
  it("envoie vers le défi quand un facteur vérifié existe mais la session est en AAL1", async () => {
    expect(await checkMfaGuard(clientAvec({ currentLevel: "aal1", nextLevel: "aal2" }))).toEqual({
      action: "verify",
    });
  });

  it("laisse passer un compte sans facteur vérifié (jamais d'enrôlement forcé)", async () => {
    expect(await checkMfaGuard(clientAvec({ currentLevel: "aal1", nextLevel: "aal1" }))).toEqual({
      action: "none",
    });
  });

  it("laisse passer une session déjà en AAL2", async () => {
    expect(await checkMfaGuard(clientAvec({ currentLevel: "aal2", nextLevel: "aal2" }))).toEqual({
      action: "none",
    });
  });

  it("laisse passer quand le niveau n'est pas lisible (pas de session)", async () => {
    expect(await checkMfaGuard(clientAvec(null))).toEqual({ action: "none" });
  });
});
