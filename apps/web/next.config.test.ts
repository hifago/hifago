// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// Configuration lue au BUILD : ce fichier prouve les en-têtes de sécurité posés sur toutes les
// réponses, l'absence de `X-Powered-By`, et que la levée de la garde anti-SSRF de next/image sur
// les IP locales ne vaut que pour une instance Supabase locale — jamais en cloud, quel que soit
// NODE_ENV (la CI builde en production contre 127.0.0.1). La config testée est celle qu'exporte
// le plugin next-intl : elle prouve aussi que le plugin conserve ces réglages.

async function charger(supabaseUrl: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
  const { default: config } = await import("./next.config");
  return config;
}

describe("apps/web/next.config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("pose les en-têtes de sécurité sur toutes les routes, sans X-Powered-By", async () => {
    const config = await charger("https://abc.supabase.co");
    expect(config.poweredByHeader).toBe(false);
    expect(await config.headers!()).toEqual([
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ]);
  });

  it.each([
    ["https://abc.supabase.co", false],
    ["http://127.0.0.1:54321", true],
    ["http://localhost:54321", true],
    ["http://[::1]:54321", true],
  ])("images.dangerouslyAllowLocalIP pour %s : %s", async (url, attendu) => {
    vi.stubEnv("NODE_ENV", "production");
    const config = await charger(url);
    expect(config.images?.dangerouslyAllowLocalIP).toBe(attendu);
  });
});
