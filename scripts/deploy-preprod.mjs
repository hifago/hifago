#!/usr/bin/env node
// Pousse `staging` vers la PRÉPROD, dans le seul ordre qui ne casse rien : la base, puis le code.
//
//   node scripts/deploy-preprod.mjs all        code + base            (/push-db)
//   node scripts/deploy-preprod.mjs code       code, et la base si le code en dépend   (/push)
//   node scripts/deploy-preprod.mjs db         base seule, aucun `git push`            (/upload-db)
//   … --dry-run     ne pousse rien : dit ce qui partirait, puis contrôle la préprod
//   … --no-wait     n'attend pas la fin du build Vercel
//   … --contenu-envoye   le contenu saisi en local depuis le dernier envoi est porté par une
//                        migration de ce lot, ou ne doit pas partir (essai) — voir l'étape 3
//
// POURQUOI CE SCRIPT EXISTE (panne du 2026-10-13). Vercel déploie `staging` dès le `git push` ; le
// schéma, lui, attendait un `supabase db push` lancé à la main. Du code lisant
// `establishments.is_place` est parti avant sa migration : toute fiche de la préprod a rendu
// « Algo salió mal » pendant des heures, les listes restant vertes. Même faute le 2026-10-01.
// L'ordre « base avant code » était écrit au runbook §4 ; rien ne le tenait (CLAUDE.md §11.20).
//
// CE QU'IL FAIT, DANS CET ORDRE — et il s'arrête au premier échec, avant l'étape suivante :
//   1. git : branche `staging`, pas en retard sur `origin`, rien de non commité côté base ;
//   2. compte : la CLI Supabase voit bien `hifago-preprod` dans l'organisation Hifago
//      (`/hifago-verify-compte` rendu mécanique — jamais supposé) ;
//   3. contenu saisi dans la base LOCALE (admin, socio) depuis le dernier envoi réussi : listé, et
//      arrêt tant qu'aucune migration ne le porte (`--contenu-envoye` une fois écrite) — le
//      2026-10-14, « Exposición Mirarte », créée dans l'admin local, manquait à la préprod après un
//      `/push-db` tout vert : ce script n'envoie que des migrations, et rien ne le disait ;
//      puis `npm run verify` s'il y a des commits à pousser (les contrôles du hook pre-push,
//      lancés AVANT de toucher à la base plutôt qu'après) ;
//   4. photos du bucket `catalog-media` citées par une migration en attente et absentes de la
//      préprod → envoyées depuis la pile locale (une migration ne transporte pas de fichier),
//      puis migrations en attente → `supabase db push` ;
//   5. Edge Functions → `supabase functions deploy`, seulement si leurs sources ont changé ;
//   6. `git push origin staging`, puis attente du build Vercel des deux apps ;
//   7. contrôle au rendu réel : accueil, une liste, une fiche produit, une fiche établissement,
//      le sitemap, la connexion de l'admin — tous en 200.
//
// ⚠️ LE CLONE N'EST JAMAIS LIÉ À LA PRÉPROD. `supabase link` écrit dans `supabase/.temp` et un
// dossier resté lié fausse ensuite la pile locale (`db reset` applique le schéma Storage distant,
// journal du 2026-10-01) ; `supabase unlink` vide `.temp` en entier (constaté le 2026-10-13). Le
// lien se fait donc dans une COPIE temporaire de `supabase/` (`--workdir`), détruite à la fin.
// Sans lien du tout, la CLI échoue ici en `DbConfigIpv6Error` : c'est lui qui pose l'accès IPv4.
//
// CE QU'IL NE FAIT PAS, délibérément :
//   - la PROD : jamais. Elle reste une PR `staging → main` et un geste manuel (CLAUDE.md §7.2) ;
//   - les DONNÉES : ni `seed.sql` ni `mockData/`. La préprod porte les partenaires réels de la v1
//     et tous ceux de `mockData/` ont une adresse `@mock.hifago.test` : le script de mock-data,
//     dont la clé d'idempotence est l'e-mail, y recréerait chaque partenaire en double. Une
//     donnée qui doit exister partout s'écrit en migration idempotente — elle part alors toute seule,
//     avec les photos qu'elle cite par leur chemin (`products/<uuid>.webp`, étape 4) ;
//   - les secrets, le Vault, la configuration de l'Auth (runbook §2 et §3) ;
//   - committer : il pousse ce qui est commité, rien d'autre.
//
// Codes de retour : 0 tout est vert · 1 une étape a échoué · 2 précondition (branche, retard,
// CLI non connectée, mauvais compte) · 3 fichiers de base non commités · 4 contenu saisi en local
// qu'aucune migration ne porte.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Publics tous les trois : ils figurent déjà au runbook (§1), sur un dépôt public.
const PREPROD = {
  ref: "ujlltaauitqfabcbgvaw",
  nom: "hifago-preprod",
  organisation: "stnqayyrssirmfwqolyr",
  branche: "staging",
  vitrine: "https://hifago-staging.vercel.app",
  admin: "https://hifago-admin-staging.vercel.app",
  // Sous-chaînes des contextes de statut que l'intégration Vercel pose sur le commit.
  buildsVercel: ["hifago-web", "hifago-admin"],
};

