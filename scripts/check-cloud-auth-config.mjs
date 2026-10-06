#!/usr/bin/env node
/**
 * La configuration Auth d'un projet Supabase CLOUD porte-t-elle la politique attendue ?
 *
 *   SUPABASE_ACCESS_TOKEN=… node scripts/check-cloud-auth-config.mjs <project-ref>
 *   → exit 0 si conforme, 1 sur un écart, 2 sur une erreur (jeton, réseau, réponse)
 *
 * LECTURE SEULE : un unique `GET /v1/projects/{ref}/config/auth`, jamais de PATCH. Les réglages se
 * posent ailleurs, champ par champ, par l'API de gestion (jamais `supabase config push`), puis ce
 * script le constate.
 *
 * Le jeton vient de l'environnement de la session, jamais d'un argument (visible dans `ps` et
 * l'historique) ni d'un fichier. La réponse contient des secrets du projet (SMTP, OAuth) : elle
 * n'est JAMAIS affichée ; seules les clés de `supabase/auth-policy.json` sont comparées, et le
 * comparateur refuse toute clé de secret.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ecartsCloud } from "./lib/auth-policy.mjs";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ref = process.argv[2];
const jeton = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !/^[a-z0-9]{20}$/.test(ref)) {
  console.error("Usage : SUPABASE_ACCESS_TOKEN=… node scripts/check-cloud-auth-config.mjs <project-ref>");
  process.exit(2);
}
if (!jeton) {
  console.error("✗ SUPABASE_ACCESS_TOKEN absent de l'environnement.");
  process.exit(2);
}

const politique = JSON.parse(fs.readFileSync(path.join(RACINE, "supabase/auth-policy.json"), "utf-8"));

let reponse;
try {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: "GET",
    headers: { Authorization: `Bearer ${jeton}` },
  });
  if (!res.ok) {
    console.error(`✗ GET config/auth : HTTP ${res.status}`);
    process.exit(2);
  }
  reponse = await res.json();
} catch (erreur) {
  console.error(`✗ GET config/auth impossible : ${erreur.message}`);
  process.exit(2);
}

const ecarts = ecartsCloud(reponse, politique, (fichier) =>
  fs.readFileSync(path.join(RACINE, fichier), "utf-8")
);
if (ecarts.length > 0) {
  console.error(`✗ Projet ${ref} : configuration Auth différente de supabase/auth-policy.json :`);
  for (const ecart of ecarts) console.error(`    - ${ecart}`);
  process.exit(1);
}
console.log(`✓ Projet ${ref} : configuration Auth conforme à supabase/auth-policy.json`);
