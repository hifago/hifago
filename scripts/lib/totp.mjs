/**
 * Code TOTP (RFC 6238, SHA-1, 6 chiffres, pas de 30 s) pour les scripts Node `.mjs` qui doivent
 * monter une session admin en AAL2 — `is_admin()` l'exige dès qu'un facteur TOTP est vérifié
 * (spec 07 §8). Premier consommateur : `supabase/scripts/seed-mock-data.mjs` (2026-11-13).
 *
 * Même algorithme que `packages/e2e-support/src/mfa.ts`, que les `.mjs` ne peuvent pas importer
 * (TypeScript). Les deux sont tenus égaux par `totp.test.mjs` (vecteurs RFC + parité), lancé par
 * `npm run verify` — une copie que rien ne compare dériverait (CLAUDE.md §11.20).
 */
import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(secret) {
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const valeur = BASE32.indexOf(char);
    if (valeur < 0) throw new Error(`secret TOTP invalide : caractère « ${char} » hors base32`);
    bits += valeur.toString(2).padStart(5, "0");
  }
  const octets = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) octets.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(octets);
}

/** @param {string} secret base32 @param {number} [timestamp] ms @returns {string} 6 chiffres */
export function generateTotp(secret, timestamp = Date.now()) {
  const compteur = Buffer.alloc(8);
  compteur.writeBigUInt64BE(BigInt(Math.floor(timestamp / 1000 / 30)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(compteur).digest();
  const decalage = hmac[hmac.length - 1] & 0xf;
  const code =
    (((hmac[decalage] & 0x7f) << 24) |
      ((hmac[decalage + 1] & 0xff) << 16) |
      ((hmac[decalage + 2] & 0xff) << 8) |
      (hmac[decalage + 3] & 0xff)) %
    1000000;
  return code.toString().padStart(6, "0");
}
