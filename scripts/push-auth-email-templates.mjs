#!/usr/bin/env node
/**
 * Pose les e-mails Supabase Auth (sujets + gabarits `supabase/templates/*.html`, d'après
 * `supabase/auth-policy.json`) sur un projet CLOUD, puis constate le résultat.
 *
 *   SUPABASE_ACCESS_TOKEN=… node scripts/push-auth-email-templates.mjs <project-ref> --nom <nom du projet> [--dry-run]
 *
 *   préprod : node scripts/push-auth-email-templates.mjs ujlltaauitqfabcbgvaw --nom hifago-preprod
 *   prod    : node scripts/push-auth-email-templates.mjs flshpzcpizqqmgmnfgkd --nom <nom affiché>
 *             ⚠️ seulement APRÈS la mise en prod du code de la vitrine : les gabarits chargent
 *             `https://hifago.co/brand/email-cabecera.jpg`, qui n'existe pas avant.
 *
 * Né le 2026-11-12 (charte sur tous les e-mails). Avant : PATCH tapé à la main (runbook §6, prod du
 * 2026-10-03). `supabase config push` reste interdit (il pousserait AUSSI site_url et le reste).
 *
 * Garde-fous :
 *   - compte vérifié AVANT toute écriture (CLAUDE.md §8.1, `/hifago-verify-compte` rendu
 *     mécanique) : le jeton doit voir le projet, et son nom doit être celui passé par `--nom` —
 *     une faute de ref ou un jeton d'un autre compte s'arrête là ;
 *   - le PATCH ne porte QUE les e-mails Auth (`payloadEmailsAuth`), jamais SMTP, mots de passe ni
 *     site_url ;
 *   - jeton lu dans l'environnement de la session, jamais en argument ni dans un fichier (§8.2) ;
 *     aucune réponse de l'API n'est affichée (elle contient des secrets du projet) ;
 *   - relecture finale par `ecartsCloud`, la même que scripts/check-cloud-auth-config.mjs.
 *
 * Sortie : 0 conforme · 1 écart après envoi · 2 erreur (usage, jeton, compte, réseau).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ecartsCloud, payloadEmailsAuth } from "./lib/auth-policy.mjs";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.supabase.com/v1";

const args = process.argv.slice(2);
const ref = args[0];
const nomAttendu = args[args.indexOf("--nom") + 1];
const essai = args.includes("--dry-run");
const jeton = process.env.SUPABASE_ACCESS_TOKEN;

function arreter(message, code = 2) {
  console.error(`✗ ${message}`);
  process.exit(code);
}

if (!ref || !/^[a-z0-9]{20}$/.test(ref) || !args.includes("--nom") || !nomAttendu || nomAttendu.startsWith("--")) {
  arreter("Usage : SUPABASE_ACCESS_TOKEN=… node scripts/push-auth-email-templates.mjs <project-ref> --nom <nom du projet> [--dry-run]");
}
if (!jeton) arreter("SUPABASE_ACCESS_TOKEN absent de l'environnement (jeton personnel : supabase.com → Account → Access Tokens).");

const entetes = { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" };
async function api(methode, chemin, corps) {
  let res;
  try {
    res = await fetch(`${API}${chemin}`, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined });
  } catch (erreur) {
    arreter(`${methode} ${chemin} impossible : ${erreur.message}`);
  }
  if (!res.ok) arreter(`${methode} ${chemin} : HTTP ${res.status}`);
  return res.json();
}

// 1. Compte : le jeton voit-il CE projet, sous CE nom ?
const projets = await api("GET", "/projects");
const projet = Array.isArray(projets) ? projets.find((p) => p.id === ref || p.ref === ref) : undefined;
if (!projet) {
  arreter(`le jeton ne voit pas le projet ${ref}. Projets visibles : ${(projets ?? []).map((p) => p.name).join(", ") || "aucun"}.`);
}
if (projet.name !== nomAttendu) {
  arreter(`le projet ${ref} s'appelle « ${projet.name} », pas « ${nomAttendu} » — rien n'a été envoyé.`);
}
console.log(`✓ compte : ${projet.name} (${ref}), organisation ${projet.organization_id}`);

// 2. Le corps : sujets et gabarits de la politique, rien d'autre.
const politique = JSON.parse(fs.readFileSync(path.join(RACINE, "supabase/auth-policy.json"), "utf-8"));
const lireFichier = (fichier) => fs.readFileSync(path.join(RACINE, fichier), "utf-8");
const payload = payloadEmailsAuth(politique, lireFichier);
console.log(`  champs envoyés : ${Object.keys(payload).join(", ")}`);
if (essai) {
  console.log("  --dry-run : rien n'a été envoyé.");
  process.exit(0);
}

// 3. Envoi, puis relecture.
await api("PATCH", `/projects/${ref}/config/auth`, payload);
const ecarts = ecartsCloud(await api("GET", `/projects/${ref}/config/auth`), politique, lireFichier);
const ecartsEmails = ecarts.filter((e) => /^mailer_/.test(e));
if (ecartsEmails.length > 0) {
  console.error(`✗ ${projet.name} : e-mails Auth différents après envoi :`);
  for (const e of ecartsEmails) console.error(`    - ${e}`);
  process.exit(1);
}
console.log(`✓ ${projet.name} : sujets et gabarits des e-mails Auth conformes à supabase/auth-policy.json`);
if (ecarts.length > ecartsEmails.length) {
  console.log(`  (autres écarts de configuration, non touchés ici : ${ecarts.length - ecartsEmails.length} — voir check-cloud-auth-config.mjs)`);
}