// Ce dont dépend une Edge Function : son code, `packages/domain` qu'elle importe, et sa section
// de `config.toml`. Les mêmes chemins doivent être commités avant tout envoi de base.
const SOURCES_FONCTIONS = ["supabase/functions", "packages/domain", "supabase/config.toml"];
const CHEMINS_BASE = ["supabase/migrations", ...SOURCES_FONCTIONS];

// Photos du catalogue : bucket public des deux côtés. La pile locale sert ses fichiers sur le port
// de l'API de `config.toml` ([api] port, 54321 par défaut).
const PHOTOS = {
  bucket: "catalog-media",
  locale: "http://127.0.0.1:54321/storage/v1/object/public/catalog-media",
  preprod: `https://${PREPROD.ref}.supabase.co/storage/v1/object/public/catalog-media`,
  // Un chemin cité entre apostrophes dans une migration, tel que `product_media.storage_path`.
  motif: /'((?:products|establishments)\/[0-9a-f-]{36}\.(webp|jpe?g|png|avif))'/g,
  types: { webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", avif: "image/avif" },
};

const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith("--"));
const aBlanc = args.includes("--dry-run");
const sansAttente = args.includes("--no-wait");
const contenuEnvoye = args.includes("--contenu-envoye");

class Arret extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const etape = (titre) => console.log(`\n== ${titre}`);
const ok = (texte) => console.log(`  ✓ ${texte}`);
const info = (texte) => console.log(`  · ${texte}`);
const alerte = (texte) => console.log(`  ⚠ ${texte}`);

// Rien de ce que la CLI imprime ne doit laisser passer une clé ou une URL de connexion
// (CLAUDE.md §8.2 et §8.4) : toute sortie capturée passe par ici avant d'être affichée.
function masquer(texte) {
  return texte
    .replace(/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_.-]+/g, "eyJ…")
    .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g, "sb_$1_…")
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/g, "$1***@");
}

