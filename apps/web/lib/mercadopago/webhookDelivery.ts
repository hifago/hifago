// Ce que la route du webhook Mercado Pago garde d'une livraison, et ce qu'elle en observe.
import {
  InvalidWebhookSignatureError,
  SignatureFailureReason,
  WebhookSignatureValidator,
} from "mercadopago";

// Miroir local du type Json généré par Supabase — même convention que la route du webhook.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Seuil d'OBSERVATION de l'horodatage signé (`ts` de x-signature) — JAMAIS appliqué. Le SDK sait
 * refuser une livraison trop vieille (`toleranceSeconds`), mais rien ne dit encore si Mercado Pago
 * re-signe ses retentatives : bloquer risquerait de rejeter un vrai paiement. Un rejeu ne change pas
 * l'état (la route relit l'état courant chez Mercado Pago, la base est idempotente) : on compte
 * d'abord, on décidera sur mesure.
 */
export const SIGNATURE_TS_OBSERVATION_SECONDS = 300;

/**
 * Pour une livraison DONT LA SIGNATURE EST DÉJÀ VALIDÉE : l'écart (en secondes) entre son horodatage
 * signé et `nowMs` s'il dépasse le seuil d'observation, sinon null. C'est le SDK qui le dit — en
 * revalidant avec `toleranceSeconds` — pour mesurer exactement le `ts` qu'il a vérifié, jamais une
 * relecture maison de l'en-tête.
 */
export function signatureTimestampDrift(options: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string;
  secret: string;
  nowMs: number;
}): number | null {
  try {
    WebhookSignatureValidator.validate({
      xSignature: options.xSignature,
      xRequestId: options.xRequestId,
      dataId: options.dataId,
      secret: options.secret,
      toleranceSeconds: SIGNATURE_TS_OBSERVATION_SECONDS,
      now: () => options.nowMs,
    });
    return null;
  } catch (error) {
    if (
      error instanceof InvalidWebhookSignatureError &&
      error.reason === SignatureFailureReason.TimestampOutOfTolerance &&
      error.timestamp
    ) {
      // `ts` est en secondes, comme le SDK le lit.
      return Math.abs(options.nowMs - Number(error.timestamp) * 1000) / 1000;
    }
    return null;
  }
}

/**
 * Taille maximale (en caractères JSON) du corps conservé dans `raw_event`. Un corps Mercado Pago
 * tient en quelques centaines de caractères ; le matériel de rejeu d'une signature est dans
 * l'enveloppe `delivery` (en-têtes et query), jamais dans le corps.
 */
export const MAX_STORED_BODY_CHARS = 8192;

/** Ce que jsonb refuse dans une chaîne — U+0000 et une moitié de paire de substitution isolée —
 * devient U+FFFD. */
function jsonbSafeString(value: string): string {
  return value
    .replace(/\u0000/g, "\uFFFD")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

function jsonbSafe(value: Json): Json {
  if (typeof value === "string") return jsonbSafeString(value);
  if (Array.isArray(value)) return value.map(jsonbSafe);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [jsonbSafeString(key), jsonbSafe(item)]));
  }
  return value;
}

/**
 * Le corps tel quel s'il est raisonnable ; sinon son début, marqué tronqué, avec sa taille réelle.
 * Toujours acceptable par jsonb (voir jsonbSafeString). Ne lève jamais : un corps trop imbriqué
 * pour être parcouru devient un marqueur.
 */
export function storedWebhookBody(body: Json): Json {
  let safe: Json;
  let text: string;
  try {
    safe = jsonbSafe(body);
    text = JSON.stringify(safe) ?? "null";
  } catch {
    return { unserializable: true };
  }
  if (text.length <= MAX_STORED_BODY_CHARS) return safe;
  let head = text.slice(0, MAX_STORED_BODY_CHARS);
  // Jamais une moitié de paire de substitution en fin de coupe : jsonb la refuserait.
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  return { truncated: true, chars: text.length, head };
}
