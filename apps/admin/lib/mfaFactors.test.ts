// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  factorLabels,
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

  it("une lecture en échec ne bloque pas l'enrôlement qui suit", async () => {
    const supabase = {
      auth: {
        mfa: {
          listFactors: async () => ({ data: null, error: { message: "x" } }),
          unenroll: vi.fn(),
        },
      },
    } as unknown as SupabaseClient;
    expect(await purgeUnverifiedFactors(supabase)).toEqual([]);
  });
});