function git(...parametres) {
  const r = spawnSync("git", parametres, { cwd: RACINE, encoding: "utf8" });
  if (r.status !== 0) throw new Arret(`git ${parametres.join(" ")} : ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

// `npx supabase`, jamais un binaire supposé installé : c'est la forme que tout le dépôt emploie.
// `shell: true` parce que `npx` est un `.cmd` sous Windows ; les arguments sont tous des constantes
// de ce fichier ou un chemin temporaire, mis entre guillemets.
function supabase(ligne, { tolereEchec = false } = {}) {
  const r = spawnSync(`npx supabase ${ligne}`, {
    cwd: RACINE,
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  const sortie = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  if (/AccessTokenRequiredError|Unauthorized|Invalid access token/i.test(sortie)) {
    throw new Arret(
      "la CLI Supabase n'est pas connectée sur ce poste. Dans un terminal : `npx.cmd supabase login` " +
        "(compte propriétaire de hifago-preprod), puis relancer.",
      2
    );
  }
  if (r.status !== 0 && !tolereEchec) {
    throw new Arret(`supabase ${ligne.split(" --workdir")[0]} a échoué :\n${masquer(sortie).trim()}`);
  }
  return { statut: r.status, stdout: r.stdout ?? "", sortie };
}

// ---------------------------------------------------------------------------------------------
// 1. Git
// ---------------------------------------------------------------------------------------------
function controlerGit() {
  etape("Dépôt");
  const branche = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branche !== PREPROD.branche) {
    throw new Arret(
      `branche courante « ${branche} » : la préprod ne reçoit que \`${PREPROD.branche}\`. ` +
        "Fusionner d'abord, ou changer de branche.",
      2
    );
  }

  const recupere = spawnSync("git", ["fetch", "--quiet", "origin", PREPROD.branche], { cwd: RACINE, encoding: "utf8" });
  if (recupere.status !== 0) throw new Arret(`git fetch a échoué (connexion ?) : ${recupere.stderr.trim()}`);

  const distant = `origin/${PREPROD.branche}`;
  const retard = Number(git("rev-list", "--count", `HEAD..${distant}`));
  const avance = Number(git("rev-list", "--count", `${distant}..HEAD`));
  if (retard > 0) {
    throw new Arret(
      `${distant} a ${retard} commit(s) absents d'ici. \`git pull --rebase origin ${PREPROD.branche}\` d'abord : ` +
        "pousser la base d'un arbre en retard appliquerait un schéma que personne n'a relu ensemble.",
      2
    );
  }

  const baseNonCommitee = git("status", "--porcelain", "--", ...CHEMINS_BASE);
  if (baseNonCommitee) {
    const message =
      "des fichiers de base ne sont pas commités — ce qui part en préprod doit être dans git :\n" +
      baseNonCommitee.split("\n").map((l) => `      ${l}`).join("\n");
    if (!aBlanc) throw new Arret(`${message}\n    Committer, puis relancer.`, 3);
    alerte(message);
  }

  const autres = git("status", "--porcelain").split("\n").filter(Boolean).length;
  const sha = git("rev-parse", "HEAD");
  ok(`${PREPROD.branche} @ ${sha.slice(0, 7)} — ${avance} commit(s) à pousser`);
  if (autres) alerte(`${autres} fichier(s) modifié(s) non commité(s) : ils ne partent pas.`);

  const mockData = avance ? git("diff", "--name-only", `${distant}..HEAD`, "--", "mockData") : "";
  return { sha, avance, distant, mockDataTouche: mockData ? mockData.split("\n").length : 0 };
}

