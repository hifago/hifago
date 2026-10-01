// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { getSiteUrl, isIndexableSite, isProductionSite } from "./siteUrl";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("getSiteUrl", () => {
  it("replie sur le port de dev local quand la variable est absente", () => {
    delete process.env.NEXT_PUBLIC_WEB_APP_URL;
    delete process.env.VERCEL_ENV;
    expect(getSiteUrl()).toBe("http://localhost:3100");
  });

  it("retire la barre oblique finale — sinon metadataBase produirait des URL à double slash", () => {
    process.env.NEXT_PUBLIC_WEB_APP_URL = "https://hifago.co/";
    expect(getSiteUrl()).toBe("https://hifago.co");
  });

  it("traite une variable vide ou blanche comme absente", () => {
    process.env.NEXT_PUBLIC_WEB_APP_URL = "   ";
    delete process.env.VERCEL_ENV;
    expect(getSiteUrl()).toBe("http://localhost:3100");
  });

  // En production, le repli local n'est jamais une URL acceptable : canonical, hreflang, sitemap
  // et robots.txt pointeraient sur localhost. Lever fait échouer le build de production (robots.txt
  // est prérendu) — un échec fermé, visible, au lieu d'un site indexé sous une mauvaise adresse.
  it.each([[undefined], [""], ["   "]])(
    "lève en production quand la variable vaut %j",
    (valeur) => {
      process.env.VERCEL_ENV = "production";
      if (valeur === undefined) delete process.env.NEXT_PUBLIC_WEB_APP_URL;
      else process.env.NEXT_PUBLIC_WEB_APP_URL = valeur;
      expect(() => getSiteUrl()).toThrow(/NEXT_PUBLIC_WEB_APP_URL/);
    }
  );

  it("garde le repli hors production (preview, staging), où il ne sert qu'aux liens internes", () => {
    process.env.VERCEL_ENV = "preview";
    delete process.env.NEXT_PUBLIC_WEB_APP_URL;
    expect(getSiteUrl()).toBe("http://localhost:3100");
  });
});

describe("isProductionSite", () => {
  it("est faux hors production, même si l'URL configurée est celle de production", () => {
    // Le cas qui motive ce prédicat : une variable Vercel « All Environments » porte l'URL de
    // production jusque dans les builds de preview. Seul VERCEL_ENV distingue les deux.
    process.env.NEXT_PUBLIC_WEB_APP_URL = "https://hifago.co";
    process.env.VERCEL_ENV = "preview";
    expect(isProductionSite()).toBe(false);
  });

  it("est faux quand VERCEL_ENV est absent (dev local, CI)", () => {
    delete process.env.VERCEL_ENV;
    expect(isProductionSite()).toBe(false);
  });

  it("n'est vrai que sur le déploiement de production", () => {
    process.env.VERCEL_ENV = "production";
    expect(isProductionSite()).toBe(true);
  });
});

describe("isIndexableSite", () => {
  it("reste fermé en production si la variable manque (jamais d'indexation sous localhost)", () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.NEXT_PUBLIC_WEB_APP_URL;
    expect(isIndexableSite()).toBe(false);
  });

  it("reste fermé sur la production provisoire servie sous *.vercel.app (avant la bascule)", () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_WEB_APP_URL = "https://hifago-web-orpin.vercel.app";
    expect(isIndexableSite()).toBe(false);
  });

  it("s'ouvre sur la production servie sous le vrai domaine", () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_WEB_APP_URL = "https://hifago.co";
    expect(isIndexableSite()).toBe(true);
  });

  it("le vrai domaine n'ouvre RIEN hors production — VERCEL_ENV reste exigé", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.NEXT_PUBLIC_WEB_APP_URL = "https://hifago.co";
    expect(isIndexableSite()).toBe(false);
  });

  it("ne se laisse pas tromper par un domaine qui contient « vercel.app » sans en être un", () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_WEB_APP_URL = "https://vercel.app.hifago.co";
    expect(isIndexableSite()).toBe(true);
  });

  it("échoue fermé sur une URL configurée illisible", () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_WEB_APP_URL = "pas une url";
    expect(isIndexableSite()).toBe(false);
  });
});
