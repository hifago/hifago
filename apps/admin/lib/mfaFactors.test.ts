// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  factorLabels,
  isCancelledCeremony,
  isSupportedFactorKind,
  purgeUnverifiedFactors,
  uniqueFactorName,
} from "./mfaFactors";

describe("factorLabels", () => {
  it("numérote par type, dans l'ordre reçu", () => {
    const labels = factorLabels([
      { id: "a", factor_type: "totp" },
      { id: "b", factor_type: "webauthn" },
      { id: "c", factor_type: "totp" },
    ]);
    expect(labels.get("a")).toBe("App de autenticación 1");
    expect(labels.get("b")).toBe("Llave de seguridad 1");
    expect(labels.get("c")).toBe("App de autenticación 2");
  });

  it("ne nomme pas un type que l'interface ne gère pas (téléphone)", () => {
    const labels = factorLabels([{ id: "p", factor_type: "phone" }]);
    expect(labels.has("p")).toBe(false);
    expect(isSupportedFactorKind("phone")).toBe(false);
  });
});

describe("uniqueFactorName", () => {
  it("ne produit jamais deux fois le même nom (GoTrue refuse les doublons par compte)", async () => {
    const premier = uniqueFactorName("Llave de seguridad");
    await new Promise((resolve) => setTimeout(resolve, 3));
    expect(uniqueFactorName("Llave de seguridad")).not.toBe(premier);
  });
});

describe("purgeUnverifiedFactors", () => {
  it("supprime les seuls enrôlements abandonnés et rend la liste lue", async () => {
    const unenroll = vi.fn(async () => ({ error: null }));
    const all = [
      { id: "ok", status: "verified" },
      { id: "abandonne", status: "unverified" },
    ];
    const supabase = {
      auth: { mfa: { listFactors: async () => ({ data: { all }, error: null }), unenroll } },
    } as unknown as SupabaseClient;

    expect(await purgeUnverifiedFactors(supabase)).toEqual(all);
    expect(unenroll).toHaveBeenCalledTimes(1);
    expect(unenroll).toHaveBeenCalledWith({ factorId: "abandonne" });
  });

  it("une lecture en échec lève, au lieu de passer pour « aucun facteur »", async () => {
    const supabase = {
      auth: {
        mfa: {
          listFactors: async () => ({ data: null, error: { message: "x" } }),
          unenroll: vi.fn(),
        },
      },
    } as unknown as SupabaseClient;
    await expect(purgeUnverifiedFactors(supabase)).rejects.toThrow(/Lecture des facteurs/);
  });
});

// Forme réelle des erreurs du SDK (auth-js 2.112.3, lib/webauthn.errors.js) : fermer la fenêtre de la
// clé lève `NotAllowedError`, rendue en ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY avec la cause d'origine.
describe("isCancelledCeremony", () => {
  it("reconnaît une fenêtre fermée ou un délai dépassé (NotAllowedError)", () => {
    expect(
      isCancelledCeremony({
        name: "WebAuthnError",
        code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
        cause: { name: "NotAllowedError" },
      })
    ).toBe(true);
  });

  it("reconnaît l'annulation par signal", () => {
    expect(isCancelledCeremony({ code: "ERROR_CEREMONY_ABORTED" })).toBe(true);
  });

  it("ne prend pas une vraie panne pour une annulation", () => {
    expect(
      isCancelledCeremony({
        code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
        cause: { name: "SecurityError" },
      })
    ).toBe(false);
    expect(isCancelledCeremony({ code: "ERROR_INVALID_RP_ID" })).toBe(false);
    expect(isCancelledCeremony({ name: "AuthError", message: "x" })).toBe(false);
    expect(isCancelledCeremony(null)).toBe(false);
    expect(isCancelledCeremony("x")).toBe(false);
  });
});