// ---------------------------------------------------------------------------------------------
// 2. Compte — `/hifago-verify-compte` rendu mécanique
// ---------------------------------------------------------------------------------------------
function controlerCompte() {
  etape("Compte Supabase");
  const { stdout } = supabase("projects list -o json");
  let projets;
  try {
    // Première ligne qui OUVRE un tableau : un avertissement de la CLI peut précéder le JSON.
    projets = JSON.parse(stdout.slice(stdout.search(/^\[/m)));
  } catch {
    throw new Arret(`liste des projets illisible :\n${masquer(stdout).slice(0, 400)}`, 2);
  }
  const projet = projets.find((p) => p.id === PREPROD.ref || p.ref === PREPROD.ref);
  if (!projet || projet.name !== PREPROD.nom || projet.organization_id !== PREPROD.organisation) {
    throw new Arret(
      `le compte connecté à la CLI ne voit pas « ${PREPROD.nom} » (${PREPROD.ref}) dans l'organisation ` +
        `${PREPROD.organisation}. Projets visibles : ${projets.map((p) => p.name).join(", ") || "aucun"}. ` +
        "Rien n'a été poussé (CLAUDE.md §8.1).",
      2
    );
  }
  ok(`${projet.name} (${PREPROD.ref}), organisation ${projet.organization_id}`);
}

// ---------------------------------------------------------------------------------------------
// 3. Contenu saisi dans la base LOCALE — ce que ce script n'emporte pas
// ---------------------------------------------------------------------------------------------
// Ce qu'on saisit dans l'admin ou l'espace socio LOCAL (une fiche, une étiquette, une photo) vit
// dans la base locale seulement. Le relevé part du dernier envoi réussi de CE clone (repère gardé
// dans `.git/`, posé avec l'heure de la base, jamais celle du poste). Sources : `audit_log` des
// tables du catalogue, et les `created_at`/`updated_at` de ce que l'audit ne trace pas (création
// d'une étiquette, rattachement à un établissement). Une migration appliquée en local apparaît
// aussi : le relevé est une liste à trier, pas un verdict.
const RELEVE_CONTENU = `
select to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.USOF');
select distinct on (quoi) to_char(quand at time zone 'America/Bogota', 'DD/MM HH24:MI'), quoi from (
  select a.created_at, a.action || coalesce(' — ' || coalesce(p.slug, e.slug, pa.display_name), '')
    from public.audit_log a
    left join public.products p on a.entity_table = 'products' and p.id = a.entity_id
    left join public.establishments e on a.entity_table = 'establishments' and e.id = a.entity_id
    left join public.partners pa on a.entity_table = 'partners' and pa.id = a.entity_id
   where a.created_at > :'depuis'
     and a.entity_table in ('products', 'establishments', 'partners', 'product_media', 'establishment_media', 'catalog_tags')
  union all
  select created_at, 'étiquette créée — ' || slug from public.catalog_tags where created_at > :'depuis'
  union all
  select a.created_at, 'étiquette « ' || t.slug || ' » posée — ' || e.slug
    from public.establishment_tag_assignments a
    join public.establishments e on e.id = a.establishment_id join public.catalog_tags t on t.id = a.tag_id
   where a.created_at > :'depuis'
  union all
  select a.created_at, 'étiquette « ' || t.slug || ' » posée — ' || p.slug
    from public.product_tag_assignments a
    join public.products p on p.id = a.product_id join public.catalog_tags t on t.id = a.tag_id
   where a.created_at > :'depuis'
  union all
  select updated_at, 'fiche modifiée — ' || slug from public.products where updated_at > :'depuis'
  union all
  select updated_at, 'fiche modifiée — ' || slug from public.establishments where updated_at > :'depuis'
) as releve (quand, quoi)
order by quoi, quand;
`;

function conteneurBaseLocale() {
  const config = fs.readFileSync(path.join(RACINE, "supabase/config.toml"), "utf8");
  return `supabase_db_${config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1] ?? "hifago"}`;
}

function controlerContenuLocal() {
  etape("Contenu saisi en local");
  const depuis = lireEtat().contenu;
  const r = spawnSync(
    "docker",
    ["exec", "-i", conteneurBaseLocale(), "psql", "-U", "postgres", "-At", "-F", "\t",
      "-v", "ON_ERROR_STOP=1", "-v", `depuis=${depuis ?? "infinity"}`],
    { cwd: RACINE, input: RELEVE_CONTENU, encoding: "utf8" }
  );
  if (r.status !== 0) {
    alerte("base locale injoignable (Docker arrêté ?) : contenu saisi en local NON vérifié.");
    return { repere: null, bilan: "⚠ contenu local : non vérifié (base locale injoignable)" };
  }
  const [repere, ...lignes] = r.stdout.trim().split("\n");
  if (!depuis) {
    ok(`premier passage sur ce clone : repère posé (${repere.slice(0, 16)}), rien n'est comparé`);
    return { repere, bilan: "contenu local : repère posé" };
  }
  if (!lignes.length) {
    ok(`rien de saisi depuis le dernier envoi (${depuis.slice(0, 16)})`);
    return { repere, bilan: "contenu local : rien de nouveau" };
  }
  const liste = lignes.map((l) => `      ${l.replace("\t", "  ")}`).join("\n");
  const message =
    `${lignes.length} changement(s) saisi(s) dans la base locale depuis le dernier envoi (${depuis.slice(0, 16)}) — ` +
    `ce script n'envoie que des migrations, ils ne partiraient pas :\n${liste}`;
  if (contenuEnvoye) {
    alerte(message);
    ok("--contenu-envoye : porté par une migration de ce lot, ou volontairement laissé en local");
    return { repere, bilan: `contenu local : ${lignes.length} changement(s), déclaré(s) envoyé(s)` };
  }
  if (aBlanc) {
    alerte(message);
    return { repere: null, bilan: `⚠ contenu local : ${lignes.length} changement(s) qu'aucune migration ne porte` };
  }
  throw new Arret(
    `${message}\n    Ce qui doit exister en préprod s'écrit en migration idempotente (clés : slugs ; une photo ` +
      "citée par son chemin `products/<uuid>.webp` est envoyée par ce script). Puis relancer avec " +
      "--contenu-envoye — même option pour ce qui ne doit pas partir. Rien n'a été poussé.",
    4
  );
}

// ---------------------------------------------------------------------------------------------
// 4. Migrations — depuis une copie temporaire, jamais depuis le clone
// ---------------------------------------------------------------------------------------------
function preparerCopie() {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "hifago-preprod-"));
  const cible = path.join(dossier, "supabase");
  fs.mkdirSync(cible);
  // `config.toml` référence `seed.sql` et les gabarits d'e-mail : ils suivent, pour que la CLI
  // charge la même configuration qu'à la racine. Rien d'autre n'est lu par `link` ni `db push`.
  for (const nom of ["config.toml", "seed.sql", "migrations", "templates"]) {
    const source = path.join(RACINE, "supabase", nom);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(cible, nom), { recursive: true });
  }
  supabase(`link --project-ref ${PREPROD.ref} --workdir "${dossier}"`);
  return dossier;
}

