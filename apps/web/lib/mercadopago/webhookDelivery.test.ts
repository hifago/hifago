// @vitest-environment node
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_STORED_BODY_CHARS,
  SIGNATURE_TS_OBSERVATION_SECONDS,
  signatureTimestampDrift,
  storedWebhookBody,
} from "./webhookDelivery";

const SECRET = "secret-de-test-jamais-un-vrai";
const DATA_ID = "179050364695";
const REQUEST_ID = "d7b8e9a0-1111-2222-3333-444455556666";
const NOW_MS = 1_800_000_000_000;

/** Signature HMAC du manifeste documenté par Mercado Pago, pour un horodatage donné. */
function hmac(ts: string) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(`id:${DATA_ID};request-id:${REQUEST_ID};ts:${ts};`)
    .digest("hex");
}

const drift = (xSignature: string) =>
  signatureTimestampDrift({ xSignature, xRequestId: REQUEST_ID, dataId: DATA_ID, secret: SECRET, nowMs: NOW_MS });

describe("signatureTimestampDrift", () => {
  it("rend null pour un horodatage signé dans le seuil", () => {
    const ts = String(NOW_MS / 1000 - (SIGNATURE_TS_OBSERVATION_SECONDS - 1));
    expect(drift(`ts=${ts},v1=${hmac(ts)}`)).toBeNull();
  });

  it("rend l'écart, en secondes, d'un horodatage signé au-delà du seuil", () => {
    const ts = String(NOW_MS / 1000 - 3600);
    expect(drift(`ts=${ts},v1=${hmac(ts)}`)).toBe(3600);
  });

  it("mesure l'horodatage que le SDK a vérifié, quelle que soit l'écriture de l'en-tête", () => {
    const vieux = String(NOW_MS / 1000 - 3600);
    const frais = String(NOW_MS / 1000);
    expect(drift(`ts=${frais},ts=${vieux},v1=${hmac(vieux)}`)).toBe(3600);
    expect(drift(`TS=${vieux},v1=${hmac(vieux)}`)).toBe(3600);
    expect(drift(`ts = ${vieux} , v1=${hmac(vieux)}`)).toBe(3600);
  });
});

describe("storedWebhookBody", () => {
  it("garde tel quel un corps raisonnable, jusqu'à la borne comprise", () => {
    const body = { data: { id: "123" }, pad: "x".repeat(MAX_STORED_BODY_CHARS - 30) };
    expect(JSON.stringify(body).length).toBeLessThanOrEqual(MAX_STORED_BODY_CHARS);
    expect(storedWebhookBody(body)).toEqual(body);
  });

  it("rend toujours un JSON que jsonb accepte : U+0000 et moitié de paire isolée deviennent U+FFFD", () => {
    expect(storedWebhookBody({ ["a\u0000"]: "b\u0000", c: "\ud800", d: ["\udc00x"], e: "ok 😀" })).toEqual({
      ["a\uFFFD"]: "b\uFFFD",
      c: "\uFFFD",
      d: ["\uFFFDx"],
      e: "ok 😀",
    });
  });

  it("tronque un corps démesuré, en disant sa taille réelle", () => {
    const body = { pad: "x".repeat(MAX_STORED_BODY_CHARS * 4) };
    const stored = storedWebhookBody(body) as { truncated: boolean; chars: number; head: string };
    expect(stored.truncated).toBe(true);
    expect(stored.chars).toBe(JSON.stringify(body).length);
    expect(stored.head).toHaveLength(MAX_STORED_BODY_CHARS);
  });

  it("ne coupe jamais une paire de substitution (jsonb la refuserait)", () => {
    // `{"pad":"` fait 8 caractères : l'emoji tombe à cheval sur la borne.
    const body = { pad: "x".repeat(MAX_STORED_BODY_CHARS - 9) + "😀" + "y".repeat(100) };
    const stored = storedWebhookBody(body) as { head: string };
    expect(stored.head).toHaveLength(MAX_STORED_BODY_CHARS - 1);
    expect(/[\uD800-\uDBFF]$/.test(stored.head)).toBe(false);
  });

  it("ne lève jamais : un corps trop imbriqué pour JSON.stringify devient un marqueur", () => {
    let body: unknown[] = [];
    for (let i = 0; i < 200_000; i++) body = [body];
    expect(storedWebhookBody(body as never)).toEqual({ unserializable: true });
  });
});
