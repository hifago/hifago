#!/usr/bin/env node
/**
 * `supabase/config.toml` déclare-t-il la politique Auth attendue (`supabase/auth-policy.json`) ?
 *
 *   node scripts/check-auth-config.mjs   → exit 0 si conforme, 1 sur un écart, 2 si illisible
 *
 * Lancé par `npm run verify`. Il garde le local aligné sur ce qu'on exige du cloud : longueur et
 * caractères du mot de passe, ré-authentification pour en changer, gabarits d'e-mail. Le cloud
 * lui-même se vérifie à part, en lecture seule : scripts/check-cloud-auth-config.mjs.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ecartsConfigLocale, lireConfigToml } from "./lib/auth-policy.mjs";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let config;
let politique;
try {
  config = lireConfigToml(fs.readFileSync(path.join(RACINE, "supabase/config.toml"), "utf-8"));
  politique = JSON.parse(fs.readFileSync(path.join(RACINE, "supabase/auth-policy.json"), "utf-8"));
} catch (erreur) {
  console.error(`✗ Lecture impossible : ${erreur.message}`);
  process.exit(2);
}

const ecarts = ecartsConfigLocale(config, politique);

// Un gabarit cité doit exister : c'est son contenu que le cloud doit porter.
for (const valeur of Object.values(politique)) {
  if (valeur !== null && typeof valeur === "object" && !fs.existsSync(path.join(RACINE, valeur.fichier))) {
    ecarts.push(`${valeur.fichier} : fichier introuvable`);
  }
}

if (ecarts.length > 0) {
  console.error("✗ supabase/config.toml ne déclare pas la politique de supabase/auth-policy.json :");
  for (const ecart of ecarts) console.error(`    - ${ecart}`);
  process.exit(1);
}
console.log("✓ config.toml conforme à auth-policy.json");