function migrationsEnAttente(dossier) {
  const { sortie } = supabase(`db push --dry-run --workdir "${dossier}"`);
  // La CLI termine par un résumé JSON quand elle se sait pilotée par un agent, par une liste à
  // puces dans un terminal : on lit les deux, sans dépendre de sa détection.
  const resume = sortie.split("\n").reverse().find((l) => l.trim().startsWith("{") && l.includes('"migrations"'));
  if (resume) {
    try {
      return JSON.parse(resume).migrations ?? [];
    } catch {
      // résumé tronqué : on retombe sur la liste à puces
    }
  }
  const puces = [...sortie.matchAll(/^\s*[•*-]\s*(\d{14}_[\w.-]+\.sql)\s*$/gm)].map((m) => m[1]);
  if (puces.length || /up to date/i.test(sortie)) return puces;
  throw new Arret(`essai à blanc illisible :\n${masquer(sortie).trim().slice(-600)}`);
}

// Une migration de données rattache une photo par son chemin, mais ne transporte pas le fichier :
// sans lui, elle la rattache à vide (ou, si elle est écrite comme 20261014160938, ne la rattache
// pas). Chaque chemin cité qui manque à la préprod part donc de la pile locale AVANT le `db push`.
// Échec fermé : une photo introuvable des deux côtés arrête tout, rien n'est appliqué.
async function envoyerPhotos(copie, enAttente) {
  const chemins = [
    ...new Set(
      enAttente.flatMap((m) =>
        [...fs.readFileSync(path.join(RACINE, "supabase/migrations", m), "utf8").matchAll(PHOTOS.motif)].map((x) => x[1])
      )
    ),
  ];
  if (!chemins.length) return null;
  etape("Photos citées par les migrations");
  const manquantes = [];
  for (const chemin of chemins) {
    const reponse = await lire(`${PHOTOS.preprod}/${chemin}`, { tentatives: 2, delai: 20_000 });
    if (reponse.ok) ok(`${chemin} : déjà en préprod`);
    else manquantes.push(chemin);
  }
  if (!manquantes.length) return `photos : ${chemins.length} déjà en préprod`;
  if (aBlanc) {
    for (const chemin of manquantes) info(`${chemin} : serait envoyée depuis la pile locale`);
    return `photos : ${manquantes.length} à envoyer (non envoyées, essai à blanc)`;
  }

  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "hifago-photos-"));
  try {
    for (const chemin of manquantes) {
      let reponse;
      try {
        reponse = await lire(`${PHOTOS.locale}/${chemin}`, { tentatives: 1, delai: 20_000 });
      } catch (erreur) {
        reponse = { ok: false, status: erreur.message };
      }
      if (!reponse.ok) {
        throw new Arret(
          `${chemin} manque à la préprod et la pile locale ne la sert pas (${reponse.status}) : la migration ` +
            "qui la cite la rattacherait à vide. Démarrer la pile locale (/hifago-dev), puis relancer — rien n'a été appliqué."
        );
      }
      const fichier = path.join(dossier, path.basename(chemin));
      fs.writeFileSync(fichier, Buffer.from(await reponse.arrayBuffer()));
      const type = PHOTOS.types[chemin.split(".").pop()];
      supabase(
        `storage cp "${fichier}" "ss:///${PHOTOS.bucket}/${chemin}" --content-type ${type} --linked --experimental --workdir "${copie}"`
      );
      const verification = await lire(`${PHOTOS.preprod}/${chemin}`, { tentatives: 2, delai: 20_000 });
      if (!verification.ok) {
        throw new Arret(`${chemin} envoyée, mais la préprod ne la sert pas (HTTP ${verification.status}) — rien n'a été appliqué.`);
      }
      ok(`${chemin} envoyée`);
    }
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
  return `photos : ${manquantes.length} envoyée(s)`;
}

