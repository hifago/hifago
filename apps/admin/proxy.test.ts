// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Rafraîchissement de session dans le proxy. Quand le jeton expire, `getUser()` en obtient un neuf
// et l'écrit par `setAll`. Ce fichier prouve que ce cookie neuf part au navigateur ET aux Server
// Components de CETTE requête : sans `NextResponse.next({ request })`, les pages relisaient l'ancien
// jeton, déjà remplacé, sur la requête même où il expirait.

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: { setAll: (cookies: { name: string; value: string; options: object }[]) => void } }
  ) => ({
    auth: {
      getUser: async () => {
        options.cookies.setAll([{ name: "sb-test-auth-token", value: "neuf", options: { path: "/" } }]);
        return { data: { user: null } };
      },
    },
  }),
}));

const { default: proxy } = await import("./proxy");

describe("proxy admin — cookie de session rafraîchi", () => {
  async function appeler() {
    return proxy(
      new NextRequest("http://localhost:3101/admin", { headers: { cookie: "sb-test-auth-token=ancien" } })
    );
  }

  it("part au navigateur", async () => {
    const reponse = await appeler();
    expect(reponse.cookies.get("sb-test-auth-token")?.value).toBe("neuf");
  });

  it("atteint aussi les Server Components de la même requête", async () => {
    const reponse = await appeler();
    expect(reponse.headers.get("x-middleware-request-cookie") ?? "(non transmis)").toContain(
      "sb-test-auth-token=neuf"
    );
  });
});
