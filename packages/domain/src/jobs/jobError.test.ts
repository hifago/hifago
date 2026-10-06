import { describe, expect, it } from "vitest";
import { describeJobError, redactSecrets } from "./jobError";
import { describeLobbyErrorBody } from "../pms/describeLobbyErrorBody";

// Un jeton Lobby a la forme d'un jeton réel (60 caractères alphanumériques, cf. journal 2026-09) —
// jamais un vrai.
const LOBBY_TOKEN = "Zq3vK8mN1pR4tW7yB0cE2fH5jL6nP9sU3xA8dG1kM4oQ7rT0vY2zC5eF8hJ";
const RELAY_SECRET = "relais-secret-de-test-0123456789";

describe("redactSecrets", () => {
  it("le message d'erreur d'un fetch Deno, qui contient l'URL avec api_token : le jeton disparaît", () => {
    const deno =
      `TypeError: error sending request for url (https://relais.example/api/v1/bookings/21635340?api_token=${LOBBY_TOKEN}): ` +
      "client error (Connect): tcp connect error: Connection refused (os error 111)";
    const out = redactSecrets(deno, [LOBBY_TOKEN]);
    expect(out).not.toContain(LOBBY_TOKEN);
    expect(out).toContain("api_token=[secret]");
    expect(out).toContain("TypeError: error sending request");
  });

  it("le même message SANS que le jeton soit connu de l'appelant : le paramètre est masqué quand même", () => {
    const out = redactSecrets(`GET https://relais.example/api/v1/rooms?page=2&api_token=${LOBBY_TOKEN} → 403`);
    expect(out).not.toContain(LOBBY_TOKEN);
    expect(out).toContain("page=2&api_token=[secret]");
  });

  it("une page d'erreur HTML de proxy qui recopie l'URL (jeton encodé compris)", () => {
    const html = `<html><body><h1>502 Bad Gateway</h1><p>/api/v2/available-rooms?start_date=2026-10-01&amp;api_token=${encodeURIComponent(LOBBY_TOKEN + "+/")}</p></body></html>`;
    const out = redactSecrets(html, [LOBBY_TOKEN + "+/"]);
    expect(out).not.toContain(LOBBY_TOKEN);
  });

  it("un corps Lobby réel qui ne porte aucun secret passe tel quel", () => {
    const body = '{"message":"No query results for model [App\\\\Models\\\\Booking]."}';
    expect(redactSecrets(body, [LOBBY_TOKEN])).toBe(body);
    expect(redactSecrets('{"error":"Unauthenticated."}', [LOBBY_TOKEN])).toBe('{"error":"Unauthenticated."}');
  });

  it.each([
    ["un en-tête Authorization recopié", "Authorization: Bearer eyJabc.def.ghi refusé", "Authorization: [secret] refusé"],
    ["un Bearer nu", "jeton Bearer abcdefgh1234 refusé", "jeton Bearer [secret] refusé"],
    ["un en-tête apikey recopié", "apikey: sb_secret_AbCdEf0123456789 x", "apikey: [secret] x"],
    ["un JWT nu", "clé eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig refusée", "clé [secret] refusée"],
    ["une clé secrète Supabase", "sb_secret_AbCdEf0123456789 invalide", "[secret] invalide"],
    ["une clé Resend", "clé re_123456789abcdefghijklmn refusée", "clé [secret] refusée"],
    ["un jeton Mercado Pago", "APP_USR-1234567890123456-100412-abcdef refusé", "[secret] refusé"],
  ])("masque %s inconnu de l'appelant", (_cas, text, expected) => {
    expect(redactSecrets(text)).toBe(expected);
  });

  it("masque un secret connu où qu'il soit, le plus long d'abord", () => {
    const out = redactSecrets(`x-relay ${RELAY_SECRET} / ${RELAY_SECRET}-suffixe`, [RELAY_SECRET, `${RELAY_SECRET}-suffixe`]);
    expect(out).toBe("x-relay [secret] / [secret]");
  });

  it("ignore les « secrets » trop courts pour être des secrets (jamais un mot courant masqué)", () => {
    expect(redactSecrets("rate limited", ["rate", "", null, undefined])).toBe("rate limited");
  });

  it("un secret CONNU encodé dans une URL, sans paramètre reconnaissable devant", () => {
    expect(redactSecrets(`x-relay ${encodeURIComponent("abc+def/ghi=jkl")}`, ["abc+def/ghi=jkl"])).toBe("x-relay [secret]");
  });

  it("un jeton encodé ou en JSON n'échappe jamais au masquage, même à cheval sur la coupe à 200", () => {
    const redact = (text: string) => redactSecrets(text, [LOBBY_TOKEN]);
    for (let pad = 0; pad < 260; pad += 7) {
      const encoded = { raw: `${"p".repeat(pad)}<a href="/login?redirect_url=%2Fapi%2Fv1%2Frooms%3Fapi_token%3D${LOBBY_TOKEN}">` };
      const json = { error_code: "INPUT_PARAMETERS", error: "y".repeat(pad), input: { api_token: LOBBY_TOKEN } };
      for (const body of [encoded, json]) {
        const out = describeLobbyErrorBody(body, redact);
        // Aucun morceau de 8 caractères du jeton ne sort.
        for (let i = 0; i + 8 <= LOBBY_TOKEN.length; i++) expect(out).not.toContain(LOBBY_TOKEN.slice(i, i + 8));
      }
    }
  });

  it("le même masquage, sans connaître le jeton : formes encodée et JSON reconnues", () => {
    expect(redactSecrets(`redirect=%2Frooms%3Fapi_token%3D${LOBBY_TOKEN}`)).not.toContain(LOBBY_TOKEN);
    expect(redactSecrets(`{"input":{"api_token":"${LOBBY_TOKEN}"}}`)).toBe('{"input":{"api_token":"[secret]"}}');
  });

  it("temps linéaire sur une entrée hostile (aucun motif quadratique)", () => {
    const hostile = "-eyJaaaaa".repeat(32_000) + "re_".repeat(20_000) + "TEST-".repeat(20_000);
    const start = performance.now();
    redactSecrets(hostile, [LOBBY_TOKEN]);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("tronque un texte long", () => {
    expect(redactSecrets("x".repeat(1000)).length).toBeLessThanOrEqual(301);
  });
});

describe("describeJobError", () => {
  it("une erreur de délai : son nom suffit", () => {
    const err = new DOMException("Signal timed out.", "TimeoutError");
    expect(describeJobError(err)).toBe("TimeoutError: Signal timed out.");
  });

  it("une erreur réseau qui porte l'URL avec le jeton : nom et message, jeton masqué", () => {
    const err = new TypeError(`error sending request for url (https://relais.example/api/v1/bookings/1?api_token=${LOBBY_TOKEN})`);
    const out = describeJobError(err, [LOBBY_TOKEN]);
    expect(out.startsWith("TypeError: error sending request")).toBe(true);
    expect(out).not.toContain(LOBBY_TOKEN);
  });

  it("une erreur PostgREST : code et message", () => {
    expect(describeJobError({ code: "42501", message: "permission denied" })).toBe("42501 permission denied");
  });
});