// ---------------------------------------------------------------------------------------------
// 5. Edge Functions — redéployées seulement si leurs sources ont bougé
// ---------------------------------------------------------------------------------------------
// L'empreinte vient de l'INDEX git (`ls-files -s` : mode + sha de chaque blob), pas du disque : les
// chemins concernés sont commités à ce stade (étape 1), donc elle décrit ce qui part.
function empreinteFonctions() {
  return createHash("sha256").update(git("ls-files", "-s", "--", ...SOURCES_FONCTIONS)).digest("hex");
}

// Mémoire locale au clone, dans `.git/` : jamais commitée, jamais partagée. Absente ou périmée,
// elle provoque un redéploiement de trop — sans conséquence, les fonctions sont idempotentes.
const fichierEtat = () => path.resolve(RACINE, git("rev-parse", "--git-path", "hifago-deploy-preprod.json"));

function lireEtat() {
  try {
    return JSON.parse(fs.readFileSync(fichierEtat(), "utf8"));
  } catch {
    return {};
  }
}

// Deux clés, écrites à deux moments : `fonctions` (empreinte) et `contenu` (repère du relevé).
function ecrireEtat(modification) {
  fs.writeFileSync(fichierEtat(), JSON.stringify({ ...lireEtat(), ...modification }, null, 2));
}

function deployerFonctions(sha) {
  etape("Edge Functions");
  const empreinte = empreinteFonctions();
  if (lireEtat().fonctions === empreinte) {
    ok("sources inchangées depuis le dernier déploiement : rien à faire");
    return "inchangées";
  }
  if (aBlanc) {
    info("seraient redéployées (sources changées depuis le dernier déploiement connu de ce clone)");
    return "à redéployer";
  }
  // Depuis la RACINE : les fonctions importent `packages/domain` par chemin relatif.
  // `--use-api` : empaquetage côté serveur, sans Docker.
  const avant = new Set(fs.existsSync(path.join(RACINE, "supabase/.temp")) ? fs.readdirSync(path.join(RACINE, "supabase/.temp")) : []);
  try {
    supabase(`functions deploy --project-ref ${PREPROD.ref} --use-api --yes`);
  } finally {
    nettoyerTemp(avant);
  }
  // Pas d'horodatage ici : la date de modification du fichier le donne, et `check-timezone.sh`
  // refuse tout `new Date()` nu dans `scripts/`.
  ecrireEtat({ fonctions: empreinte, sha });
  ok("redéployées");
  return "redéployées";
}

// Filet : si une commande lancée depuis la racine a posé des fichiers de lien dans le `.temp` du
// clone, on retire ceux qui n'y étaient pas — et seulement ceux-là.
function nettoyerTemp(avant) {
  const temp = path.join(RACINE, "supabase/.temp");
  if (!fs.existsSync(temp)) return;
  for (const nom of fs.readdirSync(temp)) {
    if (!avant.has(nom)) fs.rmSync(path.join(temp, nom), { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// 6. Code — `git push`, puis le build Vercel
// ---------------------------------------------------------------------------------------------
function pousserCode(sha) {
  etape("Code");
  // Les deux marqueurs sont lus par `scripts/git-hooks/pre-push` : la base vient d'être mise à
  // jour pour CE commit (sa garde « migration avant code » laisse passer), et `verify` vient de
  // tourner sur ce même commit (inutile de le relancer). Liés au sha : un marqueur resté dans
  // l'environnement ne couvre aucun autre commit.
  const r = spawnSync("git", ["push", "origin", PREPROD.branche], {
    cwd: RACINE,
    stdio: "inherit",
    env: { ...process.env, HIFAGO_DEPLOY_PREPROD: sha, HIFAGO_VERIFY_FAIT: sha },
  });
  if (r.status !== 0) {
    throw new Arret("`git push` a échoué. La base est à jour, le code n'est pas parti : corriger, puis relancer.");
  }
  ok(`${sha.slice(0, 7)} poussé sur origin/${PREPROD.branche}`);
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function lire(url, { tentatives = 3, delai = 40_000 } = {}) {
  let derniere;
  for (let i = 0; i < tentatives; i += 1) {
    try {
      return await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "hifago-deploy-preprod", Accept: "*/*" },
        signal: AbortSignal.timeout(delai),
      });
    } catch (erreur) {
      derniere = erreur;
      await pause(2_000 * (i + 1));
    }
  }
  throw derniere;
}

// Le dépôt est public : l'API GitHub répond sans jeton (60 requêtes/heure — d'où un sondage
// toutes les 20 s, 30 au plus). Vercel y pose un statut par app sur chaque commit.
async function attendreVercel(sha) {
  etape("Build Vercel");
  const origine = git("remote", "get-url", "origin").match(/github\.com[:/]([^/]+\/[^/.]+)/)?.[1];
  if (!origine) {
    alerte("dépôt GitHub introuvable dans `origin` : build non suivi.");
    return "non suivi";
  }
  const url = `https://api.github.com/repos/${origine}/commits/${sha}/status`;
  const debut = Date.now();
  const vus = new Map();

  for (let tour = 0; tour < 30; tour += 1) {
    await pause(20_000);
    let statuts;
    try {
      const reponse = await lire(url, { tentatives: 2, delai: 20_000 });
      if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
      statuts = (await reponse.json()).statuses ?? [];
    } catch (erreur) {
      info(`statut illisible (${erreur.message}) — nouvel essai`);
      continue;
    }
    for (const attendu of PREPROD.buildsVercel) {
      const statut = statuts.find((s) => s.context.startsWith("Vercel") && s.context.includes(attendu));
      if (statut) vus.set(attendu, statut);
    }
    const echec = [...vus.values()].find((s) => s.state === "failure" || s.state === "error");
    if (echec) {
      throw new Arret(
        `le build Vercel « ${echec.context} » a échoué : ${echec.target_url}\n` +
          "    La préprod garde l'ancien code (la base, elle, est à jour). Corriger, puis relancer."
      );
    }
    const finis = PREPROD.buildsVercel.filter((a) => vus.get(a)?.state === "success");
    if (finis.length === PREPROD.buildsVercel.length) {
      ok(`${finis.join(" et ")} déployés (${Math.round((Date.now() - debut) / 1000)} s)`);
      return "déployé";
    }
    // Vercel saute le build d'une app que le commit ne touche pas : aucun statut n'arrive alors.
    const absents = PREPROD.buildsVercel.filter((a) => !vus.has(a));
    if (absents.length && finis.length && Date.now() - debut > 240_000) {
      ok(`${finis.join(" et ")} déployé(s) ; aucun build annoncé pour ${absents.join(", ")}`);
      return "déployé";
    }
  }
  alerte("build toujours en cours après 10 min : le contrôle ci-dessous porte peut-être sur l'ancien code.");
  return "non confirmé";
}

// ---------------------------------------------------------------------------------------------
// 7. Contrôle au rendu réel
// ---------------------------------------------------------------------------------------------
// Les pages qui sont tombées le 2026-10-13 : une liste verte ne prouve rien, il faut ouvrir une
// fiche. Les deux fiches sont prises dans les listes servies, jamais écrites en dur.
async function controlerPreprod() {
  etape("Contrôle de la préprod");
  const resultats = [];
  const visiter = async (nom, url) => {
    try {
      const reponse = await lire(url);
      const corps = await reponse.text();
      const bon = reponse.status === 200 && !corps.includes('data-testid="error-');
      resultats.push(bon);
      console.log(`  ${bon ? "✓" : "✗"} ${String(reponse.status).padEnd(4)}${nom} — ${url}`);
      return corps;
    } catch (erreur) {
      resultats.push(false);
      console.log(`  ✗ ---- ${nom} — ${url} (${erreur.message})`);
      return "";
    }
  };
  const lien = (html, motif) => html.match(motif)?.[1];

  await visiter("accueil", `${PREPROD.vitrine}/es`);
  const actividades = await visiter("liste", `${PREPROD.vitrine}/es/actividades`);
  const alojamientos = await visiter("liste", `${PREPROD.vitrine}/es/alojamientos`);
  const producto = lien(actividades, /href="(\/es\/productos\/[^"]+)"/);
  const establecimiento = lien(alojamientos, /href="(\/es\/establecimientos\/[^"]+)"/);
  if (producto) await visiter("fiche produit", PREPROD.vitrine + producto);
  else alerte("aucune fiche produit trouvée dans la liste : fiche non contrôlée");
  if (establecimiento) await visiter("fiche établissement", PREPROD.vitrine + establecimiento);
  else alerte("aucune fiche établissement trouvée dans la liste : fiche non contrôlée");
  await visiter("sitemap", `${PREPROD.vitrine}/sitemap.xml`);
  await visiter("admin", `${PREPROD.admin}/login`);

  const echecs = resultats.filter((r) => !r).length;
  if (echecs) throw new Arret(`${echecs} page(s) de la préprod ne répondent pas correctement (détail ci-dessus).`);
  return resultats.length;
}

// ---------------------------------------------------------------------------------------------
async function main() {
  if (!["all", "code", "db"].includes(mode)) {
    throw new Arret("Usage : node scripts/deploy-preprod.mjs <all|code|db> [--dry-run] [--no-wait] [--contenu-envoye]", 2);
  }
  console.log(`Préprod Hifago — mode ${mode}${aBlanc ? " (essai à blanc : rien ne sera poussé)" : ""}`);
  const bilan = [];

  const { sha, avance, mockDataTouche } = controlerGit();
  controlerCompte();
  const contenu = controlerContenuLocal();
  bilan.push(contenu.bilan);

  const pousseCode = mode !== "db" && avance > 0;
  if (pousseCode && !aBlanc) {
    etape("Contrôles (npm run verify)");
    const r = spawnSync("npm run --silent verify", { cwd: RACINE, shell: true, stdio: "inherit" });
    if (r.status !== 0) throw new Arret("`npm run verify` est rouge : rien n'a été poussé, ni la base ni le code.");
  }

  etape("Migrations");
  const copie = preparerCopie();
  try {
    const enAttente = migrationsEnAttente(copie);
    if (!enAttente.length) {
      ok("la préprod est à jour");
      bilan.push("migrations : aucune en attente");
    } else {
      for (const m of enAttente) info(m);
      if (mode === "code") info("le code à pousser dépend de ces migrations : elles partent d'abord.");
      const photos = await envoyerPhotos(copie, enAttente);
      if (photos) bilan.push(photos);
      if (aBlanc) {
        bilan.push(`migrations : ${enAttente.length} en attente (non appliquées, essai à blanc)`);
      } else {
        supabase(`db push --yes --workdir "${copie}"`);
        const reste = migrationsEnAttente(copie);
        if (reste.length) throw new Arret(`après le push, ${reste.length} migration(s) restent en attente : ${reste.join(", ")}`);
        ok(`${enAttente.length} migration(s) appliquée(s), préprod à jour`);
        bilan.push(`migrations : ${enAttente.length} appliquée(s)`);
      }
    }
  } finally {
    fs.rmSync(copie, { recursive: true, force: true });
  }

  bilan.push(`fonctions : ${deployerFonctions(sha)}`);

  if (mode === "db") {
    bilan.push("code : non poussé (mode db)");
  } else if (!avance) {
    etape("Code");
    ok("rien à pousser : origin est déjà à ce commit");
    bilan.push("code : déjà à jour");
  } else if (aBlanc) {
    bilan.push(`code : ${avance} commit(s) à pousser (non poussés, essai à blanc)`);
  } else {
    pousserCode(sha);
    const build = sansAttente ? "non attendu (--no-wait)" : await attendreVercel(sha);
    bilan.push(`code : ${avance} commit(s) poussé(s), build Vercel ${build}`);
  }

  const pages = await controlerPreprod();
  bilan.push(`contrôle : ${pages} pages en 200`);
  // Le repère n'avance qu'après un envoi complet : un échec plus haut laisse le relevé intact.
  if (!aBlanc && contenu.repere) ecrireEtat({ contenu: contenu.repere });
  if (mockDataTouche) {
    bilan.push(
      `⚠ mockData/ : ${mockDataTouche} fichier(s) modifié(s) dans ce lot — ils ne partent PAS en préprod ` +
        "(une donnée qui doit y exister s'écrit en migration)"
    );
  }

  console.log(`\n${aBlanc ? "Essai à blanc terminé" : "Préprod à jour"} :`);
  for (const ligne of bilan) console.log(`  - ${ligne}`);
}

// Exportées pour être essayées une à une sans rien pousser (attente du build sur un commit déjà
// en ligne, lecture d'un essai à blanc) : importer ce fichier ne lance rien.
export { attendreVercel, controlerContenuLocal, controlerPreprod, masquer };

const lanceDirectement =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase();

if (lanceDirectement) {
  main().catch((erreur) => {
    console.error(`\n✗ ${erreur instanceof Arret ? erreur.message : masquer(String(erreur?.stack ?? erreur))}`);
    process.exit(erreur instanceof Arret ? erreur.code : 1);
  });
}
